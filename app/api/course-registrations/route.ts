// ============================================================================
// OWNER  : Gauransh
// MODULE : Course Registration — Collection
// LAYER  : Route
// FLOW   : Guard → tenant → resolve scope from the caller's own roles →
//          validate → controller → service → response.
// ACCESS : GET  — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION ·
//                 DEPARTMENT_HOD · FACULTY read any enrolment in the tenant.
//                 STUDENT reads their OWN enrolments only.
//          POST — UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION.
// BACKEND: courseRegistrationController → CourseRegistrationService →
//          CourseRegistrationRepository / AuditLogRepository → Prisma.
// PURPOSE: Read enrolments — as a roster, a student's record, or a filtered
//          list — and create one.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { courseRegistrationController } from "@/lib/controllers/courseRegistration.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import {
  REGISTRATION_MANAGE_ROLES,
  REGISTRATION_READ_ROLES,
  REGISTRATION_SELF_ROLE,
} from "@/lib/constants/courseRegistration";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import {
  createCourseRegistrationSchema,
  listCourseRegistrationsQuerySchema,
} from "@/lib/validations/courseRegistration";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { fail, ok } from "@/types";

const GET_SCOPE = "GET /api/course-registrations";
const POST_SCOPE = "POST /api/course-registrations";

/** Built on the rejection path — existing FORBIDDEN code and 403 status. */
function forbidden(): NextResponse {
  return NextResponse.json(fail("Forbidden", ERROR_CODE.FORBIDDEN), {
    status: HTTP_STATUS.FORBIDDEN,
  });
}

// GET
// ACCESS     : REGISTRATION_READ_ROLES for any enrolment; STUDENT for their own.
//
//              Role precedence is elevated-first: the read set is tested
//              before STUDENT, so a caller holding both reads the whole tenant.
//              Only a caller holding neither falls through, and an anonymous
//              caller fails both and receives requireAuth's 401 — so the
//              fallback cannot turn a 401 into a 403.
//
//              Scope is decided by asking requireRole LIVE rather than by
//              reading session.roles, matching every other role-scoped route in
//              this project: the roles in a token are a sign-in snapshot, and a
//              revoked role must take effect on the next request.
// VALIDATION : listCourseRegistrationsQuerySchema — shared pagination plus six
//              optional filters, ANDed. The two that matter are index-backed:
//              semesterId + courseId ride the roster index, studentId rides the
//              leading column of the attempt unique.
// FLOW       : Authorise → resolve tenant → validate query → for a STUDENT,
//              force studentId to their own → controller.
//
//              A STUDENT's studentId filter is OVERWRITTEN, not merely checked.
//              Comparing a supplied value would let an omitted filter return
//              the whole tenant; overwriting means the narrowing cannot be
//              bypassed by leaving the parameter out. A caller holding STUDENT
//              with no Student row in this tenant is forbidden rather than
//              served an empty page.
// RESPONSE   : { success: true, data: { registrations, pagination } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest) {
  try {
    const elevatedGuard = await requireRole(...REGISTRATION_READ_ROLES);

    let session;
    let isElevated: boolean;

    if (elevatedGuard.authorized) {
      session = elevatedGuard.session;
      isElevated = true;
    } else {
      const studentGuard = await requireRole(REGISTRATION_SELF_ROLE);
      if (!studentGuard.authorized) return studentGuard.response;

      session = studentGuard.session;
      isElevated = false;
    }

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedQuery = listCourseRegistrationsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const query = parsedQuery.data;

    if (!isElevated) {
      // The caller's own Student row is resolved from their session; the
      // requested filter is never trusted and is replaced outright.
      const self = await prisma.student.findFirst({
        where: { userId: session.sub, tenantId: tenantGuard.tenant.id },
        select: { id: true },
      });

      if (self === null) {
        return forbidden();
      }

      query.studentId = self.id;
    }

    const registrations = await courseRegistrationController.list(
      tenantGuard.tenant.id,
      query
    );

    return NextResponse.json(ok(registrations));
  } catch (err) {
    return handleRouteError(GET_SCOPE, err);
  }
}

// POST
// ACCESS     : REGISTRATION_MANAGE_ROLES. A lecturer may read a roster but may
//              not decide who is on it.
// VALIDATION : createCourseRegistrationSchema. attemptNumber, credits,
//              programmeId and status are absent from the schema and therefore
//              stripped from any body supplying them — they are the snapshots
//              and the lifecycle, all server-assigned.
// FLOW       : Authorise → resolve tenant → validate → build the audit context
//              from the verified session and request headers → controller.
//
//              Every reference is resolved tenant-scoped in the service, and
//              the evaluation scheme must be ACTIVE: grading against a still-
//              editable draft would make the result irreproducible.
// RESPONSE   : { success: true, data: CourseRegistrationDTO,
//                message: "Student registered for course" }
// STATUS     : 201 · 400 · 401 · 403 · 404 · 409 · 500
//
//              400 — a first attempt declared as a backlog, or a re-sit
//                    declared as REGULAR.
//              404 — the student, course, semester, section or scheme is not in
//                    this tenant.
//              409 — the student already holds an active enrolment for this
//                    course, the scheme is not ACTIVE, or a concurrent request
//                    took the same attempt number.
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole(...REGISTRATION_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = createCourseRegistrationSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const registration = await courseRegistrationController.register(
      tenantGuard.tenant.id,
      parsedBody.data,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(registration, "Student registered for course"), {
      status: HTTP_STATUS.CREATED,
    });
  } catch (err) {
    return handleRouteError(POST_SCOPE, err);
  }
}
