// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Profile & Performance Analytics (Phase 23)
// LAYER  : Domain
// PURPOSE: Every figure this phase reports, computed from plain values.
//
// NO COMPOSITE "PERFORMANCE SCORE" IS DEFINED HERE
//   The README names "Teaching Performance" but supplies no formula, no inputs
//   and no scale. A weighted composite would be a number nobody decided,
//   presented with the authority of a computed statistic, and acted on by a
//   head of department. Every function below therefore returns a metric whose
//   definition is one sentence long and whose inputs are named.
//
// A RATE WITH NO DENOMINATOR IS NULL, NEVER ZERO
//   `rate(0, 0)` is null, not 0. A faculty member who has held no sessions has
//   no marking rate — reporting 0% would say they failed to mark sessions that
//   never existed, and a dashboard sorting ascending would put them at the
//   bottom of a list they do not belong on. This is the same never-fabricate
//   rule Phase 18's DTO applies to CGPA.
//
// PERCENTAGES ARE ROUNDED TO ONE DECIMAL, ONCE, HERE
//   So that every percentage in every Phase 23 response has the same
//   precision, and no caller has to guess whether 83.33333 was meaningful.
// ============================================================================

/** Percentage precision, applied to every rate this module returns. */
const PERCENT_DECIMALS = 1;

const PERCENT_FACTOR = 10 ** PERCENT_DECIMALS;

/**
 * A proportion as a percentage, or null when the denominator is zero.
 *
 * @param numerator count of the thing that happened
 * @param denominator count of the opportunities for it to happen
 */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;

  return Math.round((numerator / denominator) * 100 * PERCENT_FACTOR) / PERCENT_FACTOR;
}

/**
 * The arithmetic mean of a list, or null when it is empty.
 *
 * Rounded to two decimals — marks are Decimal(6,2) throughout this project, so
 * a mean carrying more precision than its inputs would be false precision.
 */
export function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;

  const total = values.reduce((sum, value) => sum + value, 0);

  return Math.round((total / values.length) * 100) / 100;
}

/** One teaching assignment, reduced to what the workload figures need. */
export interface WorkloadAssignment {
  readonly courseId: string;
  readonly sectionId: string | null;
  readonly semesterId: string | null;
  readonly isActive: boolean;
}

/** One timetable slot, reduced to what the workload figures need. */
export interface WorkloadSlot {
  readonly courseId: string | null;
  readonly sectionId: string | null;
  readonly sessionType: string;
  readonly isActive: boolean;
}

/** What a faculty member is responsible for teaching. */
export interface WorkloadSummary {
  readonly courseCount: number;
  readonly sectionCount: number;
  /** Distinct scheduled slots per week, across every section. */
  readonly weeklySlotCount: number;
  /** Slots broken down by session type — LECTURE, LAB, TUTORIAL and so on. */
  readonly slotsBySessionType: Readonly<Record<string, number>>;
}

/**
 * Summarise teaching load.
 *
 * ONLY ACTIVE ROWS COUNT. FacultyCourseAssignment and Timetable both carry
 * `isActive`, and a withdrawn assignment is not current workload — including it
 * would inflate every figure on a long-serving member's card.
 *
 * Courses and sections are counted DISTINCTLY, because one course taught to
 * three sections is one course and three sections, and a naive row count would
 * report three of each.
 *
 * COMPLEXITY: O(assignments + slots).
 */
export function summariseWorkload(
  assignments: readonly WorkloadAssignment[],
  slots: readonly WorkloadSlot[]
): WorkloadSummary {
  const active = assignments.filter((assignment) => assignment.isActive);
  const activeSlots = slots.filter((slot) => slot.isActive);

  const courses = new Set(active.map((assignment) => assignment.courseId));
  const sections = new Set(
    active
      .map((assignment) => assignment.sectionId)
      .filter((sectionId): sectionId is string => sectionId !== null)
  );

  const slotsBySessionType: Record<string, number> = {};
  for (const slot of activeSlots) {
    slotsBySessionType[slot.sessionType] = (slotsBySessionType[slot.sessionType] ?? 0) + 1;
  }

  return {
    courseCount: courses.size,
    sectionCount: sections.size,
    weeklySlotCount: activeSlots.length,
    slotsBySessionType,
  };
}

