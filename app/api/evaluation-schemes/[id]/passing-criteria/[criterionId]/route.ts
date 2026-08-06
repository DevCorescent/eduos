// ============================================================================
// OWNER  : Gauransh
// MODULE : Passing Criterion — Single Resource
// LAYER  : Route
// FLOW   : Guard → tenant → validate params → validate body → controller →
//          service → response.
// ACCESS : GET    — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION ·
//                   DEPARTMENT_HOD · FACULTY
//          PATCH  — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION
//          DELETE — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION
// BACKEND: passingCriterionController → PassingCriterionService →
//          PassingCriterionRepository / AuditLogRepository → Prisma.
// PURPOSE: Read, amend and remove a single minimum threshold.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { passingCriterionController } from "@/lib/controllers/passingCriterion.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import {
  EVALUATION_SCHEME_MANAGE_ROLES,
  EVALUATION_SCHEME_READ_ROLES,
} from "@/lib/constants/evaluationScheme";
import {
  passingCriterionParamSchema,
  updatePassingCriterionSchema,
} from "@/lib/validations/passingCriterion";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const GET_SCOPE = "GET /api/evaluation-schemes/[id]/passing-criteria/[criterionId]";
const PATCH_SCOPE = "PATCH /api/evaluation-schemes/[id]/passing-criteria/[criterionId]";
const DELETE_SCOPE = "DELETE /api/evaluation-schemes/[id]/passing-criteria/[criterionId]";

type RouteContext = { params: Promise<{ id: string; criterionId: string }> };

// GET
// ACCESS     : EVALUATION_SCHEME_READ_ROLES.
// VALIDATION : passingCriterionParamSchema — both segments non-empty once
//              trimmed, no format asserted on either opaque cuid.
// FLOW       : Authorise → resolve tenant → validate params → controller.
//
//              The lookup is scoped by tenant AND scheme, so a criterion id
//              belonging to another regulation of the same tenant answers 404
//              rather than being served under the wrong scheme.
// RESPONSE   : { success: true, data: PassingCriterionDTO }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_READ_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = passingCriterionParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const criterion = await passingCriterionController.getById(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedParam.data.criterionId
    );

    return NextResponse.json(ok(criterion));
  } catch (err) {
    return handleRouteError(GET_SCOPE, err);
  }
}

// PATCH
// ACCESS     : EVALUATION_SCHEME_MANAGE_ROLES.
// VALIDATION : passingCriterionParamSchema and updatePassingCriterionSchema.
//
//              The update schema applies NO coherence rules, deliberately. All
//              three relate metric, unit, componentId and threshold, and a
//              PATCH may supply any subset — checking a partial set would
//              either pass a body that is incoherent once merged, or reject one
//              that is perfectly coherent. The service re-evaluates all of them
//              against the merged values, and re-reads the component only when
//              the component, the unit or the threshold actually changes.
// RESPONSE   : { success: true, data: PassingCriterionDTO,
//                message: "Passing criterion updated" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = passingCriterionParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = updatePassingCriterionSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const criterion = await passingCriterionController.update(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedParam.data.criterionId,
      parsedBody.data,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(criterion, "Passing criterion updated"));
  } catch (err) {
    return handleRouteError(PATCH_SCOPE, err);
  }
}

// DELETE
// ACCESS     : EVALUATION_SCHEME_MANAGE_ROLES.
// VALIDATION : passingCriterionParamSchema. No body is read.
// FLOW       : Authorise → resolve tenant → validate params → controller.
//
//              Removing a criterion RELAXES a regulation, which is exactly why
//              the full row is captured in the audit entry first: a later
//              enquiry into why a cohort's pass rate rose must be answerable.
//
//              Draft-only, like every other mutation here.
// RESPONSE   : { success: true, data: null,
//                message: "Passing criterion deleted" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = passingCriterionParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    await passingCriterionController.remove(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedParam.data.criterionId,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(null, "Passing criterion deleted"));
  } catch (err) {
    return handleRouteError(DELETE_SCOPE, err);
  }
}
