// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Reset a Platform User's Password (W1.3)
// FLOW   : requirePlatformAdmin() authorises → Zod validates the [id] segment →
//          the service generates a password, stores only its bcrypt hash and
//          sets mustChangePassword → the plaintext is returned once.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// BACKEND: PlatformUser via lib/services/platformUser.service only.
// PURPOSE: Restore access to an operator who has lost it, without any operator
//          ever choosing another operator's password.
//
// WHY THIS IS A SEPARATE ROUTE AND NOT A FIELD ON PATCH
//   PATCH accepts values the caller supplies. Allowing a password through it
//   would mean one operator could set a colleague's credential to a string they
//   know and keep — and the account would look untouched afterwards. This route
//   takes no password at all: there is no input by which the new secret can be
//   influenced, only a request that one be generated.
//
// WHY THERE IS NO EMAILED LINK
//   This codebase has no mail transport, so a token-and-link flow would need a
//   new table, an expiry sweep and a delivery channel that does not exist —
//   which is precisely the "complex invitation system" W1.3 says not to invent.
//   The password is handed to the operator performing the reset, over the same
//   authenticated TLS connection as the rest of the console, and is useful for
//   exactly one sign-in.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { platformUserIdParamSchema } from "@/lib/validations/platform";
import {
  logPlatformUserEvent,
  resetPlatformUserPassword,
} from "@/lib/services/platformUser.service";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// POST
// ACCESS     : PLATFORM_ADMIN (platform session — W1.2)
// VALIDATION : platformUserIdParamSchema only. The request has NO body — see
//              the header for why nothing about the new password is accepted.
// FLOW       : Authorise → validate the route param → generate → hash → store
//              the hash and mustChangePassword = true → return the plaintext.
// RESPONSE   : { success: true, data: { user, temporaryPassword }, message }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
// NOTHING BELOW LOGS THE PASSWORD. The audit line carries two ids and a verb;
// the plaintext appears only in the response body.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsed = platformUserIdParamSchema.safeParse(await params);
    if (!parsed.success) {
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

    const result = await resetPlatformUserPassword(parsed.data.id);

    if (!result.ok) {
      return NextResponse.json(fail("Platform user not found", "NOT_FOUND"), { status: 404 });
    }

    logPlatformUserEvent("password-reset", guard.platformUserId, result.value.user.id);

    return NextResponse.json(
      ok(
        { user: result.value.user, temporaryPassword: result.value.temporaryPassword },
        "Temporary password issued"
      )
    );
  } catch (err) {
    console.error("[POST /api/platform/users/[id]/reset-password]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
