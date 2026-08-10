// ============================================================================
// OWNER  : Gauransh
// MODULE : Authentication — Change Own Password (W1.4)
// FLOW   : requireAuth({ allowPasswordChangeRequired: true }) → Zod → verify the
//          current password → store the new hash, clear mustChangePassword, and
//          end every other session for this user.
// ACCESS : Any authenticated tenant user, INCLUDING one that requireAuth
//          otherwise refuses for PASSWORD_CHANGE_REQUIRED.
// PURPOSE: The one thing a user holding a provisioned password can do.
//
// THIS ROUTE WAS ALREADY BEING CALLED
//   services/account.ts has posted to /api/auth/change-password since the
//   frontend work, with a comment saying no backend route existed — so the
//   "Change password" form in /settings failed for every user. W1.4 needs a
//   forced change anyway, so the route is implemented here rather than a second
//   path being invented beside the one the app already calls.
//
// WHY THE FLAG IS BYPASSED RATHER THAN THE GUARD SKIPPED
//   requireAuth still runs in full: the JWT is verified, the live Session row
//   is matched, and User.isActive is checked. Only the forced-change refusal is
//   waived, because this route is the act that resolves it. Skipping the guard
//   entirely and re-reading the session by hand would mean a second, divergent
//   copy of the session chain.
//
// THE CURRENT PASSWORD IS STILL REQUIRED
//   A session left open on a shared machine must not be enough to take an
//   account over permanently.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { requireAuth } from "@/lib/middleware/requireAuth";
import { getAccessToken } from "@/lib/auth/session";
import { changeTenantPasswordSchema } from "@/lib/validations/platform";
import { recordAudit, recordAuditFailure } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { ok, fail } from "@/types";

// POST
// VALIDATION : changeTenantPasswordSchema — currentPassword (min 8, matching
//              what login accepts) and newPassword (min 12), strict, and the
//              two must differ. Resubmitting the same value would otherwise
//              clear the forced-change flag while leaving the shared secret in
//              place, which is the one outcome the flow exists to stop.
// FLOW       : Authenticate (forced-change permitted) → validate → verify the
//              current password → in one transaction, write the new hash, clear
//              mustChangePassword, and delete every OTHER Session row for this
//              user.
// RESPONSE   : { success: true, data: null, message: "Password changed" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 500
//
// OTHER SESSIONS ARE ENDED, THIS ONE IS KEPT
//   Changing a password is how somebody responds to it having been shared or
//   exposed, so leaving other live sessions signed in would defeat the act.
//   The caller's own session survives, because signing the user out of the tab
//   they just used to fix the problem reads as the change having failed.
//   The platform counterpart does not do this: platform tokens are stateless
//   and expire in an hour, whereas a tenant Session row lives for seven days.
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth({ allowPasswordChangeRequired: true });
    if (!auth.authenticated) return auth.response;

    const { session } = auth;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = changeTenantPasswordSchema.safeParse(body);
    if (!parsed.success) {
      // No field-level details. Every message this schema could produce is
      // about a password, and echoing which rule a submitted password broke
      // describes the value back to whoever sent it.
      return NextResponse.json(
        fail(
          "Enter your current password and a new one of at least 12 characters that differs from it.",
          "VALIDATION_ERROR"
        ),
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: { id: true, passwordHash: true },
    });

    // The guard above proved a live Session row whose user is active, so this
    // is only reachable if the account was deleted mid-request. Narrowed rather
    // than asserted.
    if (!user) {
      return NextResponse.json(fail("Unauthorized", "UNAUTHORIZED"), { status: 401 });
    }

    if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
      // PRD §47 "Failed action logs". The address is not recorded here — the
      // actor id already identifies the account — and the password never is.
      await recordAuditFailure({
        tenantId: session.tenantId,
        actor: { userId: user.id, ...readRequestOrigin(request.headers) },
        action: AUDIT_ACTIONS.PASSWORD_CHANGED,
        resource: AUDIT_RESOURCES.USER,
        resourceId: user.id,
        after: { reason: "incorrect current password" },
      });

      return NextResponse.json(fail("Current password is incorrect", "AUTH_ERROR"), {
        status: 401,
      });
    }

    const currentToken = await getAccessToken();
    const passwordHash = await hashPassword(parsed.data.newPassword);

    // One transaction: a password updated without the other sessions being
    // ended leaves exactly the access the change was meant to revoke.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      }),
      prisma.session.deleteMany({
        where: { userId: user.id, NOT: { token: currentToken ?? "" } },
      }),
    ]);

    await recordAudit({
      tenantId: session.tenantId,
      actor: { userId: user.id, ...readRequestOrigin(request.headers) },
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      resource: AUDIT_RESOURCES.USER,
      resourceId: user.id,
      // The event, not the value. No password, no hash — see the audit service.
      after: { otherSessionsEnded: true },
    });

    return NextResponse.json(ok(null, "Password changed"));
  } catch (err) {
    console.error("[POST /api/auth/change-password]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
