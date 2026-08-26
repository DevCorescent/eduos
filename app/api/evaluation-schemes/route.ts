// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Scheme — Collection
// LAYER  : Route
// FLOW   : Guard → tenant → validate → controller → service → response.
// ACCESS : GET  — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION ·
//                 DEPARTMENT_HOD · FACULTY
//          POST — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION
//          STUDENT and PARENT have no access: a regulation reaches a student
//          through their grade card, never as raw configuration.
// BACKEND: evaluationSchemeController → EvaluationSchemeService →
//          EvaluationSchemeRepository / AuditLogRepository → Prisma.
// PURPOSE: List academic regulations and draft new ones.
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
import { HTTP_STATUS } from "@/lib/constants/errors";
import {
  createEvaluationSchemeSchema,
  listEvaluationSchemesQuerySchema,
} from "@/lib/validations/evaluationScheme";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

/** Route identifiers used when an unhandled error is logged. */
const GET_SCOPE = "GET /api/evaluation-schemes";
const POST_SCOPE = "POST /api/evaluation-schemes";

// GET
// ACCESS     : EVALUATION_SCHEME_READ_ROLES.
// VALIDATION : listEvaluationSchemesQuerySchema — the shared pagination
//              contract extended with three index-backed filters. Every filter
//              is optional; unknown query params are dropped, not rejected,
//              which is the project-wide behaviour of a plain z.object().
// FLOW       : Authorise → resolve tenant → validate query → controller.
//              No tenant filter is applied here; it is applied inside every
//              repository query, so no caller can widen it.
// RESPONSE   : { success: true, data: { schemes, pagination } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest) {
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

    const parsedQuery = listEvaluationSchemesQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const schemes = await evaluationSchemeController.list(
      tenantGuard.tenant.id,
      parsedQuery.data
    );

    return NextResponse.json(ok(schemes));
  } catch (err) {
    return handleRouteError(GET_SCOPE, err);
  }
}

// POST
// ACCESS     : EVALUATION_SCHEME_MANAGE_ROLES.
// VALIDATION : createEvaluationSchemeSchema. Server-managed columns — version,
//              status, the lifecycle timestamps and createdById — are absent
//              from the schema and are therefore stripped from any body that
//              supplies them.
// FLOW       : Authorise → resolve tenant → parse body → validate → build the
//              audit context from the verified session and the request headers
//              → controller.
//
//              The same endpoint drafts a regulation's FIRST revision and a
//              FURTHER revision of an existing code. Which one happens is
//              decided by the service from stored state, so there is no flag
//              for a client to get wrong.
// RESPONSE   : { success: true, data: EvaluationSchemeDetailDTO,
//                message: "Evaluation scheme created" }
// STATUS     : 201 · 400 · 401 · 403 · 404 · 409 · 500
//
//              404 — the cited grade scale does not exist in this tenant.
//              409 — a draft revision of this code already exists, or a
//                    concurrent create took the same version number.
export async function POST(request: NextRequest) {
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

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = createEvaluationSchemeSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const scheme = await evaluationSchemeController.create(
      tenantGuard.tenant.id,
      parsedBody.data,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(scheme, "Evaluation scheme created"), {
      status: HTTP_STATUS.CREATED,
    });
  } catch (err) {
    return handleRouteError(POST_SCOPE, err);
  }
}
