// ============================================================================
// OWNER  : Gauransh
// MODULE : Assignment Management Enhancement (Phase 24)
// LAYER  : Domain
// PURPOSE: Every figure the assignment analytics endpoint reports, computed
//          from plain values.
//
// A RATE WITH NO COHORT IS NULL, NEVER ZERO
//   An assignment nobody was registered for has no submission rate. Reporting
//   0% would say a cohort failed to submit when there was no cohort — and a
//   faculty dashboard sorted ascending would surface it as the worst-performing
//   assignment on the list.
//
// THE COHORT IS REGISTRATIONS, NOT SUBMISSION ROWS
//   "How many students have not submitted" is only answerable against the set
//   of students who were SUPPOSED to. Counting submission rows would make the
//   denominator equal to the numerator and every assignment 100% complete.
//   The service supplies the registered cohort; this module never infers one.
// ============================================================================

/** Percentage precision, applied to every rate this module returns. */
const PERCENT_DECIMALS = 1;

const PERCENT_FACTOR = 10 ** PERCENT_DECIMALS;

/** A proportion as a percentage, or null when the denominator is zero. */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;

  return Math.round((numerator / denominator) * 100 * PERCENT_FACTOR) / PERCENT_FACTOR;
}

/** One submission, reduced to what the statistics need. */
export interface SubmissionFact {
  readonly studentId: string;
  readonly status: string;
  readonly marks: number | null;
  readonly submittedAt: Date | null;
}

/** One assignment, reduced to what the statistics need. */
export interface AssignmentFact {
  readonly id: string;
  readonly maxMarks: number;
  readonly dueDate: Date | null;
  readonly submissions: readonly SubmissionFact[];
  /** How many students were registered for this assignment's course. */
  readonly cohortSize: number;
}

/** The figures reported for one assignment. */
export interface AssignmentStats {
  readonly assignmentId: string;
  readonly cohortSize: number;
  readonly submittedCount: number;
  readonly pendingCount: number;
  readonly lateCount: number;
  readonly gradedCount: number;
  /** Share of the registered cohort that submitted. */
  readonly submissionRate: number | null;
  /** Share of received submissions that have been graded. */
  readonly gradingProgress: number | null;
  /** Mean awarded mark as a percentage of maxMarks, over GRADED rows only. */
  readonly averagePercentage: number | null;
  readonly highestMarks: number | null;
  readonly lowestMarks: number | null;
}

const SUBMITTED_SET = new Set(["SUBMITTED", "LATE", "GRADED"]);

/**
 * Compute one assignment's statistics.
 *
 * PENDING IS DERIVED FROM THE COHORT, NOT COUNTED FROM ROWS. A student with no
 * submission row at all is pending, and such a student has no row to count —
 * so pending is `cohortSize - submitted`, floored at zero. The floor matters:
 * an administrator may file a submission for a student who was never
 * registered, which would otherwise produce a negative pending count.
 *
 * THE AVERAGE COVERS GRADED ROWS ONLY. An ungraded submission has no mark, and
 * treating a missing mark as zero would drag the mean down by exactly the
 * amount of work the faculty member has not yet done.
 *
 * COMPLEXITY: O(submissions).
 */
export function computeAssignmentStats(assignment: AssignmentFact): AssignmentStats {
  const submitted = assignment.submissions.filter((entry) => SUBMITTED_SET.has(entry.status));
  const late = assignment.submissions.filter((entry) => entry.status === "LATE");
  const graded = assignment.submissions.filter(
    (entry): entry is SubmissionFact & { marks: number } =>
      entry.status === "GRADED" && entry.marks !== null
  );

  const marks = graded.map((entry) => entry.marks);

  const averagePercentage =
    assignment.maxMarks > 0 && marks.length > 0
      ? Math.round(
          (marks.reduce((sum, value) => sum + value, 0) / marks.length / assignment.maxMarks) *
            100 *
            PERCENT_FACTOR
        ) / PERCENT_FACTOR
      : null;

  return {
    assignmentId: assignment.id,
    cohortSize: assignment.cohortSize,
    submittedCount: submitted.length,
    pendingCount: Math.max(0, assignment.cohortSize - submitted.length),
    lateCount: late.length,
    gradedCount: graded.length,
    submissionRate: rate(submitted.length, assignment.cohortSize),
    gradingProgress: rate(graded.length, submitted.length),
    averagePercentage,
    highestMarks: marks.length > 0 ? Math.max(...marks) : null,
    lowestMarks: marks.length > 0 ? Math.min(...marks) : null,
  };
}

/** Totals across a set of assignments. */
export interface AssignmentAnalyticsTotals {
  readonly assignmentCount: number;
  readonly cohortTotal: number;
  readonly submittedTotal: number;
  readonly pendingTotal: number;
  readonly lateTotal: number;
  readonly gradedTotal: number;
  readonly overallSubmissionRate: number | null;
  readonly overallGradingProgress: number | null;
  /** True when the read hit its bound and these totals describe a sample. */
  readonly truncated: boolean;
}

/**
 * Roll a set of per-assignment statistics into totals.
 *
 * RATES ARE RECOMPUTED FROM THE TOTALS, NOT AVERAGED. Averaging per-assignment
 * percentages would weight a five-student assignment the same as a
 * five-hundred-student one, so the headline figure would describe the number of
 * assignments rather than the number of students.
 *
 * COMPLEXITY: O(assignments).
 */
export function rollUpAssignmentStats(
  stats: readonly AssignmentStats[],
  truncated: boolean
): AssignmentAnalyticsTotals {
  const sum = (pick: (entry: AssignmentStats) => number) =>
    stats.reduce((total, entry) => total + pick(entry), 0);

  const cohortTotal = sum((entry) => entry.cohortSize);
  const submittedTotal = sum((entry) => entry.submittedCount);
  const gradedTotal = sum((entry) => entry.gradedCount);

  return {
    assignmentCount: stats.length,
    cohortTotal,
    submittedTotal,
    pendingTotal: sum((entry) => entry.pendingCount),
    lateTotal: sum((entry) => entry.lateCount),
    gradedTotal,
    overallSubmissionRate: rate(submittedTotal, cohortTotal),
    overallGradingProgress: rate(gradedTotal, submittedTotal),
    truncated,
  };
}

/**
 * Is a submission arriving at `now` late for this assignment?
 *
 * THE SINGLE DEFINITION, consulted by the submit path. An assignment with no
 * due date can never be late — the absence of a deadline is not a deadline of
 * the epoch, which is the failure TD-002 records for coerced dates elsewhere.
 *
 * The comparison is strictly greater-than, so a submission at the exact
 * deadline instant is ON TIME. A student who submits as the clock strikes has
 * met the deadline, and the alternative would penalise them for a millisecond.
 */
export function isLate(dueDate: Date | null, now: Date): boolean {
  if (dueDate === null) return false;

  return now.getTime() > dueDate.getTime();
}
