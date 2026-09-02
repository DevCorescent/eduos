// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Analytics Service
// LAYER  : Service
// PURPOSE: Business logic for Smart Attendance Analytics.
//
// FIX (Phase 15 review): the previous version of this service returned an
// ad-hoc shape from getAnalytics (`overview`, a raw groupBy passed through as
// `subjectWise`, `monthly` as raw per-month counts, `alerts` as an array) that
// did not match this module's own AttendanceAnalyticsDTO. This version builds
// exactly the DTO shapes declared in lib/dto/attendanceAnalytics.dto.ts, and
// factors the attendance-percentage, requirement and prediction math into
// private helpers shared by every public method, rather than each method
// recomputing it.
// ============================================================================

import {
  Attendance,
  AttendanceStatus,
} from "@/app/generated/prisma/client";
import { AppError } from "@/lib/errors/AppError";
import { isAttended as isAttendedStatus } from "@/lib/domain/attendance/attended";
import { attendanceAnalyticsRepository } from "@/lib/repositories/attendanceAnalytics.repository";
import type {
  AttendanceAnalyticsDTO,
  AttendanceDashboardDTO,
  AttendanceLeaveCalculatorDTO,
  AttendancePredictionDTO,
  SubjectAttendanceAnalytics,
} from "@/lib/dto/attendanceAnalytics.dto";

/**
 * University-wide minimum attendance requirement.
 *
 * EXPORTED by Phase 27 (this is the only change to this Phase 15 file). The
 * README's Phase 27 student event "Attendance Below 75%" needs this exact
 * threshold, and restating 75 in the notification path would create a SECOND
 * definition of the same rule — the day one moved, the dashboard and the
 * warning would disagree about whether a student is at risk. The value, its
 * type and every use below are unchanged.
 */
export const MINIMUM_PERCENTAGE = 75;

/** Below this (but above MINIMUM_PERCENTAGE) a student is WARNING, not SAFE. */
const WARNING_PERCENTAGE = 85;

const SAFE = "SAFE" as const;
const WARNING = "WARNING" as const;
const CRITICAL = "CRITICAL" as const;

/**
 * How many upcoming sessions the prediction and requirement math project
 * over. Neither the schema nor the README defines a remaining-classes count
 * for a semester — Timetable has no end date of its own — so a fixed lookahead
 * is used instead of guessing one. Chosen as a round number large enough to
 * smooth out a single day's noise while staying a short-term projection
 * rather than a full-semester one.
 */
const ASSUMED_FUTURE_CLASSES = 10;

/**
 * How many of a student's most recent sessions define their "current trend"
 * for the prediction endpoint. Smaller than ASSUMED_FUTURE_CLASSES on purpose:
 * the trend is read from a short recent window, then projected over the
 * longer lookahead.
 */
const RECENT_TREND_WINDOW = 5;

/**
 * A session counts toward "attended" per lib/domain/attendance/attended.ts.
 *
 * This module used to answer the question itself, counting PRESENT and LATE and
 * treating EXCUSED as an absence — while hall-ticket eligibility, asking the
 * SAME question about the SAME floor, forgave EXCUSED. A student with
 * authorised absences was therefore issued a hall ticket as eligible while this
 * service flagged them short and notified them they were below 75%. The rule
 * now lives in one place; see that file for why EXCUSED counts.
 */
function isAttended(status: AttendanceStatus): boolean {
  return isAttendedStatus(status);
}

/** The row shape returned by attendanceAnalyticsRepository.getDashboardAttendance(). */
type DashboardAttendanceRow = {
  studentId: string;
  courseId: string | null;
  sectionId: string | null;
  date: Date;
  status: AttendanceStatus;
};

/** The row shape returned by attendanceAnalyticsRepository.getCourses(). */
type CourseRow = {
  id: string;
  name: string;
  code: string;
};

export class AttendanceAnalyticsService {

