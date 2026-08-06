// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Analytics
// LAYER  : Domain (pure)
// PURPOSE: The statistics a cohort and a student's record produce, computed
//          once from results that already exist.
//
// NOTHING HERE RECOMPUTES A RESULT
//   Every figure is derived from results the calculator already produced. An
//   analytics module that re-derived a percentage would be a second opinion
//   about a grade, and the day the two disagreed the transcript and the
//   dashboard would both be defensible and one would be wrong.
//
// EXACT ARITHMETIC THROUGHOUT
//   A pass percentage is a division and a median of an even-sized cohort is
//   another. Both are integer operations at MARK_SCALE with the regulation's
//   own rounding, for the same reason every other number in this engine is.
//
// COMPLEXITY
//   Distribution and totals O(n), single pass. Median O(n log n), one sort.
//   Merit list O(n log n), delegated to the ranking module rather than
//   re-implemented.
// ============================================================================

import { GPA_SCALE, MARK_SCALE } from "@/lib/constants/resultEngine";
import { divideRounded } from "@/lib/domain/result-engine/decimal";
import { COURSE_OUTCOME, type CourseOutcome } from "@/lib/domain/result-engine/enums";
import {
  RANK_KEY,
  RANK_MODE,
  rankCohort,
  type RankMode,
  type RankScope,
  type RankSubject,
  type RankingResult,
} from "@/lib/domain/result-engine/ranking";
import type {
  CourseResultValue,
  RoundingPolicy,
  Scaled,
  TranscriptRow,
} from "@/lib/domain/result-engine/types";

/** One student's contribution to a cohort statistic. */
export interface CohortMember {
  readonly studentId: string;
  /** Null when the student has no computed result — excluded, not counted zero. */
  readonly percentageScaled: Scaled | null;
  readonly sgpaScaled: Scaled | null;
  readonly grade: string | null;
  readonly outcome: CourseOutcome;
  readonly creditsEarnedScaled: Scaled;
}

/** How a cohort performed. */
export interface CohortStatistics {
  readonly total: number;
  readonly evaluated: number;
  readonly passed: number;
  readonly failed: number;
  /** Unresolved — withheld or unfinished. Neither passed nor failed. */
  readonly pending: number;
  /** Percentage of EVALUATED students, at MARK_SCALE. Null when none were. */
  readonly passPercentScaled: Scaled | null;
  readonly failPercentScaled: Scaled | null;
  readonly averageScaled: Scaled | null;
  readonly medianScaled: Scaled | null;
  readonly highestScaled: Scaled | null;
  readonly lowestScaled: Scaled | null;
}

/** How many students earned each grade. */
export interface GradeDistributionRow {
  readonly grade: string;
  readonly count: number;
  /** Share of graded students, at MARK_SCALE. */
  readonly percentScaled: Scaled;
}

/**
 * Summarise a cohort in ONE pass.
 *
 * A student with no computed result is counted in `total` and excluded from
 * every average — a withheld result is not a zero, and letting it divide the
 * mean would depress a whole cohort's reported performance because one
 * student's marks are sealed.
 *
 * `passPercent` divides by EVALUATED rather than by total, because "82% passed"
 * is a claim about students who were graded. Dividing by total would report a
 * cohort as failing while its results were still being processed.
 *
 * COMPLEXITY : O(n) for the totals, O(n log n) for the median's sort.
 */
export function summariseCohort(
  members: readonly CohortMember[],
  policy: RoundingPolicy
): CohortStatistics {
  const percentages: Scaled[] = [];
  let passed = 0;
  let failed = 0;
  let pending = 0;
  let total = 0;
  let sum = 0;
  let highest: Scaled | null = null;
  let lowest: Scaled | null = null;

  for (const member of members) {
    total += 1;

    if (
      member.outcome === COURSE_OUTCOME.WITHHELD ||
      member.outcome === COURSE_OUTCOME.INCOMPLETE ||
      member.percentageScaled === null
    ) {
      pending += 1;
      continue;
    }

    if (member.outcome === COURSE_OUTCOME.PASS) {
      passed += 1;
    } else {
      failed += 1;
    }

    percentages.push(member.percentageScaled);
    sum += member.percentageScaled;

    if (highest === null || member.percentageScaled > highest) {
      highest = member.percentageScaled;
    }

    if (lowest === null || member.percentageScaled < lowest) {
      lowest = member.percentageScaled;
    }
  }

  const evaluated = percentages.length;

  return {
    total,
    evaluated,
    passed,
    failed,
    pending,
    passPercentScaled: shareOf(passed, evaluated, policy),
    failPercentScaled: shareOf(failed, evaluated, policy),
    averageScaled: evaluated === 0 ? null : divideRounded(sum, evaluated, policy.marksRounding),
    medianScaled: median(percentages, policy),
    highestScaled: highest,
    lowestScaled: lowest,
  };
}

