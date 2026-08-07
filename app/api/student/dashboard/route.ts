// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Profile Portal
// LAYER  : Route
// FLOW   : Guard (auth → role → tenant) → validate query → controller →
//          response.
// ACCESS : STUDENT_PROFILE_ROLES (STUDENT · UNIVERSITY_ADMIN), self-service
//          only.
// BACKEND: studentProfileController → StudentProfileService, which COMPOSES
//          ResultService, AttendanceAnalyticsService and StudentFinanceService
//          rather than re-deriving any figure they already own.
// PURPOSE: The caller's own dashboard — academic standing, attendance,
//          finance, profile completion, a quick summary and recent
//          notifications.
//
// SECURITY: no [studentId] segment and no studentId in the query schema. The
//          caller is resolved from session.sub inside the service.
//
// NOTHING IS FABRICATED: every figure this returns is null when the system
//          cannot produce it, and every collection is empty rather than
//          invented. A student whose results have not been computed gets
//          `cgpa: null`, never `"0.00"` — the difference between "we do not
//          know" and "you scored nothing" is the whole point.
//
// QUERY BUDGET: the expensive endpoint of this module — six repository reads
//          plus one call each to three subsystems, roughly sixteen statements.
//          That is the price of not duplicating three subsystems' logic. Every
//          call is issued once and none is inside a loop, so the cost is
//          constant per request rather than growing with the student's data.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { studentProfileController } from "@/lib/controllers/studentProfile.controller";
import { requireStudentProfileAccess } from "@/lib/middleware/requireStudentProfileAccess";
import { dashboardQuerySchema } from "@/lib/validations/studentProfile.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/student/dashboard";

// GET
// ACCESS     : requireStudentProfileAccess.
// VALIDATION : dashboardQuerySchema — `?notifications` bounds the panel,
//              coerced from its string form, defaulted, and refused at zero
//              (which would be a silently empty panel) and above the maximum
//              (which would be a request for the whole table).
// FLOW       : Guard → validate → controller.
//
//              A failing subsystem costs ONE PANEL, not the page. The service
//              settles each composed section independently and degrades it to
//              nulls, so a student whose attendance subsystem is unavailable
//              still sees their fees, their standing and their completion
//              score.
//
//              `now` is taken once here so the active-certificate count and any
//              expiry check within one response agree.
// RESPONSE   : { success: true, data: StudentDashboardDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest) {
  try {
    const guard = await requireStudentProfileAccess();
    if (!guard.granted) return guard.response;

    const parsedQuery = dashboardQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const dashboard = await studentProfileController.getDashboard(
      guard.access.tenantId,
      guard.access.userId,
      parsedQuery.data,
      new Date()
    );

    return NextResponse.json(ok(dashboard));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
