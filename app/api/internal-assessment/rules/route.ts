// ============================================================================
// OWNER  : Gauransh
// MODULE : AI Assisted Internal Assessment (Phase 25)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate query → controller → response.
// ACCESS : INTERNAL_ASSESSMENT_ROLES — FACULTY · DEPARTMENT_HOD · HOD ·
//          UNIVERSITY_ADMIN. Exactly the three the README names, plus the
//          project-wide UNIVERSITY_ADMIN.
// BACKEND: internalAssessmentController → InternalAssessmentService →
//          InternalAssessmentRepository → Prisma.
// PURPOSE: The README's "University marking rules".
//
// THE RULES ARE PHASE 16's, READ — NOT A SEPARATE STORE
//   This endpoint reports the ACTIVE EvaluationScheme's components and their
//   configured weightages. There is deliberately no InternalAssessmentRule
//   model: a university that has configured "internal assessment is 40%
//   assignments, 30% quizzes, 30% attendance" has already stated its rule, and
//   a second store would be free to contradict it with no way to tell which one
//   the engine actually used.
//
//   The scheme is resolved through CourseRegistration.evaluationSchemeId, which
//   is exactly the "which regulation applies here" question Phase 16 already
//   answered. Nothing here re-answers it.
//
// WHY courseId AND semesterId ARE REQUIRED
//   A tenant may run several regulations at once — a 2023 scheme and a 2025
//   scheme, for different intakes. "What are the marking rules" has no answer
//   without saying for what.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { internalAssessmentController } from "@/lib/controllers/internalAssessment.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { resolveDepartmentId } from "@/lib/auth/departmentScope";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { INTERNAL_ASSESSMENT_ROLES } from "@/lib/constants/internalAssessment";
import { internalAssessmentRulesQuerySchema } from "@/lib/validations/internalAssessment.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/internal-assessment/rules";

// GET
// ACCESS     : requireRole(INTERNAL_ASSESSMENT_ROLES) then requireTenant.
// VALIDATION : internalAssessmentRulesQuerySchema — courseId and semesterId
//              both REQUIRED, .strict().
// FLOW       : Guard → validate → controller.
//
//              404 when no ACTIVE scheme governs the course-semester. That is
//              the correct answer rather than an empty list: proceeding with no
//              rules would mean inventing weights, which is precisely what this
//              phase refuses to do.
// REPORTS    : Each component with its code, name, type, source, maximum, the
//              university's own weightage, and which evidence signal it
//              contributes.
//
//              `unmappedComponents` lists components that carry weight but map
//              to no observable signal — a VIVA or a SEMINAR has no table to
//              read. Surfaced explicitly because they are the reason a
//              confidence figure may be lower than a faculty member expects.
// RESPONSE   : { success: true, data: MarkingRulesDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
//              This handler performs no writes of any kind.
export async function GET(request: NextRequest) {
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

    const parsed = internalAssessmentRulesQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) return validationFailure(parsed.error);

    const rules = await internalAssessmentController.getRules(
      tenantGuard.tenant.id,
      parsed.data,
      scope.departmentId
    );

    return NextResponse.json(ok(rules));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