  async getAnalytics(
    tenantId: string,
    studentId: string
  ): Promise<AttendanceAnalyticsDTO> {

    const [student, attendance] = await Promise.all([
      attendanceAnalyticsRepository.getStudent(tenantId, studentId),
      attendanceAnalyticsRepository.getAttendanceRecords(tenantId, studentId),
    ]);

    if (!student) {
      throw new AppError("Student not found", 404, "STUDENT_NOT_FOUND");
    }

    const stats = this.calculateAttendance(attendance);
    const requirement = this.calculateRequirement(stats.attended, stats.total);
    const subjectWise = await this.buildSubjectWise(tenantId, attendance);

    const lowAttendance = stats.percentage < MINIMUM_PERCENTAGE;
    const criticalSubjects = subjectWise
      .filter((subject) => subject.percentage < MINIMUM_PERCENTAGE)
      .map((subject) => subject.courseName);

    return {
      studentId,

      overallPercentage: stats.percentage,

      totalConducted: stats.total,
      totalPresent: stats.present,
      totalAbsent: stats.absent,
      totalLate: stats.late,
      totalExcused: stats.excused,

      classesRequired: requirement.classesRequired,
      classesCanMiss: requirement.classesCanMiss,

      monthlyTrend: this.getMonthlyTrend(attendance),

      subjectWise,

      alerts: {
        lowAttendance,
        criticalSubjects,
      },
    };
  }

  async getSubjectWise(
    tenantId: string,
    studentId: string
  ): Promise<SubjectAttendanceAnalytics[]> {

    const exists = await attendanceAnalyticsRepository.studentExists(tenantId, studentId);

    if (!exists) {
      throw new AppError("Student not found", 404, "STUDENT_NOT_FOUND");
    }

    const attendance = await attendanceAnalyticsRepository.getAttendanceRecords(
      tenantId,
      studentId
    );

    return this.buildSubjectWise(tenantId, attendance);
  }

  async calculateLeave(
    tenantId: string,
    studentId: string
  ): Promise<AttendanceLeaveCalculatorDTO> {

    const exists = await attendanceAnalyticsRepository.studentExists(tenantId, studentId);

    if (!exists) {
      throw new AppError("Student not found", 404, "STUDENT_NOT_FOUND");
    }

    const attendance = await attendanceAnalyticsRepository.getAttendanceRecords(
      tenantId,
      studentId
    );

    const stats = this.calculateAttendance(attendance);
    const requirement = this.calculateRequirement(stats.attended, stats.total);

    return {
      studentId,
      currentPercentage: stats.percentage,
      totalConducted: stats.total,
      totalAttended: stats.attended,
      classesCanMiss: requirement.classesCanMiss,
      minimumRequired: MINIMUM_PERCENTAGE,
    };
  }

  async predictAttendance(
    tenantId: string,
    studentId: string
  ): Promise<AttendancePredictionDTO> {

    const exists = await attendanceAnalyticsRepository.studentExists(tenantId, studentId);

    if (!exists) {
      throw new AppError("Student not found", 404, "STUDENT_NOT_FOUND");
    }

    const attendance = await attendanceAnalyticsRepository.getAttendanceRecords(
      tenantId,
      studentId
    );

    const stats = this.calculateAttendance(attendance);

const student =
  await attendanceAnalyticsRepository.getStudent(
    tenantId,
    studentId
  );

if (
  stats.percentage < MINIMUM_PERCENTAGE &&
  student?.userId
) {
  await attendanceAnalyticsRepository.createLowAttendanceNotification(
    tenantId,
    student.userId,
    stats.percentage
  );
}
    let prediction: typeof SAFE | typeof WARNING | typeof CRITICAL = SAFE;

    if (stats.percentage < MINIMUM_PERCENTAGE) {
      prediction = CRITICAL;
    } else if (stats.percentage < WARNING_PERCENTAGE) {
      prediction = WARNING;
    }

    return {
      studentId,
      currentPercentage: stats.percentage,
      minimumRequired: MINIMUM_PERCENTAGE,
      prediction,
      projectedPercentage: this.projectPercentage(attendance, stats.total, stats.attended),
    };
  }