/** One attendance row, reduced to what the marking statistic needs. */
export interface AttendanceRecord {
  readonly status: string;
  readonly studentId: string;
}

/** How much attendance a faculty member has recorded, and what it says. */
export interface AttendanceSummary {
  readonly recordsMarked: number;
  readonly distinctStudents: number;
  readonly presentCount: number;
  readonly absentCount: number;
  /** Share of this member's marks that recorded a present student. */
  readonly presentRate: number | null;
  /** True when the read hit its bound and these figures describe a sample. */
  readonly truncated: boolean;
}

/**
 * Summarise the attendance a faculty member has recorded.
 *
 * PRESENT AND LATE BOTH COUNT AS PRESENT. AttendanceStatus carries four
 * members; a student who arrived late attended. EXCUSED is deliberately NOT
 * counted as present — it is an authorised absence, and folding it in would
 * make an excused cohort indistinguishable from an attending one.
 *
 * COMPLEXITY: O(records).
 */
export function summariseAttendance(
  records: readonly AttendanceRecord[],
  truncated: boolean
): AttendanceSummary {
  const students = new Set(records.map((record) => record.studentId));

  const presentCount = records.filter(
    (record) => record.status === "PRESENT" || record.status === "LATE"
  ).length;
  const absentCount = records.filter((record) => record.status === "ABSENT").length;

  return {
    recordsMarked: records.length,
    distinctStudents: students.size,
    presentCount,
    absentCount,
    presentRate: rate(presentCount, records.length),
    truncated,
  };
}

/** One examination result, reduced to what the result statistics need. */
export interface ResultRecord {
  readonly marksObtained: number | null;
  readonly maxMarks: number;
  readonly passMark: number | null;
}

/** How students performed in the courses a faculty member teaches. */
export interface ResultSummary {
  readonly resultsRecorded: number;
  /** Results carrying a mark. A scheduled-but-unmarked result is excluded. */
  readonly resultsMarked: number;
  readonly passCount: number;
  readonly failCount: number;
  /**
   * Share of MARKED results that passed, or null.
   *
   * Null when no result carries both a mark and a pass mark — a pass rate
   * cannot be computed against an undefined threshold, and Examination.passMark
   * is nullable.
   */
  readonly passRate: number | null;
  /** Mean mark as a percentage of each examination's own maximum. */
  readonly averagePercentage: number | null;
  readonly truncated: boolean;
}

/**
 * Summarise examination outcomes.
 *
 * MARKS ARE NORMALISED TO A PERCENTAGE BEFORE AVERAGING. A member teaching one
 * course marked out of 20 and another out of 100 would otherwise have the
 * second dominate the mean by a factor of five, and the resulting "average
 * mark" would describe the marking scale rather than the students.
 *
 * An examination with `maxMarks <= 0` is skipped rather than dividing by zero.
 * The column is a plain Int with no positive constraint (the TD-005 family), so
 * the value is possible and is handled rather than assumed away.
 *
 * COMPLEXITY: O(results).
 */
export function summariseResults(
  results: readonly ResultRecord[],
  truncated: boolean
): ResultSummary {
  const marked = results.filter(
    (result): result is ResultRecord & { marksObtained: number } => result.marksObtained !== null
  );

  const gradable = marked.filter((result) => result.passMark !== null);

  const passCount = gradable.filter(
    (result) => result.marksObtained >= (result.passMark as number)
  ).length;

  const percentages = marked
    .filter((result) => result.maxMarks > 0)
    .map((result) => (result.marksObtained / result.maxMarks) * 100);

  return {
    resultsRecorded: results.length,
    resultsMarked: marked.length,
    passCount,
    failCount: gradable.length - passCount,
    passRate: rate(passCount, gradable.length),
    averagePercentage: average(percentages),
    truncated,
  };
}
