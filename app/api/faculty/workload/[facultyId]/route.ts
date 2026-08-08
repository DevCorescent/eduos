// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Profile & Performance Analytics (Phase 23)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → validate query →
//          controller → response.
// ACCESS : FACULTY_PROFILE_ROLES at the role gate, narrowed at the data gate —
//          a FACULTY caller reaches only their own record.
// BACKEND: facultyProfileController → FacultyProfileService →
//          FacultyProfileRepository → Prisma.
// PURPOSE: What a faculty member is responsible for teaching — the README's
//          "Subjects Teaching", "Weekly Timetable", "Lecture Count" and
//          "Student Count".
//
// EVERY FIGURE HERE IS A COUNT, NOT A JUDGEMENT
//   Workload reports what exists: distinct courses, distinct sections, weekly
//   slots by session type, and how many students are registered for the courses
//   this member teaches. No figure is weighted against another and no target is
//   asserted — the README defines no workload norm, so this endpoint reports and
//   does not evaluate.
//
// ONLY ACTIVE ROWS COUNT TOWARDS THE SUMMARY
//   FacultyCourseAssignment and Timetable both carry isActive, and a withdrawn
//   assignment is not current workload. The full list is still returned with
//   its isActive flag, so a client can show history; the SUMMARY counts only
//   what is live.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { facultyProfileController } from "@/lib/controllers/facultyProfile.controller";
import { requireFacultyProfileAccess } from "@/lib/middleware/requireFacultyProfileAccess";
import {
  facultyIdParamSchema,
  facultyScopeQuerySchema,
} from "@/lib/validations/facultyProfile.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/faculty/workload/[facultyId]";

type RouteContext = { params: Promise<{ facultyId: string }> };

// GET
// ACCESS     : requireFacultyProfileAccess.
// VALIDATION : facultyIdParamSchema for the path; facultyScopeQuerySchema for
//              ?semesterId. .strict(), so an unrecognised parameter is a 400
//              rather than an inert filter the caller believes was applied.
//
//              An omitted semester means EVERYTHING the member has ever taught.
//              That is the honest default: inventing a "current semester" would
//              mean picking one, and the schema permits more than one semester
//              marked current across different academic years.
// FLOW       : Guard → validate → controller.
//
//              Assignments and the timetable are read CONCURRENTLY; the student
//              count depends on the assignments and follows them. Three
//              statements in total, none inside a loop.
// REPORTS    : The summary, the student count, the course list and the weekly
//              timetable ordered by day then start time, so a client renders a
//              week without sorting.
// RESPONSE   : { success: true, data: FacultyWorkloadDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
//              This handler performs no writes of any kind.
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireFacultyProfileAccess();
    if (!guard.granted) return guard.response;

    const parsedParam = facultyIdParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const parsedQuery = facultyScopeQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const workload = await facultyProfileController.getWorkload(
      guard.access,
      parsedParam.data.facultyId,
      parsedQuery.data
    );

    return NextResponse.json(ok(workload));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
