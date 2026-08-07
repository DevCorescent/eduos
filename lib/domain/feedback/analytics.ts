// ============================================================================
// OWNER  : Gauransh
// MODULE : Feedback — Analytics
// LAYER  : Domain (pure)
// PURPOSE: Turn a set of answers into the figures a report shows — an overall
//          average, a score per category, and a distribution.
//
// PURITY
//   No Prisma, no HTTP, no repository, no service, no DTO, no clock. Answers
//   and questions arrive as plain data.
//
// A CATEGORY SCORE IS WEIGHTED; THE OVERALL AVERAGE IS NOT
//   Those are different questions and they deserve different arithmetic:
//
//     "What did students score Teaching?"  -> a weighted mean of the Teaching
//        questions, because a tenant said one of them matters more.
//     "What is this faculty member's       -> the mean of the CATEGORY scores,
//        overall rating?"                     each counting once.
//
//   Averaging every raw answer instead would let a category with nine questions
//   drown a category with one — so a form that asked nine questions about
//   Teaching and one about Behaviour would report a faculty member's Behaviour
//   as almost irrelevant, which no tenant intended by writing the questions.
//
// COMPLEXITY
//   One pass to index questions, one to group answers, one per category to
//   score. O(a + q) overall, with a and q the answers and questions. No nested
//   scan: the question index is a Map, not a find().
// ============================================================================

import type { FeedbackCategory } from "@/app/generated/prisma/enums";
import {
  descale,
  distribution,
  extremes,
  formatRating,
  mean,
  meanOfScaled,
  median,
  weightedMean,
  type RatingDistribution,
  type ScaledRating,
} from "@/lib/domain/feedback/statistics";

/** A question, as the analytics engine needs it. */
export interface AnalyticQuestion {
  readonly id: string;
  readonly code: string;
  readonly category: FeedbackCategory;
  /**
   * The question's weight, as an integer at whatever scale the caller supplies.
   *
   * Passed already-scaled rather than as a Decimal, so this module holds no
   * opinion about how a weight is stored — and no Prisma type reaches it.
   */
  readonly weightScaled: number;
}

/** One answer, as the analytics engine needs it. */
export interface AnalyticAnswer {
  readonly questionId: string;
  readonly rating: number;
}

/** How one question scored. */
export interface QuestionScore {
  readonly questionId: string;
  readonly code: string;
  readonly category: FeedbackCategory;
  readonly average: ScaledRating | null;
  readonly responses: number;
}

/** How one category scored. */
export interface CategoryScore {
  readonly category: FeedbackCategory;
  /** Weighted across the category's questions. Null when none were answered. */
  readonly average: ScaledRating | null;
  readonly questionCount: number;
  readonly responses: number;
}

/** Everything a set of answers can be asked. */
export interface FeedbackAnalytics {
  /** The mean of the CATEGORY scores — see the file header for why. */
  readonly overallAverage: ScaledRating | null;
  readonly categories: readonly CategoryScore[];
  readonly questions: readonly QuestionScore[];
  readonly distribution: RatingDistribution;
  readonly median: ScaledRating | null;
  readonly highest: number | null;
  readonly lowest: number | null;
  readonly answerCount: number;
}

/**
 * Index questions by id, in ONE pass.
 *
 * Without it, scoring would search the question list once per answer — O(a × q)
 * on a cohort of two hundred answering thirty questions is six thousand scans
 * for a lookup a Map does in one.
 */
export function indexQuestions(
  questions: readonly AnalyticQuestion[]
): ReadonlyMap<string, AnalyticQuestion> {
  const index = new Map<string, AnalyticQuestion>();

  for (const question of questions) {
    index.set(question.id, question);
  }

  return index;
}

/**
 * Score every question that was answered.
 *
 * A question nobody answered is ABSENT rather than present with a null score:
 * the caller asked what the answers say, and a question with no answers says
 * nothing. Its absence is visible in `questionCount` on the category.
 *
 * COMPLEXITY : O(a + q).
 */
