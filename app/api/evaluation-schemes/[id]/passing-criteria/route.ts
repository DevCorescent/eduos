// ============================================================================
// OWNER  : Gauransh
// MODULE : Passing Criterion — Collection
// LAYER  : Route
// FLOW   : Guard → tenant → validate → controller → service → response.
// ACCESS : GET  — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION ·
//                 DEPARTMENT_HOD · FACULTY
//          POST — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION
//
//          The role sets are the SCHEME's, imported rather than redeclared.
//          STUDENT and PARENT have no access here: a student learns the
//          requirements they missed from their grade card, which names the
//          failed criterion, rather than by reading the regulation.
// BACKEND: passingCriterionController → PassingCriterionService →
//          PassingCriterionRepository / AuditLogRepository → Prisma.
// PURPOSE: Read a regulation's minimum thresholds, and add to them.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { passingCriterionController } from "@/lib/controllers/passingCriterion.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import {
  EVALUATION_SCHEME_MANAGE_ROLES,
  EVALUATION_SCHEME_READ_ROLES,
} from "@/lib/constants/evaluationScheme";
import { HTTP_STATUS } from "@/lib/constants/errors";
import {
  createPassingCriterionSchema,
  criterionSchemeParamSchema,
} from "@/lib/validations/passingCriterion";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const GET_SCOPE = "GET /api/evaluation-schemes/[id]/passing-criteria";
const POST_SCOPE = "POST /api/evaluation-schemes/[id]/passing-criteria";

type RouteContext = { params: Promise<{ id: string }> };

// GET
// ACCESS     : EVALUATION_SCHEME_READ_ROLES.
// VALIDATION : criterionSchemeParamSchema for the [id] segment. No query
//              parameters are read, and none are defined.
// FLOW       : Authorise → resolve tenant → validate param → controller.
//
//              The response is NOT paginated, and that is a contract decision:
//              criteria form a CONJUNCTION — every one must hold — so a page of
//              them misrepresents the requirement. A client seeing three of
//              five would believe a student meeting those three has passed.
//
//              The two scope counts are reported separately because they are
//              evaluated at different times by different parts of the engine:
//              course-scoped criteria run while a course result is computed,
//              semester-scoped ones once per student per semester.
// RESPONSE   : { success: true, data: PassingCriterionListDTO }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_READ_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = criterionSchemeParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const criteria = await passingCriterionController.getAll(
      tenantGuard.tenant.id,
      parsedParam.data.id
    );

    return NextResponse.json(ok(criteria));
  } catch (err) {
    return handleRouteError(GET_SCOPE, err);
  }
}

// POST
// ACCESS     : EVALUATION_SCHEME_MANAGE_ROLES.
// VALIDATION : criterionSchemeParamSchema for the [id] segment,
//              createPassingCriterionSchema for the body. schemeId is taken
//              from the route segment and is absent from the schema.
// FLOW       : Authorise → resolve tenant → validate → build the audit context
//              → controller.
//
//              Three coherence rules are decided from the body — metric versus
//              componentId, metric versus unit, and a percentage threshold
//              bounded at 100. The fourth, that a MARKS threshold fits inside
//              the component's own maximum, needs the stored component and is
//              enforced in the service.
//
//              Note what this endpoint does NOT reject: two criteria on the
//              same component and metric under different units. "Theory >= 21
//              marks" AND "theory >= 30%" is a legitimate regulation, and since
//              criteria form a conjunction, both simply apply.
// RESPONSE   : { success: true, data: PassingCriterionDTO,
//                message: "Passing criterion created" }
// STATUS     : 201 · 400 · 401 · 403 · 404 · 409 · 500
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...EVALUATION_SCHEME_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = criterionSchemeParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = createPassingCriterionSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const criterion = await passingCriterionController.create(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedBody.data,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(criterion, "Passing criterion created"), {
      status: HTTP_STATUS.CREATED,
    });
  } catch (err) {
    return handleRouteError(POST_SCOPE, err);
  }
}
