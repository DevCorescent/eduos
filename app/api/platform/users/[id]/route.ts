// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Get / Update Platform User (W1.3)
// FLOW   : requirePlatformAdmin() authorises → Zod validates the param and the
//          body → lib/services/platformUser.service does the database work.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// BACKEND: PlatformUser, PlatformRole and PlatformUserRole via the service
//          only. No tenant model is read or written.
// PURPOSE: View and maintain one platform operator, including activation and
//          deactivation.
//
// THERE IS NO DELETE HERE, AND THAT IS THE DESIGN
//   Deactivation is PATCH { isActive: false }. It takes effect on the next
//   request — requirePlatformAdmin re-reads the column every time — while
//   preserving the account's history and its role grants, which a delete would
//   cascade away along with the only record that the operator ever existed.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import {
  platformUserIdParamSchema,
  updatePlatformUserSchema,
} from "@/lib/validations/platform";
import {
  getPlatformUser,
  logPlatformUserEvent,
  updatePlatformUser,
} from "@/lib/services/platformUser.service";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// GET
// ACCESS     : PLATFORM_ADMIN (platform session — W1.2)
// VALIDATION : platformUserIdParamSchema — the [id] segment must be a non-empty
//              string once trimmed. No cuid shape is asserted: the id is an
//              opaque key, and asserting a format would turn an
//              unrecognised-but-well-formed id into a 400 when 404 is accurate.
// FLOW       : Authorise → validate the route param → read the operator by
//              primary key → return it, or NOT_FOUND.
// RESPONSE   : { success: true, data: <PlatformUser without passwordHash> }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    // Route params resolve asynchronously in this Next.js version.
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

    const user = await getPlatformUser(parsed.data.id);

    if (!user) {
      return NextResponse.json(fail("Platform user not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(user));
  } catch (err) {
    console.error("[GET /api/platform/users/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : PLATFORM_ADMIN (platform session — W1.2)
// VALIDATION : platformUserIdParamSchema for the [id] segment,
//              updatePlatformUserSchema for the body. Every field is optional
//              but at least one is required. isActive is accepted here — this
//              is the activation/deactivation endpoint, and a second route for
//              it would be the same write behind a different name.
// FLOW       : Authorise → validate param and body → service loads the operator
//              (404 if absent), re-checks email uniqueness ONLY when the address
//              is actually changing, and replaces the role grant inside one
//              transaction when a role was supplied.
// RESPONSE   : { success: true, data: <PlatformUser>, message: "Platform user updated" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
// WHAT THIS ROUTE REFUSES TO CHANGE
//   id, createdAt, updatedAt and lastLoginAt are generated columns and are not
//   in the schema. passwordHash is not either — POST .../reset-password owns it,
//   so there is no path by which one operator sets another's password to a
//   value they choose. There is no tenantId on this model to protect: platform
//   identities have none, which is what makes the W1.1 escalation
//   unrepresentable rather than merely blocked.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsedParams = platformUserIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParams.error),
        },
        { status: 400 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = updatePlatformUserSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedBody.error),
        },
        { status: 400 }
      );
    }

    // Deactivating yourself would take the console away mid-request and, if you
    // were the last active operator, leave the platform with nobody who can
    // undo it — there is no self-service route back in. Refused rather than
    // warned about: the caller has another operator's account for this.
    if (parsedBody.data.isActive === false && parsedParams.data.id === guard.platformUserId) {
      return NextResponse.json(
        fail("You cannot deactivate your own account", "CONFLICT"),
        { status: 409 }
      );
    }

    const result = await updatePlatformUser(parsedParams.data.id, parsedBody.data);

    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return NextResponse.json(fail("Platform user not found", "NOT_FOUND"), { status: 404 });
      }
      if (result.error === "EMAIL_TAKEN") {
        return NextResponse.json(fail("Email already in use", "CONFLICT"), { status: 409 });
      }
      console.error("[PATCH /api/platform/users/[id]] PLATFORM_ADMIN role row is missing");
      return NextResponse.json(
        fail("Platform roles are not configured", "SERVER_ERROR"),
        { status: 500 }
      );
    }

    // An activation change is recorded as itself rather than as a generic
    // update — it is the entry an investigator actually looks for.
    const action =
      parsedBody.data.isActive === undefined
        ? "updated"
        : parsedBody.data.isActive
          ? "activated"
          : "deactivated";
    logPlatformUserEvent(action, guard.platformUserId, result.value.id);

    return NextResponse.json(ok(result.value, "Platform user updated"));
  } catch (err) {
    console.error("[PATCH /api/platform/users/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