  async dashboard(
    tenantId: string
  ): Promise<AttendanceDashboardDTO> {

    const attendance = await attendanceAnalyticsRepository.getDashboardAttendance(tenantId);

    const present = attendance.filter(
      (a: DashboardAttendanceRow) => a.status === AttendanceStatus.PRESENT
    ).length;
    const absent = attendance.filter(
      (a: DashboardAttendanceRow) => a.status === AttendanceStatus.ABSENT
    ).length;
    const late = attendance.filter(
      (a: DashboardAttendanceRow) => a.status === AttendanceStatus.LATE
    ).length;
    const excused = attendance.filter(
      (a: DashboardAttendanceRow) => a.status === AttendanceStatus.EXCUSED
    ).length;

    const totalRecords = attendance.length;
    const overallPercentage =
      totalRecords === 0
        ? 0
        : Number((((present + late) / totalRecords) * 100).toFixed(2));

    return {
      totalRecords,
      present,
      absent,
      late,
      excused,
      overallPercentage,
    };
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  /**
   * Core present/absent/late/excused/attended/percentage breakdown for one
   * student's full attendance history.
   *
   * `present`, `late`, `absent` and `excused` are the four raw counts, reported
   * separately because the DTO shows each. `attended` is the DERIVED total the
   * attendance floor is measured against, and is the only one callers should do
   * arithmetic with — see the note on `present` below.
   *
   * CALLERS MUST NOT USE `present` AS "ATTENDED".
   *   Three of them did. calculateRequirement, projectPercentage and the leave
   *   calculator's `totalAttended` were all handed `stats.present`, which counts
   *   PRESENT and nothing else. So `overallPercentage` was computed over one
   *   numerator while `classesRequired`, `classesCanMiss` and
   *   `projectedPercentage` were computed over a smaller one: a student sitting
   *   comfortably above the floor was told how many more classes they had to
   *   attend, and the leave calculator under-reported what they had attended.
   */
  private calculateAttendance(attendance: Attendance[]) {
    const total = attendance.length;

    const present = attendance.filter((a) => a.status === AttendanceStatus.PRESENT).length;
    const late = attendance.filter((a) => a.status === AttendanceStatus.LATE).length;
    const absent = attendance.filter((a) => a.status === AttendanceStatus.ABSENT).length;
    const excused = attendance.filter((a) => a.status === AttendanceStatus.EXCUSED).length;

    // Not `present + late`: that spelled the rule a third time and excluded
    // EXCUSED. Counted through the shared predicate so this total cannot drift
    // from the one the eligibility gate applies.
    const attended = attendance.filter((a) => isAttended(a.status)).length;

    const percentage =
      total === 0 ? 0 : Number(((attended / total) * 100).toFixed(2));

    return { total, present, late, absent, excused, attended, percentage };
  }

  /**
   * How many more classes a student needs to attend to reach
   * MINIMUM_PERCENTAGE (if currently below it), or how many more they can
   * safely miss while staying at or above it (if currently at or above it).
   * Exactly one of the two is ever non-zero.
   *
   * Below the minimum: assumes the student attends every remaining class.
   * `x` more classes attended (out of `x` more conducted) must satisfy
   *   (present + x) / (total + x) >= minPercentage / 100
   * which solves to
   *   x >= (minPercentage * total - present * 100) / (100 - minPercentage)
   * rounded up, since a fractional class cannot be attended.
   *
   * At or above the minimum: how many more classes could be conducted, all
   * missed, while `present / newTotal` stays >= minPercentage / 100 — i.e.
   * `floor(present / (minPercentage / 100)) - total`, floored at 0 so a
   * student exactly on the boundary is never reported as owing a negative
   * number of misses.
   */
  private calculateRequirement(
    present: number,
    total: number,
    minPercentage: number = MINIMUM_PERCENTAGE
  ): { classesRequired: number; classesCanMiss: number } {

    if (total === 0) {
      return { classesRequired: 0, classesCanMiss: 0 };
    }

    const currentPercentage = (present / total) * 100;

    if (currentPercentage >= minPercentage) {
      const classesCanMiss = Math.max(
        0,
        Math.floor(present / (minPercentage / 100)) - total
      );
      return { classesRequired: 0, classesCanMiss };
    }

    const denominator = 100 - minPercentage;

    // denominator is 0 only if minPercentage is 100, which MINIMUM_PERCENTAGE
    // never is; guarded anyway so this helper stays safe for any threshold a
    // caller passes in.
    const classesRequired =
      denominator <= 0
        ? 0
        : Math.max(0, Math.ceil((minPercentage * total - present * 100) / denominator));

    return { classesRequired, classesCanMiss: 0 };
  }

  /**
   * Percentage projected if the student's most recent RECENT_TREND_WINDOW
   * sessions' attendance rate continues for the next ASSUMED_FUTURE_CLASSES
   * sessions.
   *
   * `attendance` must be ordered ascending by date — which
   * getAttendanceRecords already guarantees — so the trailing slice is the
   * most recent sessions.
   */
  private projectPercentage(
    attendance: Attendance[],
    total: number,
    present: number
  ): number {

    if (total === 0) {
      return 0;
    }

    const recent = attendance.slice(-RECENT_TREND_WINDOW);
    const recentAttended = recent.filter((a) => isAttended(a.status)).length;
    const recentRate = recent.length === 0 ? present / total : recentAttended / recent.length;

    const projectedPresent = present + recentRate * ASSUMED_FUTURE_CLASSES;
    const projectedTotal = total + ASSUMED_FUTURE_CLASSES;

    return Number(((projectedPresent / projectedTotal) * 100).toFixed(2));
  }

  /**
   * Group a student's full attendance history by course and resolve each
   * course's name.
   *
   * Records with no courseId are excluded: SubjectAttendanceAnalytics.courseId
   * is a required string, and a session marked without a course cannot be
   * attributed to one. This mirrors the same open point noted in
   * lib/validations/attendance.ts — courseId is nullable on the model — rather
   * than inventing a placeholder "Unassigned" subject that no other part of
   * the project defines.
   *
   * Course names are resolved with attendanceAnalyticsRepository.getCourses()
   * rather than a join, because Attendance.courseId carries no relation to
   * Course in the schema.
   */
  private async buildSubjectWise(
    tenantId: string,
    attendance: Attendance[]
  ): Promise<SubjectAttendanceAnalytics[]> {

    const byCourse = new Map<string, Attendance[]>();

    for (const record of attendance) {
      if (!record.courseId) continue;

      const existing = byCourse.get(record.courseId);
      if (existing) {
        existing.push(record);
      } else {
        byCourse.set(record.courseId, [record]);
      }
    }

    if (byCourse.size === 0) {
      return [];
    }

    const courses = await attendanceAnalyticsRepository.getCourses(
      tenantId,
      Array.from(byCourse.keys())
    );

    const courseNames = new Map(
      courses.map((course: CourseRow): [string, string] => [course.id, course.name])
    );

    return Array.from(byCourse.entries()).map(([courseId, records]) => {
      const conducted = records.length;
      const attended = records.filter((r) => isAttended(r.status)).length;
      const absent = records.filter((r) => r.status === AttendanceStatus.ABSENT).length;

      const percentage =
        conducted === 0 ? 0 : Number(((attended / conducted) * 100).toFixed(2));

      const requirement = this.calculateRequirement(attended, conducted);

      return {
        courseId,
        // Falls back to the id itself if the course row was deleted after the
        // attendance was marked — Attendance keeps no foreign key to Course,
        // so that is a real possibility, not a defensive no-op.
        courseName: courseNames.get(courseId) ?? courseId,
        conducted,
        attended,
        absent,
        percentage,
        requiredClasses: requirement.classesRequired,
        leaveAvailable: requirement.classesCanMiss,
        predictedPercentage: this.projectPercentage(records, conducted, attended),
      };
    });
  }

  /**
   * Attendance percentage per calendar month (YYYY-MM), across all courses.
   *
   * `attendance` must be ordered ascending by date, matching
   * getAttendanceRecords's own ordering, so Object.entries below yields
   * months in chronological order without a separate sort.
   */
  private getMonthlyTrend(
    attendance: Attendance[]
  ): { month: string; percentage: number }[] {

    const byMonth = new Map<string, { total: number; attended: number }>();

    for (const record of attendance) {
      const month = record.date.toISOString().slice(0, 7);
      const bucket = byMonth.get(month) ?? { total: 0, attended: 0 };

      bucket.total += 1;
      if (isAttended(record.status)) bucket.attended += 1;

      byMonth.set(month, bucket);
    }

    return Array.from(byMonth.entries()).map(([month, bucket]) => ({
      month,
      percentage:
        bucket.total === 0 ? 0 : Number(((bucket.attended / bucket.total) * 100).toFixed(2)),
    }));
  }
}

export const attendanceAnalyticsService =
  new AttendanceAnalyticsService();