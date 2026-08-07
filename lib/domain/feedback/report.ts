// ============================================================================
// OWNER  : Gauransh
// MODULE : Feedback — Reporting
// LAYER  : Domain (pure)
// PURPOSE: Assemble the three summaries — one faculty member, one department,
//          the institution — from analytics that already exist.
//
// PURITY
//   No Prisma, no HTTP, no repository, no service, no DTO, no clock. Every
//   figure is derived from data handed in.
//
// THIS MODULE COMPOSES; IT DOES NOT COMPUTE
//   Averages come from analytics.ts, medians and rates from statistics.ts, and
//   the decision to show anything at all from anonymity.ts. Re-deriving any of
//   them here would be a second opinion about a number a faculty member can see
//   elsewhere — and the day the two disagreed, both would be defensible and one
//   would be wrong.
//
// A WITHHELD SUMMARY IS NOT AN EMPTY ONE
//   When a faculty member has too few responses, the summary carries the
//   response COUNT and a withholding verdict — and no scores. Returning an
//   empty summary instead would tell them nobody responded, which is a
//   different and false statement, and one that would have them chasing
//   students who did.
//
// COMPLEXITY
//   Faculty summary O(a + q). Department and institution summaries O(f · (a+q))
//   over the faculty they cover, plus one sort. No nested scan: submissions are
//   grouped once into a Map rather than filtered per faculty member.
// ============================================================================

import type { FeedbackCategory } from "@/app/generated/prisma/enums";
import {
  analyse,
  type AnalyticAnswer,
  type AnalyticQuestion,
  type CategoryScore,
  type FeedbackAnalytics,
} from "@/lib/domain/feedback/analytics";
import {
  evaluateAccess,
  type DisclosureVerdict,
} from "@/lib/domain/feedback/anonymity";
import {
  meanOfScaled,
  responseRate,
  type ScaledRating,
} from "@/lib/domain/feedback/statistics";
import type { FeedbackViewer } from "@/lib/constants/feedback";

/** One submission and the answers it carried. */
export interface SubmissionWithAnswers {
  readonly submissionId: string;
  readonly facultyId: string;
  readonly courseId: string;
  readonly semesterId: string;
  readonly answers: readonly AnalyticAnswer[];
}

/** One faculty member's summary. */
export interface FacultySummary {
  readonly facultyId: string;
  /** Always present — a count is not an aggregate and discloses nothing. */
  readonly submissionCount: number;
  /** Whether the scores below may be shown, and why not when they may not. */
  readonly disclosure: DisclosureVerdict;
  /** Null when withheld. See the file header for why that is not "empty". */
  readonly analytics: FeedbackAnalytics | null;
  /** Percentage of an eligible cohort that responded. Null when unknown. */
  readonly responseRate: ScaledRating | null;
}

/** One faculty member's line in a comparison. */
export interface FacultyLine {
  readonly facultyId: string;
  readonly submissionCount: number;
  readonly overallAverage: ScaledRating | null;
  readonly categories: readonly CategoryScore[];
}

/** A department's or the institution's summary. */
export interface AggregateSummary {
  readonly scope: string;
  readonly facultyCount: number;
  readonly submissionCount: number;
  /** The mean of the faculty averages — each faculty member counting once. */
  readonly overallAverage: ScaledRating | null;
  readonly categories: readonly CategoryScore[];
  /** Ordered by faculty id, so two runs of one report are the same document. */
  readonly faculty: readonly FacultyLine[];
}

/**
 * Group submissions by faculty member, in ONE pass.
 *
 * Without it, a department summary would filter the whole submission list once
 * per faculty member — O(f × s) where a Map does it in O(s).
 */
export function groupByFaculty(
  submissions: readonly SubmissionWithAnswers[]
): ReadonlyMap<string, readonly SubmissionWithAnswers[]> {
  const grouped = new Map<string, SubmissionWithAnswers[]>();

  for (const submission of submissions) {
    const held = grouped.get(submission.facultyId);

    if (held === undefined) {
      grouped.set(submission.facultyId, [submission]);
    } else {
      held.push(submission);
    }
  }

  return grouped;
}

/** Flatten a set of submissions into the answers they carried. */
export function collectAnswers(
  submissions: readonly SubmissionWithAnswers[]
): readonly AnalyticAnswer[] {
  const answers: AnalyticAnswer[] = [];

  for (const submission of submissions) {
    answers.push(...submission.answers);
  }

  return answers;
}

/**
 * Summarise one faculty member, gated by the viewer's authority.
 *
 * The COUNT is always reported and the SCORES are conditional. That split is
 * deliberate: knowing eleven people responded discloses nothing about any of
 * them, while knowing the average of three does — so a portal can say "results
 * available at 5 responses; you have 3" without ever having held the scores.
 *
 * COMPLEXITY : O(a + q).
 */
