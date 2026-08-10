// ============================================================================
// OWNER  : Gauransh
// MODULE : AI Assisted Internal Assessment (Phase 25)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → validate query →
//          controller → response.
// ACCESS : INTERNAL_ASSESSMENT_ROLES — FACULTY · DEPARTMENT_HOD · HOD ·
//          UNIVERSITY_ADMIN.
// BACKEND: internalAssessmentController → InternalAssessmentService →
//          InternalAssessmentRepository → AuditLog → Prisma.
// PURPOSE: The README's "Audit history" — every generation and every faculty
//          decision recorded for one student.
//
// THIS READS AuditLog, NOT A PHASE-25 TABLE
//   InternalAssessmentSuggestion holds only the CURRENT state of each
//   (student, course, semester, component) — regenerating updates it in place.
//   The SEQUENCE of what was proposed and what was awarded lives in the shared
//   AuditLog, written inside the same transaction as each change. That is why
//   the trail survives a suggestion being regenerated after a decision.
//
//   AuditLog has no studentId column, so the student filter is applied against
//   the `after` snapshot the service writes. That snapshot exists precisely so
//   this filtering is possible.
//
// BOTH DIRECTIONS ARE RECORDED
//   A trail holding only overrides could not answer "what did the model
//   propose", which is exactly the question an appeal against an internal mark
//   raises.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { internalAssessmentController } from "@/lib/controllers/internalAssessment.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { INTERNAL_ASSESSMENT_ROLES } from "@/lib/constants/internalAssessment";
import {
  internalAssessmentQuerySchema,
  internalAssessmentStudentParamSchema,
} from "@/lib/validations/internalAssessment.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/internal-assessment/audit/[studentId]";

type RouteContext = { params: Promise<{ studentId: string }> };

// GET
// ACCESS     : requireRole(INTERNAL_ASSESSMENT_ROLES) then requireTenant.
// VALIDATION : internalAssessmentStudentParamSchema for the path;
//              internalAssessmentQuerySchema for optional courseId and
//              semesterId.
// FLOW       : Guard → validate → controller.
//
//              Bounded at 200 entries, newest first. Ordering is createdAt then
//              id, both descending — the id tiebreaker is required for
//              correctness rather than presentation, because a bulk generation
//              writes its entries within one millisecond.
//
//              Only this module's entries are visible: the query is filtered to
//              resource = "InternalAssessmentSuggestion", so a Phase 25 audit
//              view can never surface another module's history.
// REPORTS    : Entries exactly as stored, including their before/after
//              snapshots. Nothing is derived and nothing is reshaped — an audit
//              record rewritten on the way out is evidence of what the reader
//              wanted rather than of what happened.
//
//              `actorId` is a bare id. AuditLog.userId carries no foreign key
//              and AuditLog declares no `user` relation, so there is nothing to
//              traverse; a caller resolves the name through GET /api/users/[id].
// RESPONSE   : { success: true, data: { entries } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
//              This handler performs no writes of any kind.
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...INTERNAL_ASSESSMENT_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = internalAssessmentStudentParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const parsedQuery = internalAssessmentQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const entries = await internalAssessmentController.getAudit(
      tenantGuard.tenant.id,
      parsedParam.data.studentId,
      parsedQuery.data
    );

    return NextResponse.json(ok({ entries }));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
