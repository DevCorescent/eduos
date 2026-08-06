// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Rule — Collection
// LAYER  : Route
// FLOW   : Guard → tenant → validate → controller → service → response.
// ACCESS : GET  — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION ·
//                 DEPARTMENT_HOD · FACULTY
//          POST — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION
//
//          The role sets are the SCHEME's, imported rather than redeclared: a
//          rule is part of the regulation that owns it, so the roles that may
//          read or amend a scheme are exactly the roles that may read or amend
//          its rules. STUDENT and PARENT have no access — a policy transform
//          reaches a student through their grade card, never as configuration.
// BACKEND: evaluationRuleController → EvaluationRuleService →
//          EvaluationRuleRepository / AuditLogRepository → Prisma.
// PURPOSE: Read a regulation's policy pipeline, and add transforms to it.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { evaluationRuleController } from "@/lib/controllers/evaluationRule.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import {
  EVALUATION_SCHEME_MANAGE_ROLES,
  EVALUATION_SCHEME_READ_ROLES,
} from "@/lib/constants/evaluationScheme";
import { HTTP_STATUS } from "@/lib/constants/errors";
import {
  createEvaluationRuleSchema,
  ruleSchemeParamSchema,
} from "@/lib/validations/evaluationRule";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const GET_SCOPE = "GET /api/evaluation-schemes/[id]/rules";
const POST_SCOPE = "POST /api/evaluation-schemes/[id]/rules";

type RouteContext = { params: Promise<{ id: string }> };

// GET
// ACCESS     : EVALUATION_SCHEME_READ_ROLES.
// VALIDATION : ruleSchemeParamSchema for the [id] segment. No query parameters
//              are read, and none are defined.
// FLOW       : Authorise → resolve tenant → validate param → controller.
//
//              The response is NOT paginated, and that is a contract decision
//              rather than an omission: a regulation's rules are a PIPELINE
//              whose members compose, so a page of them misrepresents what the
//              regulation does — a caller seeing three of five transforms would
//              draw the wrong conclusion about every mark. The count is bounded
//              by how many transforms one regulation declares.
//
//              Rules are returned in EXECUTION order — phase, then sequence,
//              then code — which the database supplies directly because
//              RulePhase is declared in pipeline order. The response also
//              reports requiresCohortComputation, so a client knows without a
//              second request whether this regulation can be recomputed for one
//              student or must be run cohort-wide.
// RESPONSE   : { success: true, data: EvaluationRuleListDTO }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_READ_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = ruleSchemeParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const rules = await evaluationRuleController.getAll(
      tenantGuard.tenant.id,
      parsedParam.data.id
    );

    return NextResponse.json(ok(rules));
  } catch (err) {
    return handleRouteError(GET_SCOPE, err);
  }
}

// POST
// ACCESS     : EVALUATION_SCHEME_MANAGE_ROLES.
// VALIDATION : ruleSchemeParamSchema for the [id] segment,
//              createEvaluationRuleSchema for the body. schemeId is taken from
//              the route segment and is absent from the schema, so a rule can
//              never be filed against a different regulation than the one
//              addressed in the URL.
//
//              A CUSTOM_FORMULA body is validated by an ITERATIVE, depth- and
//              node-bounded walk before any work is done, so a pathologically
//              nested expression is refused rather than accepted or crashed on.
// FLOW       : Authorise → resolve tenant → validate → build the audit context
//              from the verified session and request headers → controller.
//
//              Only a DRAFT scheme accepts rules; an activated pipeline is
//              frozen. That is enforced in the service, because it is a rule
//              about stored state.
// RESPONSE   : { success: true, data: EvaluationRuleDTO,
//                message: "Evaluation rule created" }
// STATUS     : 201 · 400 · 401 · 403 · 404 · 409 · 500
//
//              400 — the config does not match the operation, or a formula
//                    reads a variable that does not exist at its phase. Both
//                    carry per-field details.
//              404 — the scheme, or the named component, is not in this tenant.
//              409 — the scheme is not a draft, the pipeline position is taken,
//                    or the code is already used in this scheme.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = ruleSchemeParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = createEvaluationRuleSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const rule = await evaluationRuleController.create(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedBody.data,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(rule, "Evaluation rule created"), {
      status: HTTP_STATUS.CREATED,
    });
  } catch (err) {
    return handleRouteError(POST_SCOPE, err);
  }
}
