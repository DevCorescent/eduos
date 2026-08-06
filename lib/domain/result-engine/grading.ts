// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Grade Resolution
// LAYER  : Domain (pure)
// PURPOSE: Turn a percentage into a grade, and decide whether it is a pass.
//
// WHERE EVERY ACADEMIC JUDGEMENT COMES FROM
//   Letter, grade point, pass/fail, and CLASSIFICATION — distinction, first
//   class, second class, division, honours — all come from ONE place: the
//   tenant's GradeBand rows. The classification is the band's `label`, read
//   verbatim. There is deliberately no `if (percent >= 60) return "FIRST_CLASS"`
//   anywhere in this file, because two regulations disagree about where first
//   class begins and both are right. A band table is how a university says so.
//
//   Pass/fail has TWO owners and they are not in competition:
//     GradeBand.isPass    — did the mark clear the bar?
//     PassingCriterion    — was the student eligible to be graded at all, and
//                           did they clear each individual minimum?
//   A criterion failure OVERRIDES a passing band. It never promotes a failing
//   one, because a threshold is a floor, not a grade.
//
// BAND TABLE VALIDATION
//   The table is checked ONCE per scale and the checked form is reused across
//   every student in the cohort. That is not only a performance decision: a
//   table with a gap would otherwise fail for the one student who landed in it
//   and silently succeed for everyone else, which is the worst possible way to
//   discover a misconfiguration.
//
// COMPLEXITY
//   Validation O(n log n) once per scale, dominated by the sort. Lookup O(log n)
//   by binary search — a linear scan would be fine for a dozen bands, but the
//   lookup runs once per course per student and a 1000-student cohort with 100
//   courses calls it 100_000 times.
// ============================================================================

import { MARK_SCALE, RESULT_ENGINE_MESSAGE } from "@/lib/constants/resultEngine";
import { asPercentage, roundToPrecision } from "@/lib/domain/result-engine/decimal";
import {
  CriterionOutcome,
  PassingMetric,
  RoundingMode,
  ThresholdUnit,
} from "@/lib/domain/result-engine/enums";
import type {
  CriterionDefinition,
  CriterionFailure,
  EngineOutcome,
  GradeBandDefinition,
  GradeResolution,
  RoundingPolicy,
  Scaled,
} from "@/lib/domain/result-engine/types";

/** Machine-readable reasons a scale or a lookup was refused. */
export const GRADING_ERROR = {
  MISSING_BANDS: "MISSING_BANDS",
  UNREACHABLE_BAND: "UNREACHABLE_BAND",
  OVERLAPPING_BANDS: "OVERLAPPING_BANDS",
  BAND_GAP: "BAND_GAP",
  INCOMPLETE_COVERAGE: "INCOMPLETE_COVERAGE",
  DUPLICATE_GRADE: "DUPLICATE_GRADE",
  INVALID_SCALE: "INVALID_SCALE",
  NO_BAND: "NO_BAND",
} as const;

export type GradingErrorCode = (typeof GRADING_ERROR)[keyof typeof GRADING_ERROR];

/** The lowest percentage any band may cover. */
const FLOOR_PERCENT_SCALED: Scaled = 0;

/** The highest percentage any band may cover — 100.00. */
const CEILING_PERCENT_SCALED: Scaled = 100 * 10 ** MARK_SCALE;

/** One step at the working scale: the gap between two adjacent bands. */
const ONE_STEP: Scaled = 1;

/**
 * A band table that has been checked and ordered, ready for repeated lookup.
 *
 * Constructing one is the ONLY way to reach `resolveGrade`, so an unchecked
 * table cannot be used by accident. That is the type system carrying a rule
 * that a comment would not.
 */
export interface BandTable {
  /** Ascending by minPercent, which is what the binary search relies on. */
  readonly bands: readonly GradeBandDefinition[];
  /** The lowest percentage that still passes — GRACE lifts toward this. */
  readonly passMarkScaled: Scaled | null;
  /**
   * The band a fail override awards. The non-passing band covering the bottom
   * of the scale, chosen by position rather than by letter so no grade name is
   * hardcoded. Null when the scale declares no failing band at all.
   */
  readonly failBand: GradeBandDefinition | null;
  readonly maxGradePointScaled: Scaled;
}

