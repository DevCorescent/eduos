// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Rule — Single Resource
// LAYER  : Route
// FLOW   : Guard → tenant → validate params → validate body → controller →
//          service → response.
// ACCESS : GET    — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION ·
//                   DEPARTMENT_HOD · FACULTY
//          PATCH  — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION
//          DELETE — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION
// BACKEND: evaluationRuleController → EvaluationRuleService →
//          EvaluationRuleRepository / AuditLogRepository → Prisma.
// PURPOSE: Read, amend and remove a single transform in a policy pipeline.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { evaluationRuleController } from "@/lib/controllers/evaluationRule.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import {
  EVALUATION_SCHEME_MANAGE_ROLES,
  EVALUATION_SCHEME_READ_ROLES,
} from "@/lib/constants/evaluationScheme";
import {
  evaluationRuleParamSchema,
  updateEvaluationRuleSchema,
} from "@/lib/validations/evaluationRule";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const GET_SCOPE = "GET /api/evaluation-schemes/[id]/rules/[ruleId]";
const PATCH_SCOPE = "PATCH /api/evaluation-schemes/[id]/rules/[ruleId]";
const DELETE_SCOPE = "DELETE /api/evaluation-schemes/[id]/rules/[ruleId]";

type RouteContext = { params: Promise<{ id: string; ruleId: string }> };

// GET
// ACCESS     : EVALUATION_SCHEME_READ_ROLES.
// VALIDATION : evaluationRuleParamSchema — both segments non-empty once
//              trimmed. Both ids are opaque cuids, so no format is asserted: an
//              unrecognised but well-formed id is a 404, not a 400.
// FLOW       : Authorise → resolve tenant → validate params → controller.
//
//              The lookup is scoped by tenant AND by scheme, so a rule id
//              belonging to another regulation of the same tenant answers 404
//              rather than being served under the wrong scheme. The owning
//              scheme is deliberately not read separately — an unknown scheme
//              and an unknown rule produce the identical 404, which is both one
//              query fewer and the correct disclosure behaviour.
// RESPONSE   : { success: true, data: EvaluationRuleDTO }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_READ_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = evaluationRuleParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const rule = await evaluationRuleController.getById(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedParam.data.ruleId
    );

    return NextResponse.json(ok(rule));
  } catch (err) {
    return handleRouteError(GET_SCOPE, err);
  }
}

// PATCH
// ACCESS     : EVALUATION_SCHEME_MANAGE_ROLES.
// VALIDATION : evaluationRuleParamSchema and updateEvaluationRuleSchema.
//
//              The update schema applies NO cross-field rules, deliberately. A
//              PATCH may supply `config` without `operation`, or `phase`
//              without `componentId`; neither is checkable from the body alone,
//              and a schema attempting it would either accept an incoherent
//              merge or reject a coherent one. The service re-evaluates every
//              coherence rule against the merged values, which is the only
//              place all of them are known.
// FLOW       : Authorise → resolve tenant → validate → controller.
// RESPONSE   : { success: true, data: EvaluationRuleDTO,
//                message: "Evaluation rule updated" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = evaluationRuleParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = updateEvaluationRuleSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const rule = await evaluationRuleController.update(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedParam.data.ruleId,
      parsedBody.data,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(rule, "Evaluation rule updated"));
  } catch (err) {
    return handleRouteError(PATCH_SCOPE, err);
  }
}

// DELETE
// ACCESS     : EVALUATION_SCHEME_MANAGE_ROLES.
// VALIDATION : evaluationRuleParamSchema. No body is read.
// FLOW       : Authorise → resolve tenant → validate params → controller.
//
//              A rule owns nothing, so removal is a single delete with no
//              subtree to gather — unlike a component. Its full contents are
//              captured in the audit entry before the row goes, so a removed
//              transform leaves evidence of what it did.
//
//              Draft-only, like every other mutation here.
// RESPONSE   : { success: true, data: null,
//                message: "Evaluation rule deleted" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = evaluationRuleParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    await evaluationRuleController.remove(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedParam.data.ruleId,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(null, "Evaluation rule deleted"));
  } catch (err) {
    return handleRouteError(DELETE_SCOPE, err);
  }
}
