// ============================================================================
// OWNER  : Gauransh
// MODULE : AI Assisted Internal Assessment (Phase 25)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → parse body → validate →
//          controller → response.
// ACCESS : INTERNAL_ASSESSMENT_ROLES — FACULTY · DEPARTMENT_HOD · HOD ·
//          UNIVERSITY_ADMIN.
// BACKEND: internalAssessmentController → InternalAssessmentService →
//          InternalAssessmentRepository + AuditLogRepository → Prisma.
// PURPOSE: The README's "Faculty update" — the human decision on a suggestion.
//
// THIS IS THE ENDPOINT THAT MAKES THE PHASE HONEST
//   The README is explicit that internal marking rules are the university's and
//   that "faculty can override AI suggestions within the allowed range". Every
//   other endpoint in this module proposes; this one decides. Until it is
//   called, `finalMarks` is NULL and no mark exists.
//
// A REASON IS REQUIRED ONLY WHEN THE AWARDED MARK DIFFERS
//   Accepting a proposal needs no justification; departing from one does. The
//   schema cannot express "required only when they differ" — a CHECK constraint
//   would have to compare two nullable columns — so the rule lives in the
//   service, and the model's own comment records the gap rather than leaving it
//   implicit.
//
// THIS ROUTE DOES NOT PUBLISH A RESULT
//   It writes InternalAssessmentSuggestion.finalMarks and an audit entry.
//   Moving an accepted mark into StudentComponentScore remains Phase 16's
//   operation through its own endpoints, untouched by this phase — so a
//   decision here can be reviewed before it becomes part of a student's result.
//
// THIS PATH DOES NOT COLLIDE WITH ITS SIBLINGS
//   `rules`, `generate`, `student` and `audit` are static segments and
//   `[studentId]` is dynamic, so Next.js resolves each of those four before
//   treating a segment as a student id.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { internalAssessmentController } from "@/lib/controllers/internalAssessment.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { readRequestOrigin } from "@/lib/middleware/requireAttendanceLockAccess";
import { INTERNAL_ASSESSMENT_ROLES } from "@/lib/constants/internalAssessment";
import {
  decideInternalAssessmentSchema,
  internalAssessmentStudentParamSchema,
} from "@/lib/validations/internalAssessment.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "PATCH /api/internal-assessment/[studentId]";

type RouteContext = { params: Promise<{ studentId: string }> };

// PATCH
// ACCESS     : requireRole(INTERNAL_ASSESSMENT_ROLES) then requireTenant.
// VALIDATION : internalAssessmentStudentParamSchema for the path;
//              decideInternalAssessmentSchema for the body, .strict().
//
//              `finalMarks` uses the project's shared boundedDecimal primitive,
//              which carries the scale check that stops PostgreSQL silently
//              rounding a third decimal place away — the figure the faculty
//              member entered is the figure stored.
//
//              suggestedMarks, confidence and decidedById are ABSENT and
//              therefore refused with 400. A client cannot rewrite what the
//              model proposed, nor attribute a decision to another user.
// FLOW       : Guard → validate → controller.
//
//              The service refuses a decision with no suggestion behind it
//              (404) — this phase's premise is that the two travel together —
//              a mark above the component's maximum (400, naming it), and an
//              override with no reason (400).
//
//              The update and its audit entry share ONE transaction, so a
//              recorded decision cannot exist without its trail and vice versa.
//              The audit `before` carries what was proposed and the `after`
//              what was awarded, so the history answers "how far did the
//              faculty member depart from the suggestion" directly.
// RESPONSE   : { success: true, data: InternalAssessmentSuggestionDto } — with
//              `isDecided` and `isOverridden` derived.
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...INTERNAL_ASSESSMENT_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = internalAssessmentStudentParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = decideInternalAssessmentSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const origin = readRequestOrigin(request.headers);

    const decided = await internalAssessmentController.decide(
      tenantGuard.tenant.id,
      parsedParam.data.studentId,
      parsedBody.data,
      {
        userId: guard.session.sub,
        ipAddress: origin.ipAddress,
        userAgent: origin.userAgent,
      },
      new Date()
    );

    return NextResponse.json(ok(decided, "Internal assessment recorded"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
