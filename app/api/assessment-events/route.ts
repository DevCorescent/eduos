// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessment Event — Collection
// LAYER  : Route
// FLOW   : Guard → tenant → validate → controller → service → response.
// ACCESS : GET  — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION ·
//                 DEPARTMENT_HOD · FACULTY
//          POST — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION
//
//          FACULTY may READ the calendar — a lecturer must see the sitting
//          before entering marks against it — but may not schedule one.
//          Scheduling authorises marks to be written, which is a registry act.
//          STUDENT and PARENT reach nothing here: a student learns of a sitting
//          from a timetable, and of its marks from a published grade card.
// BACKEND: assessmentEventController → AssessmentEventService →
//          AssessmentEventRepository / AuditLogRepository → Prisma.
// PURPOSE: Read the assessment calendar, and schedule a sitting.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { assessmentEventController } from "@/lib/controllers/assessmentEvent.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { resolveDepartmentId } from "@/lib/auth/departmentScope";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import {
  ASSESSMENT_EVENT_MANAGE_ROLES,
  ASSESSMENT_EVENT_READ_ROLES,
} from "@/lib/constants/assessmentEvent";
import { HTTP_STATUS } from "@/lib/constants/errors";
import {
  createAssessmentEventSchema,
  listAssessmentEventsQuerySchema,
} from "@/lib/validations/assessmentEvent";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const GET_SCOPE = "GET /api/assessment-events";
const POST_SCOPE = "POST /api/assessment-events";

// GET
// ACCESS     : ASSESSMENT_EVENT_READ_ROLES.
// VALIDATION : listAssessmentEventsQuerySchema — shared pagination plus five
//              optional filters, ANDed. semesterId + courseId ride
//              @@index([tenantId, semesterId, courseId]), which is the
//              assessment-calendar read.
// FLOW       : Authorise → resolve tenant → validate query → controller.
//
//              Paginated, unlike the rule and criterion collections. A rule set
//              is a pipeline whose members compose, so a page of it
//              misrepresents the whole; an assessment calendar is a genuine
//              collection that grows with the institution.
//
//              Every row reports acceptsMarks, isPublished and isEditable,
//              derived from its status — so a client knows whether to render a
//              marks grid, whether students can see it, and whether an edit
//              form applies, without a second request or a rule of its own.
// RESPONSE   : { success: true, data: { events, pagination } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole(...ASSESSMENT_EVENT_READ_ROLES);
    if (!guard.authorized) return guard.response;

    // ASSESSMENT_EVENT_READ_ROLES admits DEPARTMENT_HOD, and a role list can
    // only say yes or no. The narrowing is what turns that yes into "your own
    // department" — derived from the authenticated subject, never the request.
    const scope = await resolveDepartmentId(guard.session);
    if (!scope.ok) return scope.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const parsedQuery = listAssessmentEventsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const events = await assessmentEventController.list(
      tenantGuard.tenant.id,
      parsedQuery.data,
      scope.departmentId
    );

    return NextResponse.json(ok(events));
  } catch (err) {
    return handleRouteError(GET_SCOPE, err);
  }
}

// POST
// ACCESS     : ASSESSMENT_EVENT_MANAGE_ROLES.
// VALIDATION : createAssessmentEventSchema. sequenceNumber and status are
//              absent from the schema and therefore stripped from any body
//              supplying them — the sitting number is assigned by the server,
//              and the status moves only through the transition endpoint.
// FLOW       : Authorise → resolve tenant → validate → build the audit context
//              → controller.
//
//              The service resolves every reference tenant-scoped and requires
//              the component's SCHEME to be ACTIVE: marks assessed under a
//              still-editable draft regulation would be graded by rules that
//              could change afterwards.
//
//              maxMarks may be omitted, and usually is — it then defaults to
//              the component's own scale. Supplying a different total is an
//              ordinary arrangement (a paper set out of 25 contributing on a
//              scale of 20) and is reconciled by a SCALE rule rather than by
//              conflating the two figures.
// RESPONSE   : { success: true, data: AssessmentEventDTO,
//                message: "Assessment event scheduled" }
// STATUS     : 201 · 400 · 401 · 403 · 404 · 409 · 500
//
//              404 — the component, course, semester, section or faculty member
//                    is not in this tenant.
//              409 — the component's regulation is not ACTIVE, the sitting
//                    number is exhausted, or a concurrent request took the same
//                    number.
export async function POST(request: NextRequest) {
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = createAssessmentEventSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const event = await assessmentEventController.create(
      tenantGuard.tenant.id,
      parsedBody.data,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(event, "Assessment event scheduled"), {
      status: HTTP_STATUS.CREATED,
    });
  } catch (err) {
    return handleRouteError(POST_SCOPE, err);
  }
}
