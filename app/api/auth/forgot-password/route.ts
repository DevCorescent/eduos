// ============================================================================
// MODULE : Auth — request a password reset code (tester issue #15)
// FLOW   : Parse → validate → resolve tenant → find user → mint, hash, store,
//          email → uniform envelope.
// ACCESS : Public. This is the screen for someone who cannot sign in.
//
// WHAT WAS WRONG
//   services/auth.ts has always called POST /api/auth/forgot-password and this
//   route did not exist. Next answered with its 404 HTML page, apiRequest tried
//   to JSON.parse it, and the form showed the parse failure — the "server
//   returned an unreadable response" the tester reported. No code was ever
//   generated because nothing ran.
//
// THE RESPONSE IS THE SAME WHETHER OR NOT THE ACCOUNT EXISTS
//   This endpoint is unauthenticated and takes an email address. If it answered
//   differently for a registered address, it would be an account-enumeration
//   oracle: anybody could discover which addresses hold accounts at which
//   university, one request at a time. So the envelope below is built ONCE,
//   before the account is looked up, and returned on every path — unknown
//   address, unknown tenant, suspended tenant, delivery failure. The screen's
//   own copy already assumes this ("If <email> has an account, a verification
//   code is on its way").
//
// THAT IS ALSO WHY DELIVERY FAILURE DOES NOT CHANGE THE STATUS
//   Reporting "we could not send the mail" would leak that there was something
//   to send. The failure is logged server-side with the provider's reason and
//   the caller is told the same thing as everyone else. `sent` reflects whether
//   this request produced a delivered message, and is deliberately not a
//   statement about whether the address is registered — it is false for an
//   unknown address and false for a genuine send that the relay rejected.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { isServableStatus } from "@/lib/domain/tenant/servable";
import {
  generateResetCode,
  hashResetCode,
  resetCodeEmail,
  resetCodeExpiry,
} from "@/lib/auth/passwordReset";
import { sendMail } from "@/lib/services/mail";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// POST
// ACCESS     : Public.
// VALIDATION : forgotPasswordSchema — tenantSlug and a well-formed email.
// RESPONSE   : { success: true, data: { sent } } on every non-malformed request.
// STATUS     : 200 · 400 VALIDATION_ERROR · 500 SERVER_ERROR
export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        fail("Request body must be valid JSON", "VALIDATION_ERROR"),
        { status: 400 }
      );
    }

    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      // A malformed address IS reported, and discloses nothing: it says the
      // input was not an email, not whether an account holds it.
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsed.error),
        },
        { status: 400 }
      );
    }

    const { tenantSlug, email } = parsed.data;

    // Built before anything is looked up, and returned unchanged on every path
    // below. See the header: this is the anti-enumeration guarantee, and
    // keeping one object makes it impossible for a branch to drift from it.
    const uniform = (sent: boolean) =>
      NextResponse.json(
        ok(
          { sent },
          "If that address has an account, a verification code is on its way."
        )
      );

    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true, status: true },
    });

    // An unknown or unservable university answers exactly like an unknown
    // address. Distinguishing them would disclose which slugs exist.
    if (!tenant || !isServableStatus(tenant.status)) return uniform(false);

    const user = await prisma.user.findFirst({
      // Addresses are stored and compared lowercased elsewhere in this codebase;
      // the schema trims but does not lowercase, so it is done here.
      where: { tenantId: tenant.id, email: email.toLowerCase() },
      select: { id: true, isActive: true },
    });

    // A deactivated account is treated as absent. Letting it receive a code
    // would be a route back in for someone an administrator has locked out.
    if (!user || !user.isActive) return uniform(false);

    const code = generateResetCode();
    const codeHash = await hashResetCode(code);
    const origin = readRequestOrigin(request.headers);

    // Consuming the outstanding codes and issuing the new one together: two
    // valid codes for one account at the same time doubles the guessing surface
    // for no benefit, and a half-applied pair would leave either none or two.
    await prisma.$transaction([
      prisma.passwordResetCode.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      prisma.passwordResetCode.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          codeHash,
          expiresAt: resetCodeExpiry(),
          requestedIp: origin.ipAddress,
          userAgent: origin.userAgent,
        },
      }),
    ]);

    const { subject, text } = resetCodeEmail(code);
    const delivery = await sendMail({ to: email.toLowerCase(), subject, text });

    if (!delivery.delivered) {
      // The provider's reason names the recipient and the relay, so it goes to
      // the log and never to the caller. The stored code stays valid: the
      // person can ask again, and the next request supersedes it.
      console.error("[POST /api/auth/forgot-password] delivery failed:", delivery.reason);
    }

    return uniform(delivery.delivered);
  } catch (error) {
    // Without this the exception would become Next's HTML error page — the
    // very thing that made this flow unreadable to the client.
    console.error("[POST /api/auth/forgot-password]", error);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