/**
 * The median of a set of percentages.
 *
 * An even-sized set takes the mean of the two middle values, computed exactly
 * rather than by float division — a median that reported 67.49999 for a cohort
 * whose middle pair was 67 and 68 would be indefensible on a published report.
 */
export function median(values: readonly Scaled[], policy: RoundingPolicy): Scaled | null {
  if (values.length === 0) {
    return null;
  }

  // Copied before sorting; the caller's array is readonly.
  const ordered = [...values].sort((left, right) => left - right);
  const middle = ordered.length >>> 1;

  if (ordered.length % 2 === 1) {
    return ordered[middle];
  }

  return divideRounded(ordered[middle - 1] + ordered[middle], 2, policy.marksRounding);
}

/**
 * Count each grade, and what share of the cohort earned it.
 *
 * Ordered by count descending then by grade, so the output is deterministic
 * without depending on Map insertion order — a distribution that reordered
 * between two runs would make a published report unverifiable.
 *
 * COMPLEXITY : O(n + g log g), where g is the number of distinct grades.
 */
export function gradeDistribution(
  members: readonly CohortMember[],
  policy: RoundingPolicy
): readonly GradeDistributionRow[] {
  const counts = new Map<string, number>();
  let graded = 0;

  for (const member of members) {
    if (member.grade === null) {
      continue;
    }

    counts.set(member.grade, (counts.get(member.grade) ?? 0) + 1);
    graded += 1;
  }

  const rows: GradeDistributionRow[] = [];

  for (const [grade, count] of counts) {
    rows.push({
      grade,
      count,
      percentScaled: shareOf(count, graded, policy) ?? 0,
    });
  }

  return rows.sort((left, right) => {
    if (left.count !== right.count) {
      return right.count - left.count;
    }

    return left.grade < right.grade ? -1 : left.grade > right.grade ? 1 : 0;
  });
}

/**
 * Build a merit list.
 *
 * Delegates to the ranking module rather than sorting here. A merit list IS a
 * ranking, and a second ordering implementation would be free to disagree with
 * the one that produces class and university ranks.
 *
 * COMPLEXITY : O(n log n), delegated.
 */
export function buildMeritList(
  members: readonly CohortMember[],
  scope: RankScope,
  mode: RankMode = RANK_MODE.COMPETITION
): RankingResult {
  const subjects: RankSubject[] = members.map((member) => ({
    subjectId: member.studentId,
    sgpaScaled: member.sgpaScaled,
    percentageScaled: member.percentageScaled,
    creditsEarnedScaled: member.creditsEarnedScaled,
  }));

  return rankCohort(subjects, {
    scope,
    mode,
    // SGPA first because a merit list ranks academic standing, and percentage
    // breaks a tie because two students on the same SGPA may not have scored
    // alike. Both are configuration on the caller's side of this boundary.
    keys: [RANK_KEY.SGPA, RANK_KEY.PERCENTAGE, RANK_KEY.CREDITS],
  });
}

// --- One student's own record ----------------------------------------------

/** How one component fared, aggregated across a student's courses. */
export interface ComponentBreakdownRow {
  readonly code: string;
  /** Marks achieved across every course carrying this component. */
  readonly achievedScaled: Scaled;
  readonly maxScaled: Scaled;
  /** Achieved as a share of the maximum, at MARK_SCALE. */
  readonly percentScaled: Scaled | null;
  readonly courseCount: number;
}

/** One point on a semester trend line. */
export interface TrendPoint {
  readonly semesterId: string;
  readonly sgpaScaled: Scaled | null;
  readonly cgpaScaled: Scaled | null;
  readonly creditsEarnedScaled: Scaled;
  readonly backlogCount: number;
}

/** A student's credits, split by what happened to them. */
export interface CreditPosition {
  readonly registeredScaled: Scaled;
  readonly earnedScaled: Scaled;
  /** Registered but not yet concluded — withheld or unfinished. */
  readonly pendingScaled: Scaled;
  /** Concluded and not passed. */
  readonly failedScaled: Scaled;
}

