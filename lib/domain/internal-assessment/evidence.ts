// ============================================================================
// OWNER  : Gauransh
// MODULE : AI Assisted Internal Assessment (Phase 25)
// LAYER  : Domain
// PURPOSE: Reduce a student's raw academic record to the five normalised
//          signals the README names as inputs — attendance, assignments,
//          quizzes, practical work and prior performance — and define what
//          "confidence" means.
//
// EVERY SIGNAL IS A PROPORTION IN [0, 1], OR NULL
//   Normalising up front is what makes the inputs combinable at all: an
//   attendance percentage, a mark out of 20 and a CGPA out of 10 cannot be
//   averaged as they stand. NULL means "this student has no data for this
//   input" and is NEVER coerced to 0 — a student with no quizzes has not scored
//   zero on quizzes, and treating the two as the same would systematically
//   under-mark anyone whose course simply had none.
//
// THE WEIGHTS ARE NOT DEFINED IN THIS FILE
//   The README supplies no formula, and inventing one would produce a number
//   that looks computed and was in fact guessed. Instead the weights come from
//   the university's OWN Phase 16 EvaluationComponent configuration — a
//   university that has said "internal assessment is 40% assignments, 30%
//   quizzes, 30% attendance" has already stated its rule, and this module
//   applies that statement rather than a second one.
//
// CONFIDENCE IS DATA COMPLETENESS, AND NOTHING MORE
//   It is the share of the configured inputs for which this student had any
//   data at all. It is NOT a probability that the suggestion is correct — no
//   such quantity is defined anywhere in the README and none could honestly be
//   computed here. Naming it precisely is what stops it being read as one.
// ============================================================================

/** One normalised signal, or null when the student has no data for it. */
export type Signal = number | null;

/** The five inputs the README names. */
export interface EvidenceSignals {
  /** Share of held sessions the student attended. */
  readonly attendance: Signal;
  /** Mean assignment mark as a share of the marks available. */
  readonly assignment: Signal;
  /** Mean quiz mark as a share of the marks available. */
  readonly quiz: Signal;
  /** Mean practical / lab mark as a share of the marks available. */
  readonly practical: Signal;
  /** Prior academic standing, as a share of the maximum grade point. */
  readonly priorPerformance: Signal;
}

/** The raw counts each signal is derived from, reported alongside it. */
export interface EvidenceDetail {
  readonly attendance: { held: number; attended: number };
  readonly assignment: { graded: number; obtained: number; available: number };
  readonly quiz: { graded: number; obtained: number; available: number };
  readonly practical: { graded: number; obtained: number; available: number };
  /**
   * Marks earned in OTHER semesters, over the marks those assessments made
   * available.
   *
   * A proportion rather than a CGPA: nothing in the schema stores a cumulative
   * grade point, and Phase 16 computes one on demand through the result engine.
   * Calling that engine once per student would fan out over the whole cohort on
   * the generate path, so the underlying evidence is read instead — and it is
   * reported as what it is rather than dressed up as a CGPA it is not.
   */
  readonly priorPerformance: { graded: number; obtained: number; available: number };
}

/** Clamp a proportion into [0, 1]. */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;

  return Math.min(1, Math.max(0, value));
}

/**
 * A proportion, or null when the denominator is zero.
 *
 * The null is load-bearing: it is what distinguishes "scored nothing" from
 * "had nothing to score on", and every caller below depends on the difference.
 */
export function proportion(numerator: number, denominator: number): Signal {
  if (denominator <= 0) return null;

  return clamp01(numerator / denominator);
}

/**
 * Build the five signals from raw counts.
 *
 * Pure arithmetic over plain numbers — no database, no clock, no provider. That
 * is what lets the suggestion be reproduced and tested exactly.
 */
export function toSignals(detail: EvidenceDetail): EvidenceSignals {
  return {
    attendance: proportion(detail.attendance.attended, detail.attendance.held),
    assignment: proportion(detail.assignment.obtained, detail.assignment.available),
    quiz: proportion(detail.quiz.obtained, detail.quiz.available),
    practical: proportion(detail.practical.obtained, detail.practical.available),
    priorPerformance: proportion(
      detail.priorPerformance.obtained,
      detail.priorPerformance.available
    ),
  };
}

/** Which signal a configured component draws on. */
export type SignalKey = keyof EvidenceSignals;

/**
 * A weighted input, as the university configured it.
 *
 * `weight` is the component's own weightage from Phase 16. Nothing here decides
 * what it should be.
 */
export interface WeightedInput {
  readonly key: SignalKey;
  readonly weight: number;
}

/** What the deterministic calculation produced, and how well founded it is. */
export interface SuggestionBasis {
  /** The blended score in [0, 1], or null when no input had data. */
  readonly score: Signal;
  /** Share of configured inputs that had data, in [0, 1]. */
  readonly confidence: number;
  /** Inputs that contributed. */
  readonly used: readonly SignalKey[];
  /** Inputs that were configured but had no data for this student. */
  readonly missing: readonly SignalKey[];
}

/**
 * Blend the available signals using the university's configured weights.
 *
 * MISSING INPUTS ARE EXCLUDED AND THE REMAINING WEIGHTS ARE RENORMALISED.
 * A student whose course ran no quizzes must not be marked down by the quiz
 * weight; the alternative — treating the missing input as zero — would cap them
 * at (100 − quizWeight)% for a reason that has nothing to do with their work.
 * Renormalising means the suggestion is the best reading of the evidence that
 * EXISTS, and `confidence` is what reports how much of it that was.
 *
 * Returns a null score when no configured input had any data. There is nothing
 * to suggest from, and returning 0 would recommend awarding zero marks to a
 * student the system knows nothing about.
 *
 * COMPLEXITY: O(inputs), which is bounded by the number of configured
 * components — a handful.
 */
export function blend(
  signals: EvidenceSignals,
  inputs: readonly WeightedInput[]
): SuggestionBasis {
  const used: SignalKey[] = [];
  const missing: SignalKey[] = [];

  let weightedTotal = 0;
  let weightSum = 0;

  for (const input of inputs) {
    const value = signals[input.key];

    if (value === null) {
      missing.push(input.key);
      continue;
    }

    used.push(input.key);
    weightedTotal += value * input.weight;
    weightSum += input.weight;
  }

  // Confidence counts INPUTS, not weight. "Four of five inputs had data" is
  // what a faculty member needs to know; weighting the count would let one
  // heavily-weighted present input report high confidence while four others
  // were missing entirely.
  const confidence = inputs.length === 0 ? 0 : used.length / inputs.length;

  return {
    // weightSum can be zero even with used inputs, if every present component
    // was configured at weight zero. Guarded, because dividing by it would
    // produce NaN and NaN would serialise as null and look like "no data".
    score: weightSum > 0 ? clamp01(weightedTotal / weightSum) : null,
    confidence: Math.round(confidence * 1000) / 1000,
    used,
    missing,
  };
}

/**
 * Convert a blended score into marks out of a component's maximum.
 *
 * Rounded to two decimal places, matching the Decimal(6,2) columns every marks
 * value in this project uses — a suggestion carrying more precision than the
 * column that will store it would be silently rounded by PostgreSQL, and the
 * figure the faculty member saw would not be the figure stored.
 */
export function toMarks(score: Signal, maxMarks: number): number | null {
  if (score === null || maxMarks <= 0) return null;

  return Math.round(score * maxMarks * 100) / 100;
}
