// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform Authentication — Change Own Password (W1.3)
// FLOW   : Platform session → Zod → verify the current password → store the new
//          hash and clear mustChangePassword.
// ACCESS : Any authenticated PLATFORM session, INCLUDING one that
//          requirePlatformAdmin currently refuses for PASSWORD_CHANGE_REQUIRED.
// PURPOSE: The one thing an operator holding a generated password can do.
//
// WHY THIS ROUTE DOES NOT USE requirePlatformAdmin
//   That guard refuses exactly the accounts this route exists to serve: an
//   operator whose password was set by somebody else is reduced to "change your
//   password", and calling the guard here would reduce them to nothing at all.
//
//   That is not a gap in the gate. This route grants no read and no write
//   beyond one column on the caller's OWN row, identified by the session's sub
//   rather than by anything in the body — there is no id parameter, so it
//   cannot be aimed at another account. And it still requires the CURRENT
//   password: a stolen session alone does not let somebody take the account
//   over permanently.
//
//   The role is deliberately not checked either. An operator whose PLATFORM
//   role was revoked while holding a temporary password should still be able to
//   stop that shared secret being live, and nothing they can reach with it is
//   gated on this route.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { getPlatformSession } from "@/lib/auth/platformSession";
import { changePlatformPasswordSchema } from "@/lib/validations/platform";
import { changeOwnPlatformPassword } from "@/lib/services/platformUser.service";
import { ok, fail } from "@/types";

// POST
// VALIDATION : changePlatformPasswordSchema — currentPassword (min 8, matching
//              what login accepts) and newPassword (min 12), strict, and the
//              two must differ. Resubmitting the same value would otherwise
//              clear the forced-change flag while leaving the shared secret in
//              place, which is the one outcome this whole flow exists to stop.
// RESPONSE   : { success: true, data: null, message: "Password changed" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 500
//
// The session cookie is deliberately NOT reissued. It is already valid, already
// short-lived, and already carries no claim that this change invalidates.
export async function POST(request: NextRequest) {
  try {
    const session = await getPlatformSession();
    if (!session) {
      return NextResponse.json(fail("Unauthorized", "UNAUTHORIZED"), { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = changePlatformPasswordSchema.safeParse(body);
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

    const changed = await changeOwnPlatformPassword(
      session.sub,
      parsed.data.currentPassword,
      parsed.data.newPassword
    );

    if (!changed) {
      // A wrong current password and a session whose account no longer exists
      // answer identically. Neither tells the caller anything they should learn
      // from a failed attempt.
      console.warn(`[platform-auth] change-password-rejected sub=${session.sub}`);
      return NextResponse.json(fail("Current password is incorrect", "AUTH_ERROR"), {
        status: 401,
      });
    }

    console.warn(`[platform-auth] password-changed sub=${session.sub}`);

    return NextResponse.json(ok(null, "Password changed"));
  } catch (err) {
    console.error("[POST /api/super-admin/auth/change-password]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