function failure(
  code: GradingErrorCode,
  message: string,
  subject?: string
): EngineOutcome<never> {
  return { ok: false, failure: { code, message, subject } };
}

/**
 * Check a scale's bands and prepare them for lookup.
 *
 * Rejects, in this order:
 *   - a table with no bands, which can grade nothing
 *   - a band whose minimum exceeds its maximum, which no percentage can reach
 *   - a grade point outside [0, maxGradePoint], which the scale's own ceiling
 *     forbids
 *   - two bands sharing a letter, which makes a grade ambiguous
 *   - overlapping bands, where one percentage would resolve two ways
 *   - a gap, where a percentage resolves no way at all
 *   - coverage that does not span the whole of [0.00, 100.00]
 *
 * The bounds are BOTH INCLUSIVE and adjacent bands differ by exactly one step
 * at the working scale — 39.99 then 40.00. That convention is C1's, and this
 * enforces it rather than inventing a second one.
 *
 * COMPLEXITY : O(n log n) for the sort, O(n) for the sweep. Run once per scale.
 */
export function prepareBandTable(
  bands: readonly GradeBandDefinition[],
  maxGradePointScaled: Scaled
): EngineOutcome<BandTable> {
  if (bands.length === 0) {
    return failure(GRADING_ERROR.MISSING_BANDS, "The grade scale declares no bands");
  }

  const seenGrades = new Set<string>();

  for (const band of bands) {
    if (band.minPercentScaled > band.maxPercentScaled) {
      return failure(
        GRADING_ERROR.UNREACHABLE_BAND,
        "A band's minimum exceeds its maximum, so no percentage can reach it",
        band.grade
      );
    }

    if (band.gradePointScaled < 0 || band.gradePointScaled > maxGradePointScaled) {
      return failure(
        GRADING_ERROR.INVALID_SCALE,
        "A band awards a grade point outside the scale's own ceiling",
        band.grade
      );
    }

    if (seenGrades.has(band.grade)) {
      return failure(
        GRADING_ERROR.DUPLICATE_GRADE,
        "Two bands share one grade letter",
        band.grade
      );
    }

    seenGrades.add(band.grade);
  }

  // Copied before sorting: the caller's array is readonly and must stay as it
  // was handed over.
  const ordered = [...bands].sort((left, right) => {
    if (left.minPercentScaled !== right.minPercentScaled) {
      return left.minPercentScaled - right.minPercentScaled;
    }

    return left.sequence - right.sequence;
  });

  if (ordered[0].minPercentScaled !== FLOOR_PERCENT_SCALED) {
    return failure(
      GRADING_ERROR.INCOMPLETE_COVERAGE,
      "The lowest band does not start at 0.00",
      ordered[0].grade
    );
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];

    if (current.minPercentScaled <= previous.maxPercentScaled) {
      return failure(
        GRADING_ERROR.OVERLAPPING_BANDS,
        "Two bands cover the same percentage, so a mark would resolve two ways",
        current.grade
      );
    }

    if (current.minPercentScaled > previous.maxPercentScaled + ONE_STEP) {
      return failure(
        GRADING_ERROR.BAND_GAP,
        "A percentage between two bands would resolve to no grade",
        current.grade
      );
    }
  }

  const highest = ordered[ordered.length - 1];

  if (highest.maxPercentScaled !== CEILING_PERCENT_SCALED) {
    return failure(
      GRADING_ERROR.INCOMPLETE_COVERAGE,
      "The highest band does not reach 100.00",
      highest.grade
    );
  }

  let passMarkScaled: Scaled | null = null;
  let failBand: GradeBandDefinition | null = null;

  for (const band of ordered) {
    if (band.isPass) {
      // Ordered ascending, so the first passing band is the lowest one.
      if (passMarkScaled === null) {
        passMarkScaled = band.minPercentScaled;
      }
    } else if (failBand === null) {
      failBand = band;
    }
  }

  if (passMarkScaled === null) {
    return failure(
      GRADING_ERROR.INVALID_SCALE,
      "The grade scale declares no passing band, so nothing could ever pass"
    );
  }

  return {
    ok: true,
    value: { bands: ordered, passMarkScaled, failBand, maxGradePointScaled },
  };
}

