// ============================================================================
// OWNER  : Gauransh
// MODULE : AI Assisted Internal Assessment (Phase 25)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → validate query →
//          controller → response.
// ACCESS : INTERNAL_ASSESSMENT_ROLES — FACULTY · DEPARTMENT_HOD · HOD ·
//          UNIVERSITY_ADMIN.
//
//          THE STUDENT THEMSELVES CANNOT READ THIS, DELIBERATELY.
//          A suggestion is deliberative material — what a model proposed before
//          a human decided — and exposing it would let a student argue with a
//          draft rather than with the mark they were awarded. Phase 21's matrix
//          gives students "View Results", which is Phase 16's endpoint and
//          reports what was actually awarded.
// BACKEND: internalAssessmentController → InternalAssessmentService →
//          InternalAssessmentRepository → Prisma.
// PURPOSE: The README's "Student internal marks" — every suggestion held for
//          one student, with the decision taken on each.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { internalAssessmentController } from "@/lib/controllers/internalAssessment.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { resolveDepartmentId } from "@/lib/auth/departmentScope";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { INTERNAL_ASSESSMENT_ROLES } from "@/lib/constants/internalAssessment";
import {
  internalAssessmentQuerySchema,
  internalAssessmentStudentParamSchema,
} from "@/lib/validations/internalAssessment.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/internal-assessment/student/[studentId]";

type RouteContext = { params: Promise<{ studentId: string }> };

// GET
// ACCESS     : requireRole(INTERNAL_ASSESSMENT_ROLES) then requireTenant.
// VALIDATION : internalAssessmentStudentParamSchema for the path;
//              internalAssessmentQuerySchema for optional courseId and
//              semesterId, so one endpoint answers both "everything for this
//              student" and "this student in this course this semester".
// FLOW       : Guard → validate → controller.
//
//              Every read is filtered by the resolved tenant, so a studentId
//              belonging to another university returns an empty list rather
//              than another tenant's suggestions.
// REPORTS    : Each suggestion with the evidence it was computed from, the
//              confidence, and — once a faculty member has decided — the
//              awarded mark, the reason, and whether it differs from the
//              proposal. `isOverridden` is derived so a reader need not do the
//              comparison themselves; an appeal against an internal mark asks
//              exactly that question.
//
//              `confidence` is DATA COMPLETENESS, not a probability that the
//              suggestion is correct. See the DTO.
// RESPONSE   : { success: true, data: { suggestions } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
//              This handler performs no writes of any kind.
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...INTERNAL_ASSESSMENT_ROLES);
    if (!guard.authorized) return guard.response;

    // INTERNAL_ASSESSMENT_ROLES admits both spellings of head of department,
    // and this surface WRITES marks. Resolved from the authenticated subject,
    // so a head submitting another department's courseId or studentId is
    // refused rather than served.
    const scope = await resolveDepartmentId(guard.session);
    if (!scope.ok) return scope.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = internalAssessmentStudentParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const parsedQuery = internalAssessmentQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const suggestions = await internalAssessmentController.getForStudent(
      tenantGuard.tenant.id,
      parsedParam.data.studentId,
      parsedQuery.data,
      scope.departmentId
    );

    return NextResponse.json(ok({ suggestions }));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
