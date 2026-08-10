// ============================================================================
// OWNER  : Gauransh
// MODULE : AI Assisted Internal Assessment (Phase 25)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → parse body → validate → controller →
//          response.
// ACCESS : INTERNAL_ASSESSMENT_ROLES — FACULTY · DEPARTMENT_HOD · HOD ·
//          UNIVERSITY_ADMIN. STUDENT is absent everywhere in this module: a
//          suggestion is deliberative material ABOUT a student, not a result
//          they hold, and Phase 21's matrix lists "Modify Internal Assessment"
//          among the things a student cannot do.
// BACKEND: internalAssessmentController → InternalAssessmentService →
//          internal-assessment domain → InternalAssessmentRepository + Groq.
// PURPOSE: The README's "Generate AI suggestions".
//
// THE SUGGESTION IS DETERMINISTIC. THE AI IS THE EXPLANATION.
//   Every numeric suggestion is computed from the university's OWN Phase 16
//   component weightages BEFORE any provider is contacted. Groq is asked only
//   for a written rationale, only when ?withRationale is set, and a provider
//   failure — missing key, timeout, error — leaves every suggestion completely
//   intact with a null rationale.
//
//   That ordering is the whole design. A mark that depended on a remote model's
//   availability would be unreproducible and unfair: two students assessed
//   minutes apart could be judged by different reasoning.
//
// NOTHING HERE AWARDS A MARK
//   This writes InternalAssessmentSuggestion rows with `finalMarks` NULL. A
//   human sets that through PATCH /api/internal-assessment/[studentId], and
//   publishing an accepted mark into a student's result remains Phase 16's
//   operation. The README is explicit that the final decision stays with the
//   faculty, and the schema enforces it by leaving the column null.
//
// A STUDENT WITH NO EVIDENCE GETS A NULL SUGGESTION, NOT A ZERO
//   Recommending zero marks for someone the system knows nothing about is the
//   single most damaging thing this feature could do. `withoutEvidence` in the
//   response counts them so a faculty member can see who needs manual attention.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { internalAssessmentController } from "@/lib/controllers/internalAssessment.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { readRequestOrigin } from "@/lib/middleware/requireAttendanceLockAccess";
import { INTERNAL_ASSESSMENT_ROLES } from "@/lib/constants/internalAssessment";
import { generateSuggestionsSchema } from "@/lib/validations/internalAssessment.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "POST /api/internal-assessment/generate";

// POST
// ACCESS     : requireRole(INTERNAL_ASSESSMENT_ROLES) then requireTenant.
// VALIDATION : generateSuggestionsSchema, .strict(). courseId, semesterId and
//              componentId required — a scheme may carry several internal
//              components, and generating "an internal mark" without saying
//              which would produce a row no later read could interpret.
//
//              suggestedMarks, confidence and generatedById are ABSENT and
//              therefore refused with 400. All three are derived server-side,
//              and a client quietly ignored would keep believing it had set the
//              model's own suggestion while the audit trail said otherwise.
// FLOW       : Guard → parse → validate → controller.
//
//              The cohort is bounded at INTERNAL_ASSESSMENT_GENERATE_LIMIT and
//              `truncated` reports when the bound was reached — a partial run
//              presented as complete would leave students silently unassessed.
//
//              Evidence is read in FOUR GROUPED statements across the whole
//              cohort, so a three-hundred-student run costs six reads rather
//              than twelve hundred. Every upsert and the audit entry share one
//              transaction, so a partially-generated cohort cannot be recorded
//              as complete.
//
//              The provider, if used, is contacted ONCE for the run and the
//              prompt carries no student identifier, name or mark — a rationale
//              explains the METHOD, not an individual.
// RESPONSE   : { success: true, data: GenerateSuggestionsResultDto }
// STATUS     : 201 · 400 · 401 · 403 · 404 · 500
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole(...INTERNAL_ASSESSMENT_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsed = generateSuggestionsSchema.safeParse(body);
    if (!parsed.success) return validationFailure(parsed.error);

    const origin = readRequestOrigin(request.headers);

    const result = await internalAssessmentController.generate(
      tenantGuard.tenant.id,
      parsed.data,
      {
        userId: guard.session.sub,
        ipAddress: origin.ipAddress,
        userAgent: origin.userAgent,
      },
      new Date()
    );

    return NextResponse.json(ok(result, "Internal assessment suggestions generated"), {
      status: 201,
    });
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
