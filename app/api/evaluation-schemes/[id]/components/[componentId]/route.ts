// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Component — Single Resource
// LAYER  : Route
// FLOW   : Guard → tenant → validate params → validate body → controller →
//          service → response.
// ACCESS : GET    — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION ·
//                   DEPARTMENT_HOD · FACULTY
//          PATCH  — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION
//          DELETE — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION
// BACKEND: evaluationComponentController → EvaluationComponentService →
//          EvaluationComponentRepository / AuditLogRepository → Prisma.
// PURPOSE: Read, amend, move and remove a single node of an assessment tree.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { evaluationComponentController } from "@/lib/controllers/evaluationComponent.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import {
  EVALUATION_SCHEME_MANAGE_ROLES,
  EVALUATION_SCHEME_READ_ROLES,
} from "@/lib/constants/evaluationScheme";
import {
  evaluationComponentParamSchema,
  updateEvaluationComponentSchema,
} from "@/lib/validations/evaluationComponent";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const GET_SCOPE = "GET /api/evaluation-schemes/[id]/components/[componentId]";
const PATCH_SCOPE = "PATCH /api/evaluation-schemes/[id]/components/[componentId]";
const DELETE_SCOPE = "DELETE /api/evaluation-schemes/[id]/components/[componentId]";

type RouteContext = { params: Promise<{ id: string; componentId: string }> };

// GET
// ACCESS     : EVALUATION_SCHEME_READ_ROLES.
// VALIDATION : evaluationComponentParamSchema — both segments non-empty once
//              trimmed. Both ids are opaque cuids, so no format is asserted.
// FLOW       : Authorise → resolve tenant → validate params → controller.
//
//              The lookup is scoped by tenant AND by scheme, so a component id
//              belonging to another regulation of the same tenant answers 404
//              rather than being served under the wrong scheme.
// RESPONSE   : { success: true, data: EvaluationComponentDTO }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_READ_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const parsedParam = evaluationComponentParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const component = await evaluationComponentController.getById(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedParam.data.componentId
    );

    return NextResponse.json(ok(component));
  } catch (err) {
    return handleRouteError(GET_SCOPE, err);
  }
}

// PATCH
// ACCESS     : EVALUATION_SCHEME_MANAGE_ROLES.
// VALIDATION : evaluationComponentParamSchema and
//              updateEvaluationComponentSchema.
//
//              `parentComponentId` is explicitly nullable in the body schema,
//              which departs from the project rule that a PATCH cannot clear a
//              nullable column. The departure is required: promoting a nested
//              component back to the top level is an ordinary editing action,
//              and with no way to send null it would be unreachable.
// FLOW       : Authorise → resolve tenant → validate → controller.
//
//              Three rules are enforced in the service, because all three
//              depend on stored state a route cannot see: the scheme must still
//              be a DRAFT; a component may not be moved beneath its own
//              descendant, which no foreign key can express because every
//              individual reference stays valid while the graph stops being a
//              tree; and the target position must be free among its new
//              siblings.
// RESPONSE   : { success: true, data: EvaluationComponentDTO,
//                message: "Evaluation component updated" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const parsedParam = evaluationComponentParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = updateEvaluationComponentSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const component = await evaluationComponentController.update(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedParam.data.componentId,
      parsedBody.data,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(component, "Evaluation component updated"));
  } catch (err) {
    return handleRouteError(PATCH_SCOPE, err);
  }
}

// DELETE
// ACCESS     : EVALUATION_SCHEME_MANAGE_ROLES.
// VALIDATION : evaluationComponentParamSchema. No body is read.
// FLOW       : Authorise → resolve tenant → validate params → controller.
//
//              This removes the component AND EVERYTHING BENEATH IT. The
//              subtree is computed in memory and deleted in one bulk statement
//              rather than by a database cascade, so the audit entry records
//              exactly which nodes went — a cascade would remove rows the audit
//              log never sees. The response reports how many were removed, so a
//              caller is never left believing a single node went when a branch
//              did.
//
//              Draft-only, like every other mutation here.
// RESPONSE   : { success: true, data: { removedCount },
//                message: "Evaluation component deleted" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const parsedParam = evaluationComponentParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const result = await evaluationComponentController.remove(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedParam.data.componentId,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(result, "Evaluation component deleted"));
  } catch (err) {
    return handleRouteError(DELETE_SCOPE, err);
  }
}
