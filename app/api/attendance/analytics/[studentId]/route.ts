// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Analytics — Full Student Analytics
// FLOW   : Guard -> tenant -> resolve scope from the caller's own roles ->
//          prove student ownership -> controller -> service -> response.
// ACCESS : UNIVERSITY_ADMIN · FACULTY — any student in the tenant.
//          STUDENT — their own analytics only. PARENT is not implemented.
// BACKEND: attendanceAnalyticsController -> attendanceAnalyticsService ->
//          attendanceAnalyticsRepository -> Prisma.
// PURPOSE: Return one student's full Smart Attendance Analytics — overall and
//          per-subject percentage, monthly trend, leave/requirement figures
//          and low-attendance alerts.
//
// FIX (Phase 15 review): this route previously called
// requireRole(request, [...roles]) and requireTenant(request) — neither guard
// takes those arguments, and the .authorized/.resolved result was never
// checked, so a rejected request fell straight through to the controller call
// instead of returning 401/403. It also enforced no self-scoping at all: any
// caller holding STUDENT could pass any studentId and read someone else's
// analytics. Both are fixed here to match the pattern already established by
// GET /api/attendance/report/[studentId].
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { attendanceAnalyticsController } from "@/lib/controllers/attendanceAnalytics.controller";
import { attendanceAnalyticsRepository } from "@/lib/repositories/attendanceAnalytics.repository";
import { attendanceAnalyticsParamSchema } from "@/lib/validations/attendanceAnalytics";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { AppError } from "@/lib/errors/AppError";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * The 403 answered when a student asks for someone else's analytics.
 *
 * Same message and code requireRole itself uses on its rejection path, so a
 * student out of scope receives a response indistinguishable from one the
 * role guard would produce — matching the forbidden() helper in
 * GET /api/attendance/report/[studentId].
 */
function forbidden(): NextResponse {
  return NextResponse.json(fail("Forbidden", "FORBIDDEN"), { status: 403 });
}

// GET
// ACCESS     : UNIVERSITY_ADMIN · FACULTY · STUDENT, with different scope.
//              Role precedence is UNIVERSITY_ADMIN > FACULTY > STUDENT: the
//              elevated pair is tested first, so a caller holding either reads
//              any student in the tenant. Only a caller holding neither falls
//              through to the STUDENT branch and is confined to their own
//              record. Scope is decided by asking requireRole live rather than
//              trusting the roles embedded in the JWT, matching every other
//              role-scoped route in this project.
// VALIDATION : attendanceAnalyticsParamSchema — the [studentId] segment must
//              be non-empty once trimmed.
// FLOW       : Authorise -> resolve tenant -> validate param -> establish
//              which student the caller may read -> controller -> service.
//              For a STUDENT, the path parameter is never used to look
//              anything up directly — their own Student row is resolved from
//              session.sub via Student.userId, and the requested id is only
//              ever compared against it. A mismatch is 403 whether the
//              requested id exists, belongs to another tenant, or exists
//              nowhere, so the endpoint discloses no student's existence to a
//              student.
//              For an elevated caller, no separate existence check is made
//              here — the service itself resolves the student and throws
//              AppError("Student not found", 404) if the id doesn't belong to
//              the tenant, which this route maps to a 404 below.
// RESPONSE   : { success: true, data: AttendanceAnalyticsDTO }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ studentId: string }> }
) {
  try {
    // Precedence: the elevated pair is tested first, so a caller holding
    // either never reaches the student branch.
    const elevatedGuard = await requireRole("UNIVERSITY_ADMIN", "FACULTY");

    let session;
    let isElevated: boolean;

    if (elevatedGuard.authorized) {
      session = elevatedGuard.session;
      isElevated = true;
    } else {
      const studentGuard = await requireRole("STUDENT");
      if (!studentGuard.authorized) return studentGuard.response;

      session = studentGuard.session;
      isElevated = false;
    }

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = attendanceAnalyticsParamSchema.safeParse(await context.params);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsed.error),
        },
        { status: 400 }
      );
    }

    const { studentId } = parsed.data;

    if (!isElevated) {
      const self = await attendanceAnalyticsRepository.getStudentIdByUserId(
        tenant.id,
        session.sub
      );

      if (!self || self.id !== studentId) {
        return forbidden();
      }
    }

    const analytics = await attendanceAnalyticsController.getAnalytics(tenant.id, studentId);

    return NextResponse.json(ok(analytics, "Attendance analytics fetched successfully."));
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(fail(error.message, error.code), { status: error.statusCode });
    }

    console.error("[GET /api/attendance/analytics/[studentId]]", error);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}