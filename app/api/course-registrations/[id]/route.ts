// ============================================================================
// OWNER  : Gauransh
// MODULE : Course Registration — Single Resource
// LAYER  : Route
// FLOW   : Guard → tenant → validate param → validate body → controller →
//          service → response.
// ACCESS : GET   — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION ·
//                  DEPARTMENT_HOD · FACULTY
//          PATCH — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION
// BACKEND: courseRegistrationController → CourseRegistrationService →
//          CourseRegistrationRepository / AuditLogRepository → Prisma.
// PURPOSE: Read one enrolment, and move it through its lifecycle.
//
// THERE IS NO DELETE HANDLER, AND THAT IS THE DESIGN
//   A registration is the historical record of who was enrolled in what. This
//   component exists precisely because that record was previously derivable
//   only from Student.sectionId, which is overwritten and therefore lost. A
//   DELETE would reintroduce exactly the loss the component was built to
//   prevent.
//
//   Every legitimate reason to remove one is a status instead: DROPPED for a
//   withdrawal inside the add/drop window, WITHDRAWN for one after it, and
//   CANCELLED for an administrative error. All three are retained, so the
//   correction itself stays auditable.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { courseRegistrationController } from "@/lib/controllers/courseRegistration.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { resolveDepartmentId } from "@/lib/auth/departmentScope";
import { requireTenant } from "@/lib/middleware/requireTenant";
import {
  REGISTRATION_MANAGE_ROLES,
  REGISTRATION_READ_ROLES,
} from "@/lib/constants/courseRegistration";
import {
  courseRegistrationParamSchema,
  updateCourseRegistrationSchema,
} from "@/lib/validations/courseRegistration";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const GET_SCOPE = "GET /api/course-registrations/[id]";
const PATCH_SCOPE = "PATCH /api/course-registrations/[id]";

type RouteContext = { params: Promise<{ id: string }> };

// GET
// ACCESS     : REGISTRATION_READ_ROLES.
//
//              STUDENT is deliberately NOT admitted here, unlike on the
//              collection. A registration detail carries nothing the student's
//              own filtered list does not already show, so a second
//              self-scoped path would be authorization surface bought for no
//              information — and every branch that can be omitted is a branch
//              that cannot be got wrong.
// VALIDATION : courseRegistrationParamSchema. The id is an opaque cuid, so no
//              format is asserted: an unrecognised but well-formed id is a 404,
//              not a 400.
// FLOW       : Authorise → resolve tenant → validate param → controller. The
//              lookup is tenant-scoped, so an unknown id and one owned by
//              another tenant produce the identical 404.
// RESPONSE   : { success: true, data: CourseRegistrationDTO }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...REGISTRATION_READ_ROLES);
    if (!guard.authorized) return guard.response;

    // A head of department reads enrolments against their own department's
    // courses. See the service for why anything else answers 404, not 403.
    const scope = await resolveDepartmentId(guard.session);
    if (!scope.ok) return scope.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = courseRegistrationParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const registration = await courseRegistrationController.getById(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      scope.departmentId
    );

    return NextResponse.json(ok(registration));
  } catch (err) {
    return handleRouteError(GET_SCOPE, err);
  }
}

// PATCH
// ACCESS     : REGISTRATION_MANAGE_ROLES.
// VALIDATION : courseRegistrationParamSchema and
//              updateCourseRegistrationSchema.
//
//              Only TWO properties are patchable, and the narrowness is the
//              contract: the teaching section, and the lifecycle status.
//              Student, course, semester, programme, credits, evaluation scheme
//              and attempt number are absent from the schema and therefore
//              unreachable — a registration whose scheme could be edited would
//              make every result computed under it irreproducible.
// FLOW       : Authorise → resolve tenant → validate → controller.
//
//              The status transition is checked against the state machine in
//              the service, because legality depends on the STORED status. All
//              four exits are terminal: reviving a withdrawn or completed
//              enrolment would silently change what a past roster contained.
//
//              statusChangedAt is stamped only when the status actually moves,
//              so reallocating a section does not falsify when a student
//              withdrew.
// RESPONSE   : { success: true, data: CourseRegistrationDTO,
//                message: "Course registration updated" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...REGISTRATION_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = courseRegistrationParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = updateCourseRegistrationSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const registration = await courseRegistrationController.update(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedBody.data,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(registration, "Course registration updated"));
  } catch (err) {
    return handleRouteError(PATCH_SCOPE, err);
  }
}