export function scoreQuestions(
  answers: readonly AnalyticAnswer[],
  questions: readonly AnalyticQuestion[]
): readonly QuestionScore[] {
  const index = indexQuestions(questions);
  const grouped = new Map<string, number[]>();

  for (const answer of answers) {
    // An answer citing a question outside the set is dropped. It should be
    // unreachable — the service refuses one at submission — and including it
    // would score a question this form does not contain.
    if (!index.has(answer.questionId)) {
      continue;
    }

    const held = grouped.get(answer.questionId);

    if (held === undefined) {
      grouped.set(answer.questionId, [answer.rating]);
    } else {
      held.push(answer.rating);
    }
  }

  const scores: QuestionScore[] = [];

  for (const [questionId, ratings] of grouped) {
    const question = index.get(questionId);

    if (question === undefined) {
      continue;
    }

    scores.push({
      questionId,
      code: question.code,
      category: question.category,
      average: mean(ratings),
      responses: ratings.length,
    });
  }

  // By code, so a report prints the same order every time it is run. Not by
  // score — an ordering that moved with the data would make two runs of one
  // report look like different documents.
  return scores.sort((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0));
}

/**
 * Score every category, weighting each question by its declared weight.
 *
 * The weight is applied to the question's OWN AVERAGE rather than to each raw
 * answer. Weighting raw answers would make a question's influence depend on how
 * many people answered it as well as on its weight — two variables where the
 * tenant configured one.
 *
 * COMPLEXITY : O(a + q).
 */
export function scoreCategories(
  answers: readonly AnalyticAnswer[],
  questions: readonly AnalyticQuestion[]
): readonly CategoryScore[] {
  const index = indexQuestions(questions);
  const questionScores = scoreQuestions(answers, questions);
  const byCategory = new Map<
    FeedbackCategory,
    { terms: { weightScaled: number; value: number }[]; responses: number; questions: number }
  >();

  for (const score of questionScores) {
    const question = index.get(score.questionId);

    if (question === undefined || score.average === null) {
      continue;
    }

    const held = byCategory.get(score.category) ?? { terms: [], responses: 0, questions: 0 };

    held.terms.push({ weightScaled: question.weightScaled, value: score.average });
    held.responses += score.responses;
    held.questions += 1;

    byCategory.set(score.category, held);
  }

  const scores: CategoryScore[] = [];

  for (const [category, tally] of byCategory) {
    scores.push({
      category,
      // The terms are already at RATING_SCALE, so a weighted mean of them would
      // land at RATING_SCALE squared. Dividing back is what keeps the result on
      // the same scale as every other figure in this module.
      average: descale(weightedMean(tally.terms)),
      questionCount: tally.questions,
      responses: tally.responses,
    });
  }

  // Alphabetical: a deterministic order that implies no ranking between
  // categories, which this module has no basis to assert.
  return scores.sort((left, right) =>
    left.category < right.category ? -1 : left.category > right.category ? 1 : 0
  );
}

/**
 * Everything a set of answers can be asked, computed once.
 *
 * `overallAverage` is the mean of the CATEGORY averages, each counting once —
 * see the file header for why that is not the same as averaging every answer.
 *
 * COMPLEXITY : O(a + q + c log c), the sort being over categories.
 */
export function analyse(
  answers: readonly AnalyticAnswer[],
  questions: readonly AnalyticQuestion[]
): FeedbackAnalytics {
  const categories = scoreCategories(answers, questions);
  const ratings = answers.map((answer) => answer.rating);
  const bounds = extremes(ratings);

  const categoryAverages = categories
    .map((category) => category.average)
    .filter((average): average is ScaledRating => average !== null);

  return {
    // meanOfScaled, not mean: the category averages are ALREADY scaled, and
    // lifting them again would report 4.20 as 0.04.
    overallAverage: meanOfScaled(categoryAverages),
    categories,
    questions: scoreQuestions(answers, questions),
    distribution: distribution(ratings),
    median: median(ratings),
    highest: bounds?.highest ?? null,
    lowest: bounds?.lowest ?? null,
    answerCount: answers.length,
  };
}

/** Render an analytics figure for a boundary. Re-exported so callers need one import. */
export { formatRating };
