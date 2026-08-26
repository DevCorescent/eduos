// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Component — Collection
// LAYER  : Route
// FLOW   : Guard → tenant → validate → controller → service → response.
// ACCESS : GET  — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION ·
//                 DEPARTMENT_HOD · FACULTY
//          POST — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION
//
//          The role sets are the SCHEME's, imported rather than redeclared: a
//          component is part of the regulation that owns it, so the people who
//          may read or amend a scheme are exactly the people who may read or
//          amend its components. Two parallel sets would be two policies
//          pretending to be one.
// BACKEND: evaluationComponentController → EvaluationComponentService →
//          EvaluationComponentRepository / AuditLogRepository → Prisma.
// PURPOSE: Read a regulation's whole assessment tree, and add nodes to it.
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
import { HTTP_STATUS } from "@/lib/constants/errors";
import {
  componentSchemeParamSchema,
  createEvaluationComponentSchema,
} from "@/lib/validations/evaluationComponent";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const GET_SCOPE = "GET /api/evaluation-schemes/[id]/components";
const POST_SCOPE = "POST /api/evaluation-schemes/[id]/components";

type RouteContext = { params: Promise<{ id: string }> };

// GET
// ACCESS     : EVALUATION_SCHEME_READ_ROLES.
// VALIDATION : componentSchemeParamSchema for the [id] segment. No query
//              parameters are read.
// FLOW       : Authorise → resolve tenant → validate param → controller.
//
//              The response is NOT paginated, and deliberately so: a scheme's
//              components are a TREE, and a page of a tree is not a tree. The
//              row count is bounded by how many components one regulation
//              declares — a handful — so the whole structure is returned in one
//              query and nested in memory.
//
//              Each node reports isLeaf and depth, both DERIVED from the tree
//              rather than stored, and the response carries a `validation`
//              block saying whether the tree is fit for activation and, if not,
//              exactly which nodes are wrong. That costs no extra query: it is
//              a pure O(k) fold over rows already loaded, which is why it is
//              part of this response instead of a separate endpoint.
// RESPONSE   : { success: true, data: EvaluationComponentTreeDTO }
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

    const parsedParam = componentSchemeParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const tree = await evaluationComponentController.getTree(
      tenantGuard.tenant.id,
      parsedParam.data.id
    );

    return NextResponse.json(ok(tree));
  } catch (err) {
    return handleRouteError(GET_SCOPE, err);
  }
}

// POST
// ACCESS     : EVALUATION_SCHEME_MANAGE_ROLES.
// VALIDATION : componentSchemeParamSchema for the [id] segment,
//              createEvaluationComponentSchema for the body. schemeId is taken
//              from the route segment and is absent from the schema, so a
//              component can never be filed against a different regulation than
//              the one addressed in the URL.
// FLOW       : Authorise → resolve tenant → validate → build the audit context
//              → controller.
//
//              Only a DRAFT scheme accepts components; an activated tree is
//              frozen. That is enforced in the service, because it is a rule
//              about stored state.
//
//              Whole-tree rules — sibling weights totalling 100, leaf/branch
//              coherence — are NOT applied on create. A draft is incomplete
//              while it is being built, and rejecting the first of two
//              components that must together total 100 would make the tree
//              impossible to enter. They bind at activation, and the GET above
//              reports them meanwhile.
// RESPONSE   : { success: true, data: EvaluationComponentDTO,
//                message: "Evaluation component created" }
// STATUS     : 201 · 400 · 401 · 403 · 404 · 409 · 500
//
//              404 — the scheme, or the named parent component, is not in this
//                    tenant's scheme.
//              409 — the scheme is not a draft, the position is already taken
//                    by a sibling, or the code is already used in this scheme.
export async function POST(request: NextRequest, context: RouteContext) {
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

    const parsedParam = componentSchemeParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = createEvaluationComponentSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const component = await evaluationComponentController.create(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedBody.data,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(component, "Evaluation component created"), {
      status: HTTP_STATUS.CREATED,
    });
  } catch (err) {
    return handleRouteError(POST_SCOPE, err);
  }
}
