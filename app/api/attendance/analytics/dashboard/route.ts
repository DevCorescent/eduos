// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Analytics — Dashboard
// FLOW   : Guard -> tenant -> controller -> service -> response.
// ACCESS : FACULTY · UNIVERSITY_ADMIN
// BACKEND: attendanceAnalyticsController -> attendanceAnalyticsService ->
//          attendanceAnalyticsRepository -> Prisma.
// PURPOSE: Tenant-wide attendance aggregate — total records and the
//          present/absent/late/excused breakdown across every student.
//
// FIX (Phase 15 review): this route previously called
// requireRole(request, [...roles]) and requireTenant(request) — neither guard
// takes those arguments — and never checked their result, so a rejected
// request fell straight through instead of returning 401/403. It also
// returned `ok(dashboard, ...)` directly instead of wrapping it in
// NextResponse.json, which is not a valid route handler return value. Both
// fixed here.
//
// No student self-scoping applies to this endpoint: unlike the other four
// analytics routes, it is a tenant-wide aggregate with no [studentId] segment,
// so it stays FACULTY/UNIVERSITY_ADMIN only, matching the original ACCESS
// note.
// ============================================================================

import { NextResponse } from "next/server";
import { attendanceAnalyticsController } from "@/lib/controllers/attendanceAnalytics.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { AppError } from "@/lib/errors/AppError";
import { ok, fail } from "@/types";

// GET
// ACCESS     : FACULTY · UNIVERSITY_ADMIN
// VALIDATION : None — no request body or param.
// RESPONSE   : { success: true, data: AttendanceDashboardDTO }
// STATUS     : 200 OK · 401 UNAUTHORIZED · 403 FORBIDDEN · 500 SERVER_ERROR
export async function GET() {
  try {
    const guard = await requireRole("FACULTY", "UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const dashboard = await attendanceAnalyticsController.getDashboard(tenant.id);

    return NextResponse.json(ok(dashboard, "Attendance dashboard fetched successfully."));
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(fail(error.message, error.code), { status: error.statusCode });
    }

    console.error("[GET /api/attendance/analytics/dashboard]", error);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}