// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Scheme — Single Resource
// LAYER  : Route
// FLOW   : Guard → tenant → validate param → validate body → controller →
//          service → response.
// ACCESS : GET    — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION ·
//                   DEPARTMENT_HOD · FACULTY
//          PATCH  — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION
//          DELETE — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION
// BACKEND: evaluationSchemeController → EvaluationSchemeService →
//          EvaluationSchemeRepository / AuditLogRepository → Prisma.
// PURPOSE: Read, amend and discard a single academic regulation revision.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { evaluationSchemeController } from "@/lib/controllers/evaluationScheme.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import {
  EVALUATION_SCHEME_MANAGE_ROLES,
  EVALUATION_SCHEME_READ_ROLES,
} from "@/lib/constants/evaluationScheme";
import {
  evaluationSchemeIdParamSchema,
  updateEvaluationSchemeSchema,
} from "@/lib/validations/evaluationScheme";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const GET_SCOPE = "GET /api/evaluation-schemes/[id]";
const PATCH_SCOPE = "PATCH /api/evaluation-schemes/[id]";
const DELETE_SCOPE = "DELETE /api/evaluation-schemes/[id]";

/** Route params resolve asynchronously in this Next.js version. */
type RouteContext = { params: Promise<{ id: string }> };

// GET
// ACCESS     : EVALUATION_SCHEME_READ_ROLES.
// VALIDATION : evaluationSchemeIdParamSchema. The id is an opaque cuid, so no
//              format is asserted — an unrecognised but well-formed id is a 404,
//              not a 400.
// FLOW       : Authorise → resolve tenant → validate param → controller. The
//              lookup is tenant-scoped inside the repository, so an unknown id
//              and one owned by another tenant produce the identical 404 and no
//              id is ever confirmed to exist elsewhere.
// RESPONSE   : { success: true, data: EvaluationSchemeDetailDTO }
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

    const parsedParam = evaluationSchemeIdParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const scheme = await evaluationSchemeController.getById(
      tenantGuard.tenant.id,
      parsedParam.data.id
    );

    return NextResponse.json(ok(scheme));
  } catch (err) {
    return handleRouteError(GET_SCOPE, err);
  }
}

// PATCH
// ACCESS     : EVALUATION_SCHEME_MANAGE_ROLES.
// VALIDATION : evaluationSchemeIdParamSchema and updateEvaluationSchemeSchema.
//              `code` is not patchable — it is the identity a revision shares
//              with its siblings, and changing it would move the revision into
//              another regulation family while keeping a version number
//              computed against the old one.
// FLOW       : Authorise → resolve tenant → validate → controller.
//
//              Only a DRAFT may be amended. That is enforced in the service,
//              not here: it is a rule about stored state, and a route cannot
//              see stored state without doing the service's job twice.
// RESPONSE   : { success: true, data: EvaluationSchemeDetailDTO,
//                message: "Evaluation scheme updated" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
//
//              409 — the revision is ACTIVE or ARCHIVED and therefore frozen.
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

    const parsedParam = evaluationSchemeIdParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = updateEvaluationSchemeSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const scheme = await evaluationSchemeController.update(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedBody.data,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(scheme, "Evaluation scheme updated"));
  } catch (err) {
    return handleRouteError(PATCH_SCOPE, err);
  }
}

// DELETE
// ACCESS     : EVALUATION_SCHEME_MANAGE_ROLES.
// VALIDATION : evaluationSchemeIdParamSchema. No body is read.
// FLOW       : Authorise → resolve tenant → validate param → controller.
//
//              Only a DRAFT may be discarded. An ACTIVE or ARCHIVED revision is
//              part of the historical record and is never deleted, because
//              results computed under it must remain explicable; archival is
//              the retirement path. The discarded draft's full contents are
//              captured in the audit entry before the row is removed.
// RESPONSE   : { success: true, data: null,
//                message: "Evaluation scheme deleted" }
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

    const parsedParam = evaluationSchemeIdParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    await evaluationSchemeController.remove(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(null, "Evaluation scheme deleted"));
  } catch (err) {
    return handleRouteError(DELETE_SCOPE, err);
  }
}
