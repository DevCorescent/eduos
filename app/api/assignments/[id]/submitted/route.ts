// ============================================================================
// OWNER  : Gauransh
// MODULE : Assignment Management Enhancement (Phase 24)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → validate query →
//          controller → response.
// ACCESS : ASSIGNMENT_ANALYTICS_ROLES — FACULTY · DEPARTMENT_HOD · HOD ·
//          UNIVERSITY_ADMIN.
// BACKEND: assignmentLifecycleController → AssignmentLifecycleService →
//          AssignmentLifecycleRepository → Prisma.
// PURPOSE: The README's "View Submitted Students" — who has submitted, when,
//          and what they were awarded.
//
// SUBMITTED MEANS SUBMITTED, LATE OR GRADED
//   PENDING is deliberately excluded. It is the column's DEFAULT and means the
//   opposite: a placeholder for a student who has not acted. Counting it would
//   report a cohort as fully submitted the moment placeholder rows existed.
//
// EACH ROW CARRIES ITS RESUBMISSION COUNT
//   `previousAttempts` is the number of superseded versions behind the current
//   submission, so a faculty member can see at a glance that a student
//   resubmitted — and follow it up — without a second request per row. It is
//   read as a relation count in the same statement, not as an N+1.
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

const SCOPE = "GET /api/assignments/[id]/submitted";

type RouteContext = { params: Promise<{ id: string }> };

// GET
// ACCESS     : requireRole(ASSIGNMENT_ANALYTICS_ROLES) then requireTenant.
// VALIDATION : assignmentLifecycleParamSchema for [id];
//              assignmentRosterQuerySchema for ?page and ?limit.
// FLOW       : Guard → validate → controller.
//
//              Ordering is submittedAt then id, both descending. The id
//              tiebreaker is required for CORRECTNESS rather than presentation:
//              offset pagination over rows sharing a value can repeat or skip
//              entries across pages, and submittedAt is nullable so a batch of
//              placeholder rows shares a null.
//
//              Ownership is anchored through `assignment: { tenantId }` because
//              AssignmentSubmission carries no tenantId column of its own — it
//              is one of the two models in the schema storing tenant-owned data
//              without one (TD-A).
// REPORTS    : Each student named, their status, submission time, awarded mark,
//              feedback, attachments as stored, and how many earlier attempts
//              they made.
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

    const result = await assignmentLifecycleController.getSubmitted(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedQuery.data
    );

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
