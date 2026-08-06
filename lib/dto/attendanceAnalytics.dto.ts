// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Analytics — Response Contracts
// PURPOSE: The shapes returned to the client by each Phase 15 analytics
//          endpoint. The service layer builds exactly these — no route or
//          controller reshapes them further.
// ============================================================================

/**
 * One course's attendance breakdown within a student's full analytics.
 *
 * `conducted` includes every marked session for the course, regardless of
 * status — PRESENT, ABSENT, LATE and EXCUSED all count toward it. `attended`
 * counts PRESENT and LATE (a late arrival is still attendance), `absent`
 * counts ABSENT only. EXCUSED sessions are counted in `conducted` but in
 * neither `attended` nor `absent` — an excused absence should not drag the
 * percentage down the way an unexcused one does, but it did happen and so
 * still counts as a conducted session.
 */
export interface SubjectAttendanceAnalytics {
  courseId: string;

  courseName: string;

  conducted: number;

  attended: number;

  absent: number;

  percentage: number;

  requiredClasses: number;

  leaveAvailable: number;

  predictedPercentage: number;
}

export interface AttendanceAnalyticsDTO {
  studentId: string;

  overallPercentage: number;

  totalConducted: number;

  totalPresent: number;

  totalAbsent: number;

  totalLate: number;

  totalExcused: number;

  classesRequired: number;

  classesCanMiss: number;

  monthlyTrend: {
    month: string;

    percentage: number;
  }[];

  subjectWise: SubjectAttendanceAnalytics[];

  alerts: {
    lowAttendance: boolean;

    criticalSubjects: string[];
  };
}

/** Response shape for GET /api/attendance/analytics/leave-calculator/[studentId]. */
export interface AttendanceLeaveCalculatorDTO {
  studentId: string;

  currentPercentage: number;

  totalConducted: number;

  totalAttended: number;

  classesCanMiss: number;

  minimumRequired: number;
}

/** Response shape for GET /api/attendance/analytics/prediction/[studentId]. */
export interface AttendancePredictionDTO {
  studentId: string;

  currentPercentage: number;

  minimumRequired: number;

  /** Classification of the student's CURRENT standing, not the projection. */
  prediction: "SAFE" | "WARNING" | "CRITICAL";

  /**
   * Percentage projected if the student's most recent attendance rate
   * continues for the next ASSUMED_FUTURE_CLASSES sessions. See the
   * calculation notes in attendanceAnalytics.service.ts.
   */
  projectedPercentage: number;
}

/** Response shape for GET /api/attendance/analytics/dashboard. */
export interface AttendanceDashboardDTO {
  totalRecords: number;

  present: number;

  absent: number;

  late: number;

  excused: number;

  overallPercentage: number;
}