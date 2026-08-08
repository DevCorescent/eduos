// ============================================================================
// OWNER  : Gauransh
// MODULE : Assignment Management Enhancement (Phase 24)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → validate query →
//          controller → response.
// ACCESS : ASSIGNMENT_ANALYTICS_ROLES — FACULTY · DEPARTMENT_HOD · HOD ·
//          UNIVERSITY_ADMIN. STUDENT is absent: a roster of who has not
//          submitted is a list of a student's peers, which no student needs.
// BACKEND: assignmentLifecycleController → AssignmentLifecycleService →
//          AssignmentLifecycleRepository → Prisma.
// PURPOSE: The README's "Pending Students" — who was supposed to submit and
//          has not.
//
// PENDING IS ANSWERED FROM REGISTRATIONS, NOT FROM SUBMISSION ROWS
//   A student who has not submitted usually has NO submission row at all, so
//   there is nothing to count. The question is only answerable against the
//   cohort that was supposed to submit, which is CourseRegistration — narrowed
//   to the assignment's section when it names one, because an assignment set
//   for Section A must not report Section B as pending.
//
//   The query is expressed as a registration read with a NOT-EXISTS on
//   submissions rather than by loading the cohort and subtracting in memory: a
//   five-hundred-student course would otherwise transfer five hundred rows to
//   produce one page of fifty.
//
//   A student holding a PENDING placeholder row counts as pending, because
//   PENDING is the column's default and means exactly that.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { assignmentLifecycleController } from "@/lib/controllers/assignmentLifecycle.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { ASSIGNMENT_ANALYTICS_ROLES } from "@/lib/constants/assignmentLifecycle";
import {
  assignmentLifecycleParamSchema,
  assignmentRosterQuerySchema,
} from "@/lib/validations/assignmentLifecycle.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/assignments/[id]/pending";

type RouteContext = { params: Promise<{ id: string }> };

// GET
// ACCESS     : requireRole(ASSIGNMENT_ANALYTICS_ROLES) then requireTenant.
// VALIDATION : assignmentLifecycleParamSchema for [id];
//              assignmentRosterQuerySchema for ?page and ?limit (default 50,
//              max 200). Paginated because a first-year core course carries
//              several hundred students.
// FLOW       : Guard → validate → controller.
//
//              The assignment is resolved tenant-scoped first, so an unknown or
//              foreign id is a 404 before any roster work happens.
//
//              The page and its total are read in one transaction, so the count
//              cannot describe a wider set than the page.
// REPORTS    : Each student named — enrolment number, display name and email —
//              rather than as a bare cuid a faculty member cannot act on.
// RESPONSE   : { success: true, data: { rows, pagination } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
//              This handler performs no writes of any kind.
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...ASSIGNMENT_ANALYTICS_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = assignmentLifecycleParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const parsedQuery = assignmentRosterQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const result = await assignmentLifecycleController.getPending(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedQuery.data
    );

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