/**
 * Split a student's credits four ways.
 *
 * PENDING and FAILED are separated deliberately. Both are credits the student
 * does not hold, but only one of them is their fault, and a dashboard that
 * merged them would tell a student with sealed results that they had failed.
 *
 * COMPLEXITY : O(n), single pass.
 */
export function creditPosition(courses: readonly CourseResultValue[]): CreditPosition {
  let registeredScaled = 0;
  let earnedScaled = 0;
  let pendingScaled = 0;
  let failedScaled = 0;

  for (const course of courses) {
    registeredScaled += course.creditsScaled;

    switch (course.outcome) {
      case COURSE_OUTCOME.PASS:
        earnedScaled += course.creditsEarnedScaled;
        break;
      case COURSE_OUTCOME.WITHHELD:
      case COURSE_OUTCOME.INCOMPLETE:
        pendingScaled += course.creditsScaled;
        break;
      default:
        failedScaled += course.creditsScaled;
        break;
    }
  }

  return { registeredScaled, earnedScaled, pendingScaled, failedScaled };
}

/**
 * Total each component across every course a student took.
 *
 * This is what "internal versus external" is asked for: the caller groups by
 * whichever component codes its regulation uses, because WHICH components are
 * internal is a tenant's configuration and not a fact this engine may assume.
 * Nothing here names a component.
 *
 * Only LEAF components are totalled. A branch's marks are its children's marks
 * already counted, so including both would double every internal mark.
 *
 * COMPLEXITY : O(n · c), one pass over every component of every course.
 */
export function componentBreakdown(
  courses: readonly CourseResultValue[],
  policy: RoundingPolicy
): readonly ComponentBreakdownRow[] {
  const totals = new Map<
    string,
    { achievedScaled: number; maxScaled: number; courseCount: number }
  >();

  for (const course of courses) {
    for (const component of course.components) {
      if (!component.isLeaf) {
        continue;
      }

      const held = totals.get(component.code);

      if (held === undefined) {
        totals.set(component.code, {
          achievedScaled: component.adjustedScaled,
          maxScaled: component.maxMarksScaled,
          courseCount: 1,
        });
      } else {
        held.achievedScaled += component.adjustedScaled;
        held.maxScaled += component.maxMarksScaled;
        held.courseCount += 1;
      }
    }
  }

  const rows: ComponentBreakdownRow[] = [];

  for (const [code, total] of totals) {
    rows.push({
      code,
      achievedScaled: total.achievedScaled,
      maxScaled: total.maxScaled,
      percentScaled:
        total.maxScaled === 0
          ? null
          : divideRounded(
              total.achievedScaled * 100 * 10 ** MARK_SCALE,
              total.maxScaled,
              policy.marksRounding
            ),
      courseCount: total.courseCount,
    });
  }

  // Alphabetical: a deterministic order that implies no ranking between
  // components, which the engine has no basis to assert.
  return rows.sort((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0));
}

/**
 * Turn a transcript into a trend line.
 *
 * A projection, not a computation — every figure was decided by the calculator.
 * It exists so a chart and a transcript cannot disagree about a semester's SGPA.
 *
 * COMPLEXITY : O(n).
 */
export function semesterTrend(transcript: readonly TranscriptRow[]): readonly TrendPoint[] {
  return transcript.map((row) => ({
    semesterId: row.semesterId,
    sgpaScaled: row.sgpaScaled,
    cgpaScaled: row.cgpaScaled,
    creditsEarnedScaled: row.creditsEarnedScaled,
    backlogCount: row.backlogCount,
  }));
}

/**
 * Whether a student's trajectory is improving, and by how much.
 *
 * The difference between the newest and the oldest SGPA available, at
 * GPA_SCALE. Null when fewer than two semesters carry one — a trend needs two
 * points, and reporting 0.00 for a first-semester student would be a claim
 * about a trajectory that does not exist yet.
 */
export function trendDelta(points: readonly TrendPoint[]): Scaled | null {
  const graded = points.filter((point) => point.sgpaScaled !== null);

  if (graded.length < 2) {
    return null;
  }

  const first = graded[0].sgpaScaled ?? 0;
  const last = graded[graded.length - 1].sgpaScaled ?? 0;

  return last - first;
}

/** The GPA scale trend figures are carried at. Exposed so a mapper can format. */
export const TREND_SCALE = GPA_SCALE;

/** One count as a share of a total, at MARK_SCALE. Null when the total is zero. */
function shareOf(count: number, total: number, policy: RoundingPolicy): Scaled | null {
  if (total === 0) {
    return null;
  }

  return divideRounded(count * 100 * 10 ** MARK_SCALE, total, policy.marksRounding);
}
