// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessment Event — Single Resource
// LAYER  : Route
// FLOW   : Guard → tenant → validate param → validate body → controller →
//          service → response.
// ACCESS : GET   — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION ·
//                  DEPARTMENT_HOD · FACULTY
//          PATCH — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION
// BACKEND: assessmentEventController → AssessmentEventService →
//          AssessmentEventRepository / AuditLogRepository → Prisma.
// PURPOSE: Read one sitting, and amend its description while it is still a
//          draft.
//
// THERE IS NO DELETE HANDLER
//   A sitting is the thing marks are recorded against. Deleting one after entry
//   has opened would orphan every mark taken at it; deleting one before that is
//   indistinguishable from never having created it, and leaves no trace of a
//   scheduling error that may have been communicated to students.
//
//   A sitting that should not have existed stays in DRAFT and is never opened.
//   Nothing is graded from it, and the record of the mistake survives.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { assessmentEventController } from "@/lib/controllers/assessmentEvent.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import {
  ASSESSMENT_EVENT_MANAGE_ROLES,
  ASSESSMENT_EVENT_READ_ROLES,
} from "@/lib/constants/assessmentEvent";
import {
  assessmentEventParamSchema,
  updateAssessmentEventSchema,
} from "@/lib/validations/assessmentEvent";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const GET_SCOPE = "GET /api/assessment-events/[id]";
const PATCH_SCOPE = "PATCH /api/assessment-events/[id]";

type RouteContext = { params: Promise<{ id: string }> };

// GET
// ACCESS     : ASSESSMENT_EVENT_READ_ROLES.
// VALIDATION : assessmentEventParamSchema. The id is an opaque cuid, so no
//              format is asserted: an unrecognised but well-formed id is a 404,
//              not a 400.
// FLOW       : Authorise → resolve tenant → validate param → controller. The
//              lookup is tenant-scoped, so an unknown id and one owned by
//              another tenant produce the identical 404.
// RESPONSE   : { success: true, data: AssessmentEventDTO }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...ASSESSMENT_EVENT_READ_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const parsedParam = assessmentEventParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const event = await assessmentEventController.getById(
      tenantGuard.tenant.id,
      parsedParam.data.id
    );

    return NextResponse.json(ok(event));
  } catch (err) {
    return handleRouteError(GET_SCOPE, err);
  }
}

// PATCH
// ACCESS     : ASSESSMENT_EVENT_MANAGE_ROLES.
// VALIDATION : assessmentEventParamSchema and updateAssessmentEventSchema.
//
//              The references — component, course, semester, section — are
//              absent from the schema and therefore unpatchable. Moving a
//              sitting to a different component or term would silently
//              reattribute every mark recorded against it; a sitting in the
//              wrong place is created again in the right one.
// FLOW       : Authorise → resolve tenant → validate → controller.
//
//              Amendment is refused once entry has opened. That is enforced in
//              the service, against the stored status, and the reason is
//              specific rather than cautious: changing maxMarks after marks
//              exist would revalue every one of them — a correction that looks
//              clerical and behaves like a regrade.
// RESPONSE   : { success: true, data: AssessmentEventDTO,
//                message: "Assessment event updated" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
//
//              409 — the sitting is OPEN, LOCKED or PUBLISHED.
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...ASSESSMENT_EVENT_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const parsedParam = assessmentEventParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = updateAssessmentEventSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const event = await assessmentEventController.update(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedBody.data,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(event, "Assessment event updated"));
  } catch (err) {
    return handleRouteError(PATCH_SCOPE, err);
  }
}
