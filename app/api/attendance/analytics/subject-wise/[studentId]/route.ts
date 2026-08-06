// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Analytics — Subject-Wise Breakdown
// FLOW   : Guard -> tenant -> resolve scope from the caller's own roles ->
//          prove student ownership -> controller -> service -> response.
// ACCESS : UNIVERSITY_ADMIN · FACULTY — any student in the tenant.
//          STUDENT — their own subject-wise breakdown only.
// BACKEND: attendanceAnalyticsController -> attendanceAnalyticsService ->
//          attendanceAnalyticsRepository -> Prisma.
// PURPOSE: Return one student's attendance broken down per course —
//          conducted/attended/absent, percentage, and the leave/requirement
//          figures for each subject individually.
//
// FIX (Phase 15 review): this route previously imported
// attendanceAnalyticsParamSchema from "@/lib/validations/attendanceAnalytics
// .validation", a file that does not exist (the real module is
// attendanceAnalytics.ts), called requireRole/requireTenant with the wrong
// signature and never checked their result, and returned `ok(result, ...)`
// directly instead of wrapping it in NextResponse.json — none of which is a
// valid Next.js route handler return value. It also enforced no
// self-scoping, so a STUDENT caller could read any student's subject-wise
// breakdown. All fixed here, matching
// GET /api/attendance/analytics/[studentId].
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

/** Mirrors forbidden() in GET /api/attendance/analytics/[studentId]. */
function forbidden(): NextResponse {
  return NextResponse.json(fail("Forbidden", "FORBIDDEN"), { status: 403 });
}

// GET
// ACCESS     : UNIVERSITY_ADMIN · FACULTY · STUDENT, with different scope —
//              identical precedence and resolution to
//              GET /api/attendance/analytics/[studentId].
// VALIDATION : attendanceAnalyticsParamSchema — the [studentId] segment must
//              be non-empty once trimmed.
// RESPONSE   : { success: true, data: SubjectAttendanceAnalytics[] }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ studentId: string }> }
) {
  try {
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

    const result = await attendanceAnalyticsController.getSubjectWise(tenant.id, studentId);

    return NextResponse.json(ok(result, "Subject-wise attendance fetched successfully."));
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(fail(error.message, error.code), { status: error.statusCode });
    }

    console.error("[GET /api/attendance/analytics/subject-wise/[studentId]]", error);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}