/**
 * Find the band covering a percentage, by binary search.
 *
 * Both bounds are inclusive. The table is proven gapless and non-overlapping by
 * `prepareBandTable`, so at most one band can match and a miss means the input
 * itself was out of range rather than the table being wrong.
 *
 * COMPLEXITY : O(log n).
 */
export function findBand(
  table: BandTable,
  percentScaled: Scaled
): GradeBandDefinition | null {
  let low = 0;
  let high = table.bands.length - 1;

  while (low <= high) {
    const middle = (low + high) >>> 1;
    const band = table.bands[middle];

    if (percentScaled < band.minPercentScaled) {
      high = middle - 1;
    } else if (percentScaled > band.maxPercentScaled) {
      low = middle + 1;
    } else {
      return band;
    }
  }

  return null;
}

/**
 * Resolve a percentage to a grade.
 *
 * The percentage is rounded to the REGULATION's marks precision before lookup,
 * because that is the figure the regulation considers real. A scheme recording
 * whole percents means 59.6 is 60, and looking the unrounded value up would put
 * the student a band lower than their own transcript says they scored.
 *
 * Rounding happens HERE and nowhere else, so there is exactly one answer to
 * "which percentage decided the grade".
 *
 * COMPLEXITY : O(log n).
 */
export function resolveGrade(
  table: BandTable,
  percentScaled: Scaled,
  policy: RoundingPolicy
): EngineOutcome<GradeResolution> {
  const rounded = roundToPrecision(
    percentScaled,
    MARK_SCALE,
    policy.marksPrecision,
    policy.marksRounding
  );

  const band = findBand(table, rounded);

  if (band === null) {
    return failure(GRADING_ERROR.NO_BAND, RESULT_ENGINE_MESSAGE.NO_GRADE_BAND);
  }

  return {
    ok: true,
    value: {
      grade: band.grade,
      label: band.label,
      gradePointScaled: band.gradePointScaled,
      isPass: band.isPass,
      countsForGpa: band.countsForGpa,
      sequence: band.sequence,
      isOverridden: false,
    },
  };
}

/**
 * Force a resolved grade to a failure.
 *
 * Used when a mandatory component was not attempted, or a passing criterion was
 * missed. The awarded letter becomes the scale's own bottom band, so the grade
 * point that enters a GPA is the one the regulation chose for a failure — not
 * zero, which several scales do not use, and not the letter the raw mark would
 * have earned, which would put a distinction on a failed transcript.
 *
 * When a scale declares no failing band the letter is kept and only the verdict
 * flips: the alternative would be inventing a grade the scale does not contain.
 */
export function applyFailOverride(
  table: BandTable,
  resolution: GradeResolution
): GradeResolution {
  if (!resolution.isPass) {
    return { ...resolution, isOverridden: true };
  }

  const band = table.failBand;

  if (band === null) {
    return { ...resolution, isPass: false, isOverridden: true };
  }

  return {
    grade: band.grade,
    label: band.label,
    gradePointScaled: band.gradePointScaled,
    isPass: false,
    countsForGpa: band.countsForGpa,
    sequence: band.sequence,
    isOverridden: true,
  };
}

/** Everything a criterion sweep may need to compare a threshold against. */
export interface CriterionInputs {
  /** Each component's achieved value and its own maximum, by component id. */
  readonly componentScores: ReadonlyMap<
    string,
    { readonly valueScaled: Scaled; readonly maxScaled: Scaled }
  >;
  /** Null when the regulation reads attendance but none was supplied. */
  readonly attendancePercentScaled: Scaled | null;
  /** Credits earned this semester, for a semester-scoped criterion. */
  readonly semesterCreditsEarnedScaled: Scaled | null;
  /** How a PERCENT threshold's division is rounded. */
  readonly rounding: RoundingMode;
}

