// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Profile & Performance Analytics (Phase 23)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → validate body → controller
//          → response.
// ACCESS : FACULTY_PROFILE_ROLES at the role gate; the DATA gate is narrower —
//          a FACULTY caller reaches only their own record, an administrative
//          caller reaches anyone in their tenant. See
//          lib/middleware/requireFacultyProfileAccess.ts.
// BACKEND: facultyProfileController → FacultyProfileService →
//          FacultyProfileRepository → Prisma.
// PURPOSE: Read and edit a faculty member's profile — photo, faculty number,
//          qualification, designation, department, experience, publications,
//          certifications and education history.
//
// THIS PATH DOES NOT COLLIDE WITH PHASE 7's /api/faculty/[id]
//   `profile` is a static segment and `[id]` is dynamic, so Next.js resolves
//   /api/faculty/profile/<id> here and never treats "profile" as a faculty id.
//   The same arrangement already works for /api/attendance/analytics.
//
// WHAT THIS ENDPOINT DELIBERATELY CANNOT CHANGE
//   employeeId, departmentId, userId and status are absent from the schema, so
//   a faculty member editing their own profile cannot move themselves to
//   another department, renumber themselves or reactivate a terminated record.
//   Those are Phase 7 administrative operations with their own route
//   (PATCH /api/faculty/[id]), which this phase does not duplicate or replace.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { facultyProfileController } from "@/lib/controllers/facultyProfile.controller";
import { requireFacultyProfileAccess } from "@/lib/middleware/requireFacultyProfileAccess";
import {
  facultyIdParamSchema,
  updateFacultyProfileSchema,
} from "@/lib/validations/facultyProfile.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

type RouteContext = { params: Promise<{ facultyId: string }> };

// GET
// ACCESS     : requireFacultyProfileAccess. A faculty member reading another
//              member's id receives the SAME 404 as an unknown id, so neither
//              answer confirms the existence of the other.
// VALIDATION : facultyIdParamSchema. No format is asserted on the id —
//              asserting one turns an unrecognised-but-well-formed id into a
//              400 when 404 is the accurate answer.
// FLOW       : Guard → validate param → controller.
// REPORTS    : The whole profile in one statement, with the three histories
//              nested. publishedOn and issuedOn are rendered as calendar days
//              rather than instants, so a client cannot apply a timezone and
//              land a day early on a publication date.
// RESPONSE   : { success: true, data: FacultyProfileDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(_request: NextRequest, context: RouteContext) {
  const SCOPE = "GET /api/faculty/profile/[facultyId]";

  try {
    const guard = await requireFacultyProfileAccess();
    if (!guard.granted) return guard.response;

    const parsedParam = facultyIdParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const profile = await facultyProfileController.getProfile(
      guard.access,
      parsedParam.data.facultyId
    );

    return NextResponse.json(ok(profile));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

// PATCH
// ACCESS     : requireFacultyProfileAccess — a faculty member edits only their
//              own record; a lecturer must not rewrite a colleague's
//              qualifications.
// VALIDATION : updateFacultyProfileSchema, .strict(). Every field is optional,
//              so an empty body is a no-op rather than a 400 — a form that
//              submits only dirty fields must not fail on the one occasion
//              nothing was edited.
//
//              URLs are validated as URLs. TD-C21 records that
//              Certificate.pdfUrl accepts any value including a `javascript:`
//              URI, and any UI rendering it as a link inherits an
//              unvalidated-redirect surface. A profile photo and a publication
//              link are both rendered as links; this phase does not repeat it.
// FLOW       : Guard → validate param → parse → validate body → controller.
//
//              The three child collections are REPLACED WHOLESALE when supplied
//              and left untouched when omitted. `undefined` means "leave
//              alone"; `[]` means "empty it". TD-C13 records the silent
//              data-loss path a partial merge creates, so replacement is total
//              and explicit rather than inferred.
//
//              The profile update and every collection replacement share ONE
//              transaction: a profile whose publications were deleted but not
//              recreated is data loss with no error.
// RESPONSE   : { success: true, data: FacultyProfileDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function PATCH(request: NextRequest, context: RouteContext) {
  const SCOPE = "PATCH /api/faculty/profile/[facultyId]";

  try {
    const guard = await requireFacultyProfileAccess();
    if (!guard.granted) return guard.response;

    const parsedParam = facultyIdParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = updateFacultyProfileSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const profile = await facultyProfileController.updateProfile(
      guard.access,
      parsedParam.data.facultyId,
      parsedBody.data
    );

    return NextResponse.json(ok(profile, "Faculty profile updated"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