export interface FacultySummaryInput {
  readonly facultyId: string;
  /**
   * The AUTHORITATIVE count, from the database.
   *
   * Separate from `submissions.length` deliberately. The caller asks the
   * threshold question BEFORE reading any submission — that is the whole
   * count-before-read guarantee — so when the answer is "withheld" it hands in
   * an empty array and a real count. Deriving the count from the array here
   * would make a withheld summary report zero responses, which is a different
   * and false statement.
   */
  readonly submissionCount: number;
  readonly submissions: readonly SubmissionWithAnswers[];
  readonly questions: readonly AnalyticQuestion[];
  readonly viewer: FeedbackViewer;
  readonly viewerFacultyId: string | null;
  readonly eligibleCohortSize?: number | null;
}

export function summariseFaculty(input: FacultySummaryInput): FacultySummary {
  const disclosure = evaluateAccess(
    input.viewer,
    input.viewerFacultyId,
    input.facultyId,
    input.submissionCount
  );

  const cohort = input.eligibleCohortSize ?? null;

  return {
    facultyId: input.facultyId,
    submissionCount: input.submissionCount,
    disclosure,
    analytics: disclosure.isVisible
      ? analyse(collectAnswers(input.submissions), input.questions)
      : null,
    responseRate:
      disclosure.isVisible && cohort !== null
        ? responseRate(input.submissionCount, cohort)
        : null,
  };
}

/**
 * Summarise many faculty members together.
 *
 * `overallAverage` is the mean of the FACULTY averages, each counting once —
 * not the mean of every answer. Averaging answers would let a faculty member
 * teaching four hundred students dominate one teaching twelve, and a department
 * average that moved with class size would say nothing about the department.
 *
 * NO THRESHOLD IS APPLIED to the individual lines here, and that is not an
 * oversight: this function serves the ADMIN and HOD report, whose whole purpose
 * is comparison. The caller decides whether the viewer may reach it — the route
 * excludes FACULTY from the report endpoint entirely.
 *
 * COMPLEXITY : O(s + f·q + f log f).
 */
export function summariseAggregate(
  scope: string,
  submissions: readonly SubmissionWithAnswers[],
  questions: readonly AnalyticQuestion[]
): AggregateSummary {
  const byFaculty = groupByFaculty(submissions);
  const lines: FacultyLine[] = [];

  for (const [facultyId, own] of byFaculty) {
    const analytics = analyse(collectAnswers(own), questions);

    lines.push({
      facultyId,
      submissionCount: own.length,
      overallAverage: analytics.overallAverage,
      categories: analytics.categories,
    });
  }

  // By faculty id, so two runs of one report produce the same document. Not by
  // score — an ordering that moved with the data would make a report look
  // different each time it was printed, and a reader could not diff two.
  lines.sort((left, right) =>
    left.facultyId < right.facultyId ? -1 : left.facultyId > right.facultyId ? 1 : 0
  );

  const facultyAverages = lines
    .map((line) => line.overallAverage)
    .filter((average): average is ScaledRating => average !== null);

  return {
    scope,
    facultyCount: byFaculty.size,
    submissionCount: submissions.length,
    // Already at RATING_SCALE, so meanOfScaled rather than mean.
    overallAverage: meanOfScaled(facultyAverages),
    categories: rollUpCategories(lines),
    faculty: lines,
  };
}

/**
 * Roll each category up across faculty members.
 *
 * Every faculty member counts once per category, for the same reason the
 * overall average does: a category average weighted by response volume would
 * describe the largest classes rather than the department.
 *
 * COMPLEXITY : O(f · c + c log c).
 */
function rollUpCategories(lines: readonly FacultyLine[]): readonly CategoryScore[] {
  const byCategory = new Map<
    FeedbackCategory,
    { averages: ScaledRating[]; responses: number; questions: number }
  >();

  for (const line of lines) {
    for (const category of line.categories) {
      if (category.average === null) {
        continue;
      }

      const held = byCategory.get(category.category) ?? {
        averages: [],
        responses: 0,
        questions: 0,
      };

      held.averages.push(category.average);
      held.responses += category.responses;
      held.questions = Math.max(held.questions, category.questionCount);

      byCategory.set(category.category, held);
    }
  }

  const rolled: CategoryScore[] = [];

  for (const [category, tally] of byCategory) {
    rolled.push({
      category,
      average: meanOfScaled(tally.averages),
      questionCount: tally.questions,
      responses: tally.responses,
    });
  }

  return rolled.sort((left, right) =>
    left.category < right.category ? -1 : left.category > right.category ? 1 : 0
  );
}

/**
 * Whether a summary's own numbers are internally consistent.
 *
 * Exists so a caller can assert the invariant before publishing, rather than
 * discovering a contradiction in a document someone has already read. A summary
 * failing this has a defect in the engine, not in its inputs.
 */
export function isSummaryCoherent(summary: AggregateSummary): boolean {
  const lineTotal = summary.faculty.reduce((sum, line) => sum + line.submissionCount, 0);

  return (
    summary.faculty.length === summary.facultyCount &&
    lineTotal === summary.submissionCount
  );
}