/**
 * Read the figure a criterion measures, on the unit it declares.
 *
 * Returns null when the metric cannot be evaluated from what is available — an
 * attendance minimum with no attendance recorded, or a component minimum naming
 * a component this scheme does not contain. A missing figure is NOT treated as
 * zero: failing a student for a number nobody supplied would be a fabrication.
 */
function readMetric(
  criterion: CriterionDefinition,
  inputs: CriterionInputs
): Scaled | null {
  switch (criterion.metric) {
    case PassingMetric.COMPONENT_SCORE: {
      if (criterion.componentId === null) {
        return null;
      }

      const score = inputs.componentScores.get(criterion.componentId);

      if (score === undefined) {
        return null;
      }

      if (criterion.unit === ThresholdUnit.PERCENT) {
        if (score.maxScaled === 0) {
          return null;
        }

        // Compared as a proportion of the component's own maximum, which is the
        // only reading of "at least 40% in the internals" that survives a
        // component being re-scaled between regulation versions. Exact integer
        // division, never a float — a threshold decided on 39.999999 would fail
        // a student who scored exactly the minimum.
        return asPercentage(score.valueScaled, score.maxScaled, inputs.rounding);
      }

      return score.valueScaled;
    }

    case PassingMetric.ATTENDANCE_PERCENT:
      return inputs.attendancePercentScaled;

    default:
      return inputs.semesterCreditsEarnedScaled;
  }
}

/**
 * Check every criterion, and report each one that was missed.
 *
 * Every criterion is evaluated — the sweep does not stop at the first failure —
 * because a student is entitled to know all of what they must clear, not just
 * whichever check happened to run first.
 *
 * A criterion whose figure is unavailable is SKIPPED rather than failed, and
 * the caller learns about it through the returned `unevaluated` list.
 *
 * COMPLEXITY : O(k) in the criteria, each lookup O(1).
 */
export function evaluateCriteria(
  criteria: readonly CriterionDefinition[],
  inputs: CriterionInputs
): {
  readonly failures: readonly CriterionFailure[];
  readonly unevaluated: readonly string[];
} {
  const failures: CriterionFailure[] = [];
  const unevaluated: string[] = [];

  for (const criterion of criteria) {
    const actual = readMetric(criterion, inputs);

    if (actual === null) {
      unevaluated.push(criterion.code);
      continue;
    }

    if (actual >= criterion.thresholdScaled) {
      continue;
    }

    failures.push({
      code: criterion.code,
      metric: criterion.metric,
      thresholdScaled: criterion.thresholdScaled,
      actualScaled: actual,
      outcome: criterion.failureOutcome,
    });
  }

  return { failures, unevaluated };
}

/**
 * The harshest verdict among a set of criterion failures.
 *
 * INELIGIBLE outranks FAIL because the two are not degrees of the same thing: a
 * failed student was beaten and may re-sit, a barred student was never in the
 * examination. Reporting the milder of the two would tell them to re-sit
 * something they are not permitted to enter.
 */
export function worstOutcome(
  failures: readonly CriterionFailure[]
): CriterionOutcome | null {
  let worst: CriterionOutcome | null = null;

  for (const entry of failures) {
    if (entry.outcome === CriterionOutcome.INELIGIBLE) {
      return CriterionOutcome.INELIGIBLE;
    }

    worst = CriterionOutcome.FAIL;
  }

  return worst;
}

/**
 * Whether this scale can be resolved for one student in isolation.
 *
 * A RELATIVE scale grades by cohort position, so a single student has no grade
 * until the cohort exists. The per-student pass reports the scale as deferred
 * rather than guessing — the placeholder the brief asks for is exactly this
 * refusal, made explicit and reported, rather than a stub that returns a
 * plausible wrong answer.
 */
export const RELATIVE_GRADING_PENDING = "RELATIVE_GRADING";
