// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Operator Settings (self-service)
// FLOW   : requirePlatformAdmin() → resolve the operator from the SESSION →
//          read or update their own record.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// BACKEND: Reads and writes the EXISTING PlatformUser model through
//          lib/services/platformUser.service.ts. No new model, no new column,
//          and no direct Prisma access from this file.
// PURPOSE: Back the Super Admin Settings screen.
//
// THE SUBJECT IS THE SESSION, NEVER THE REQUEST
//   Both handlers act on guard.platformUserId — the id requirePlatformAdmin
//   resolved by re-reading PlatformUser for the authenticated subject. Nothing
//   in the path, the query or the body can name a different operator, so there
//   is no self-service route by which one Super Admin reaches another's
//   account. Editing somebody ELSE remains PATCH /api/platform/users/[id],
//   which is where the role and activation controls live.
//
// WHAT THIS ROUTE DELIBERATELY DOES NOT DO
//   It does not change a password. That already has a working endpoint —
//   POST /api/super-admin/auth/change-password — which verifies the current
//   password before accepting a new one and clears mustChangePassword as it
//   goes. Duplicating it here would be a second place for that logic to drift,
//   and the Settings screen calls the existing one.
//
//   It does not touch role, isActive or email. updateOwnPlatformProfileSchema
//   does not define those keys and is .strict(), so an attempt is a 400 rather
//   than a silent drop.
//
//   passwordHash is not selectable through the service's projection, so it
//   cannot be returned by either handler.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import {
  getPlatformUser,
  logPlatformUserEvent,
  updatePlatformUser,
} from "@/lib/services/platformUser.service";
import { updateOwnPlatformProfileSchema } from "@/lib/validations/platform";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// GET
// ACCESS     : PLATFORM_ADMIN. A tenant session carries no edu_platform cookie,
//              so it resolves to no platform session and receives the guard's
//              401 — the same answer an anonymous caller gets. A platform
//              operator whose password was generated for them is refused with
//              PASSWORD_CHANGE_REQUIRED, exactly as every other platform route
//              refuses them; the forced-change flow is unchanged.
// VALIDATION : None. There is nothing to validate — the handler takes no input
//              at all, which is the point.
// FLOW       : Authorise → read the operator's own record → respond.
// RESPONSE   : { success: true, data: { operator } }
// STATUS     : 200 OK · 401 UNAUTHORIZED · 403 FORBIDDEN · 404 NOT_FOUND ·
//              500 SERVER_ERROR
export async function GET() {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    // The guard already proved this row exists and is active; re-reading it
    // here is what supplies the full projection the screen renders. A null is
    // therefore a row deleted between the two reads, not an ordinary state.
    const operator = await getPlatformUser(guard.platformUserId);

    if (!operator) {
      return NextResponse.json(fail("Operator not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok({ operator }));
  } catch (err) {
    console.error("[GET /api/super-admin/settings]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : PLATFORM_ADMIN, acting on themselves and only themselves.
// VALIDATION : updateOwnPlatformProfileSchema — firstName and/or lastName, both
//              optional but at least one required. .strict(), so role,
//              isActive, email or any id in the body is a 400 VALIDATION_ERROR
//              rather than a value that gets quietly ignored.
// FLOW       : Authorise → validate → update the SESSION's own row → respond.
// RESPONSE   : { success: true, data: { operator } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              No 409. EMAIL_TAKEN is unreachable because this route cannot
//              change an email, and ROLE_UNAVAILABLE because it cannot change a
//              role — both are handled by the service for its administrative
//              caller and neither can be provoked from here.
export async function PATCH(request: NextRequest) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        fail("Request body must be valid JSON", "VALIDATION_ERROR"),
        { status: 400 }
      );
    }

    const parsed = updateOwnPlatformProfileSchema.safeParse(body);
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

    // guard.platformUserId, never an id from the request. The service's wider
    // input type accepts role and isActive; neither can appear here because the
    // schema above cannot produce them.
    const result = await updatePlatformUser(guard.platformUserId, parsed.data);

    if (!result.ok) {
      return NextResponse.json(fail("Operator not found", "NOT_FOUND"), { status: 404 });
    }

    // Same catalogue and same shape as every other platform-user event. actor
    // and subject are the same person, which is what a self-service edit is.
    // Names are not written to the line — only the two ids — and no password,
    // token or cookie is anywhere near this call.
    logPlatformUserEvent("updated", guard.platformUserId, guard.platformUserId);

    return NextResponse.json(ok({ operator: result.value }));
  } catch (err) {
    console.error("[PATCH /api/super-admin/settings]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
