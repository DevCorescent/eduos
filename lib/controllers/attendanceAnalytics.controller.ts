// ============================================================================
// OWNER      : Gauransh
// MODULE     : Attendance Analytics
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised,
//              already-validated input from the route and delegates to the
//              service. No auth, no request/response handling, no business
//              logic.
// ARCHITECTURE:
//   • Controller performs ONLY orchestration.
//   • Auth/tenant resolution and param validation stay in the route.
//   • Error handling (AppError -> HTTP response) stays in the route.
//   • Business logic stays in the service.
// ============================================================================

import { attendanceAnalyticsService } from "@/lib/services/attendanceAnalytics.service";

export class AttendanceAnalyticsController {
  /** GET /api/attendance/analytics/[studentId] */
  async getAnalytics(tenantId: string, studentId: string) {
    return attendanceAnalyticsService.getAnalytics(tenantId, studentId);
  }

  /** GET /api/attendance/analytics/subject-wise/[studentId] */
  async getSubjectWise(tenantId: string, studentId: string) {
    return attendanceAnalyticsService.getSubjectWise(tenantId, studentId);
  }

  /** GET /api/attendance/analytics/leave-calculator/[studentId] */
  async getLeaveCalculator(tenantId: string, studentId: string) {
    return attendanceAnalyticsService.calculateLeave(tenantId, studentId);
  }

  /** GET /api/attendance/analytics/prediction/[studentId] */
  async getPrediction(tenantId: string, studentId: string) {
    return attendanceAnalyticsService.predictAttendance(tenantId, studentId);
  }

  /** GET /api/attendance/analytics/dashboard */
  async getDashboard(tenantId: string) {
    return attendanceAnalyticsService.dashboard(tenantId);
  }
}

export const attendanceAnalyticsController = new AttendanceAnalyticsController();