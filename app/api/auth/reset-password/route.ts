// ============================================================================
// MODULE : Auth — complete a password reset (tester issue #15)
// FLOW   : Parse → validate → resolve tenant → resolve user → check the live
//          code → set the password, consume the code, drop the sessions.
// ACCESS : Public, but it grants nothing without a code this server issued.
//
// ONE REFUSAL FOR EVERY WAY OF BEING WRONG
//   Unknown tenant, unknown address, deactivated account, no outstanding code,
//   wrong code, expired code, already-used code and a code belonging to another
//   university all return the SAME 400. Separating them would turn this into an
//   oracle: "expired" would confirm the address is registered, and "no such
//   account" would confirm it is not. The person who genuinely mistyped a digit
//   is told to check the code and ask for a new one, which is the only advice
//   that helps in every one of those cases anyway.
//
// WHY SESSIONS ARE DELETED
//   Someone resets a password precisely when they suspect they have lost
//   control of the account. Leaving existing sessions alive would let whoever
//   prompted the reset keep the access it was meant to revoke. Session rows are
//   this project's server-side record of a login (see lib/auth/session.ts), so
//   removing this user's rows is how that access ends.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resetPasswordSchema } from "@/lib/validations/auth";
import { isServableStatus } from "@/lib/domain/tenant/servable";
import { hashPassword } from "@/lib/auth/password";
import { verifyResetCode } from "@/lib/auth/passwordReset";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** The single refusal. See the header for why there is only one. */
function refused() {
  return NextResponse.json(
    fail(
      "That code is not valid. Check the code, or request a new one.",
      "VALIDATION_ERROR"
    ),
    { status: 400 }
  );
}

// POST
// ACCESS     : Public.
// VALIDATION : resetPasswordSchema — tenantSlug, email, a six-digit otp and a
//              newPassword of at least eight characters.
// RESPONSE   : { success: true, data: null }
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

    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      // Shape problems ARE itemised — "the code is 6 digits" and "use at least
      // eight characters" are about what the user typed into a field, and
      // disclose nothing about which accounts exist.
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

    const { tenantSlug, email, otp, newPassword } = parsed.data;

    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true, status: true },
    });
    if (!tenant || !isServableStatus(tenant.status)) return refused();

    const user = await prisma.user.findFirst({
      where: { tenantId: tenant.id, email: email.toLowerCase() },
      select: { id: true, isActive: true },
    });
    if (!user || !user.isActive) return refused();

    // Live codes only, newest first. tenantId is matched as well as userId: a
    // user belongs to one tenant, so this is redundant today and is the thing
    // that stays correct if that ever stops being true.
    const candidates = await prisma.passwordResetCode.findMany({
      where: {
        userId: user.id,
        tenantId: tenant.id,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, codeHash: true },
      orderBy: { createdAt: "desc" },
    });

    // Normally at most one — forgot-password consumes the previous codes as it
    // issues a new one. Iterated rather than assumed, so a race that left two
    // live rows cannot lock a person out of their own valid code.
    let matchedId: string | null = null;
    for (const candidate of candidates) {
      if (await verifyResetCode(otp, candidate.codeHash)) {
        matchedId = candidate.id;
        break;
      }
    }

    if (!matchedId) return refused();

    const passwordHash = await hashPassword(newPassword);

    // One transaction. A password changed without the code being consumed would
    // leave that code able to change it again; a code consumed without the
    // password changing would strand the person with no way back in.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        // mustChangePassword is cleared: the user has just chosen this password
        // themselves, so continuing to demand a change would be a loop.
        data: { passwordHash, mustChangePassword: false },
      }),
      prisma.passwordResetCode.update({
        where: { id: matchedId },
        data: { consumedAt: new Date() },
      }),
      // Any other outstanding code dies with this reset.
      prisma.passwordResetCode.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      // See the header: the reset is what ends every existing login.
      prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);

    return NextResponse.json(ok(null, "Your password has been changed. Sign in with it."));
  } catch (error) {
    console.error("[POST /api/auth/reset-password]", error);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
