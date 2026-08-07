// ============================================================================
// OWNER  : Gauransh
// MODULE : Assignment Management Enhancement (Phase 24)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate query → controller → response.
// ACCESS : ASSIGNMENT_ANALYTICS_ROLES — FACULTY · DEPARTMENT_HOD · HOD ·
//          UNIVERSITY_ADMIN.
// BACKEND: assignmentLifecycleController → AssignmentLifecycleService →
//          assignment-analytics domain → AssignmentLifecycleRepository → Prisma.
// PURPOSE: The README's "Assignment Analytics" — submission rates, grading
//          progress and mark distribution across a course, a section, or one
//          assignment.
//
// THIS PATH DOES NOT COLLIDE WITH /api/assignments/[id]
//   `analytics` is a static segment and `[id]` is dynamic, so Next.js resolves
//   /api/assignments/analytics here and never treats "analytics" as an
//   assignment id. The same arrangement already works for
//   /api/attendance/analytics.
//
// RATES ARE RECOMPUTED FROM TOTALS, NEVER AVERAGED
//   The headline submission rate is submittedTotal / cohortTotal, not the mean
//   of each assignment's own rate. Averaging percentages would weight a
//   five-student assignment the same as a five-hundred-student one, so the
//   figure would describe the number of assignments rather than the number of
//   students.
//
// THE COHORT IS READ ONCE PER DISTINCT (COURSE, SECTION) PAIR
//   A course with twelve assignments for one section shares one cohort; twelve
//   identical counts would be eleven wasted round trips. Submissions travel
//   with their assignments through a nested select, so the whole aggregate is
//   one statement plus one count per distinct pair.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { assignmentLifecycleController } from "@/lib/controllers/assignmentLifecycle.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { ASSIGNMENT_ANALYTICS_ROLES } from "@/lib/constants/assignmentLifecycle";
import { assignmentAnalyticsQuerySchema } from "@/lib/validations/assignmentLifecycle.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/assignments/analytics";

// GET
// ACCESS     : requireRole(ASSIGNMENT_ANALYTICS_ROLES) then requireTenant.
// VALIDATION : assignmentAnalyticsQuerySchema — optional assignmentId, courseId
//              and sectionId. .strict(), so an unrecognised parameter is a 400
//              rather than an inert filter the caller believes was applied.
//
//              Every filter omitted means the whole tenant, bounded by
//              ASSIGNMENT_ANALYTICS_LIMIT.
// FLOW       : Guard → validate → controller.
//
//              The read is BOUNDED and the bound is VISIBLE: limit+1 rows are
//              fetched so truncation is detected without a second count query,
//              and `totals.truncated` reports it. A partial aggregate presented
//              as a total would be worse than a stated bound.
// REPORTS    : Per assignment — cohort size, submitted, pending, late and
//              graded counts, submission rate, grading progress, average mark
//              as a percentage of that assignment's own maximum, and the mark
//              extremes. Plus the tenant-level totals.
//
//              PENDING is derived from the registered cohort, not counted from
//              submission rows, so it agrees exactly with what
//              /api/assignments/[id]/pending lists.
//
//              Every rate is `number | null`. An assignment nobody was
//              registered for has no submission rate, and a fabricated 0% would
//              surface it as the worst-performing assignment on a sorted list.
// RESPONSE   : { success: true, data: { totals, assignments } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
//              This handler performs no writes of any kind.
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole(...ASSIGNMENT_ANALYTICS_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsed = assignmentAnalyticsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) return validationFailure(parsed.error);

    const analytics = await assignmentLifecycleController.getAnalytics(
      tenantGuard.tenant.id,
      parsed.data
    );

    return NextResponse.json(ok(analytics));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
