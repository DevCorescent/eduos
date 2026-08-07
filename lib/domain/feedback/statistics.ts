// ============================================================================
// OWNER  : Gauransh
// MODULE : Feedback — Statistics
// LAYER  : Domain (pure)
// PURPOSE: The exact-arithmetic primitives every other feedback module builds
//          on — mean, median, distribution and response rate.
//
// PURITY
//   No Prisma, no HTTP, no repository, no service, no DTO, no clock. Every
//   input is plain data and every answer is a value.
//
// WHY THIS REUSES THE RESULT ENGINE'S DECIMAL MODULE
//   `divideRounded` already exists in lib/domain/result-engine/decimal.ts and
//   is the project's single implementation of "divide two integers and round by
//   an explicit policy". A second copy here would be a second chance to get
//   HALF_EVEN wrong, and the two would drift the first time one was fixed. It
//   is pure arithmetic with no Prisma client behind it, so importing it costs
//   nothing this module was trying to avoid.
//
// EVERY AVERAGE IS AN INTEGER AT RATING_SCALE
//   A rating is a whole number 1..5, but a MEAN of ratings is a quotient. Three
//   fours and two fives average 4.4; nine fours and one five average 4.1; and
//   a cohort of seven averaging 4.285714... must round once, predictably, at
//   the scale the report prints. Carrying that as a float would let the same
//   cohort produce 4.29 in one place and 4.28 in another.
//
// NULL MEANS "NO DATA", NEVER ZERO
//   A faculty member with no responses has NO average. Reporting 0.00 would put
//   them bottom of a comparison they never entered — the same rule Phase 16
//   applies to a GPA with no credit-bearing courses.
//
// COMPLEXITY
//   Mean, distribution and response rate O(n), single pass. Median O(n log n),
//   one sort over a COPY — a caller's array is theirs.
// ============================================================================

import { RoundingMode } from "@/app/generated/prisma/enums";
import { divideRounded, formatScaled } from "@/lib/domain/result-engine/decimal";
import { RATING_MAX, RATING_MIN, RATING_SCALE } from "@/lib/constants/feedback";

/** An exact value held as an integer at RATING_SCALE. 433 means 4.33. */
export type ScaledRating = number;

/** 10^RATING_SCALE, the factor a mean is lifted by before dividing. */
const SCALE_FACTOR = 10 ** RATING_SCALE;

/**
 * The rounding every feedback average uses.
 *
 * HALF_UP, and fixed rather than configurable: unlike a GPA — where the
 * regulation chooses and Phase 16 honours that choice — a feedback average is
 * an internal quality metric with no regulation behind it. One rule, declared
 * once, is better than a setting nobody will ever deliberately change.
 */
const ROUNDING = RoundingMode.HALF_UP;

/** How many responses gave each rating on the scale. */
export interface RatingDistribution {
  /** Indexed by rating value. Every value on the scale is present, even at 0. */
  readonly counts: ReadonlyMap<number, number>;
  readonly total: number;
}

/**
 * The mean of a set of ratings, exact, at RATING_SCALE.
 *
 * The numerator is lifted BEFORE the division, so the quotient lands at the
 * working scale rather than being computed and then scaled — dividing first
 * would discard the digits the scale exists to keep.
 *
 * Returns null for an empty set. See the file header.
 *
 * COMPLEXITY : O(n), one pass.
 */
export function mean(ratings: readonly number[]): ScaledRating | null {
  if (ratings.length === 0) {
    return null;
  }

  let total = 0;

  for (const rating of ratings) {
    total += rating;
  }

  return divideRounded(total * SCALE_FACTOR, ratings.length, ROUNDING);
}

/**
 * The median of a set of ratings, at RATING_SCALE.
 *
 * An even-sized set takes the mean of the two middle values, computed exactly —
 * a median reported as 4.4999999 for a middle pair of 4 and 5 would be
 * indefensible on a published report.
 *
 * COMPLEXITY : O(n log n), one sort over a copy.
 */
export function median(ratings: readonly number[]): ScaledRating | null {
  if (ratings.length === 0) {
    return null;
  }

  // Copied before sorting; the caller's array is theirs.
  const ordered = [...ratings].sort((left, right) => left - right);
  const middle = ordered.length >>> 1;

  if (ordered.length % 2 === 1) {
    return ordered[middle] * SCALE_FACTOR;
  }

  return divideRounded((ordered[middle - 1] + ordered[middle]) * SCALE_FACTOR, 2, ROUNDING);
}

/**
 * How many responses gave each rating.
 *
 * EVERY value on the scale appears, including those nobody chose. A histogram
 * missing its empty bars is a histogram a reader misinterprets — "no 1-star
 * ratings" and "1-star not shown" look identical when the bar is simply absent.
 *
 * COMPLEXITY : O(n + k), where k is the scale's width.
 */
export function distribution(ratings: readonly number[]): RatingDistribution {
  const counts = new Map<number, number>();

  for (let value = RATING_MIN; value <= RATING_MAX; value += 1) {
    counts.set(value, 0);
  }

  let total = 0;

  for (const rating of ratings) {
    // A rating outside the scale is counted in the total but has no bar. It
    // should be unreachable — validation refuses one — and silently dropping it
    // would make the bars disagree with the count that sits beside them.
    const held = counts.get(rating);

    if (held !== undefined) {
      counts.set(rating, held + 1);
    }

    total += 1;
  }

  return { counts, total };
}

/**
 * What share of an eligible cohort responded, as a percentage at RATING_SCALE.
 *
 * Returns null when nobody was eligible — a response rate over an empty cohort
 * is not zero percent, it is undefined, and printing 0.00% would suggest a
 * failure of engagement where there was no cohort to engage.
 *
 * COMPLEXITY : O(1).
 */
export function responseRate(
  responded: number,
  eligible: number
): ScaledRating | null {
  if (eligible <= 0) {
    return null;
  }

  return divideRounded(responded * 100 * SCALE_FACTOR, eligible, ROUNDING);
}

/**
 * A credit-style weighted mean: Σ(weight × value) / Σ(weight).
 *
 * Used for a category score, where questions carry different weights. Both sums
 * are exact integers and the numerator is lifted before dividing, for the same
 * reason `mean` does it.
 *
 * A zero total weight returns null rather than zero: questions that all weigh
 * nothing produce no score, and reporting 0.00 would read as a terrible one.
 *
 * COMPLEXITY : O(n), one pass.
 */
export function weightedMean(
  terms: readonly { readonly weightScaled: number; readonly value: number }[]
): ScaledRating | null {
  let numerator = 0;
  let denominator = 0;

  for (const term of terms) {
    numerator += term.weightScaled * term.value;
    denominator += term.weightScaled;
  }

  if (denominator === 0) {
    return null;
  }

  return divideRounded(numerator * SCALE_FACTOR, denominator, ROUNDING);
}

/**
 * The mean of values that are ALREADY at RATING_SCALE.
 *
 * Distinct from `mean`, which lifts raw whole-number ratings. Feeding scaled
 * values to that one would scale them twice; feeding raw values to this one
 * would report 4 as 0.04. The two exist separately because the alternative —
 * one function and a "isScaled" flag — is a flag a caller passes wrongly.
 *
 * COMPLEXITY : O(n), one pass, exact integer division throughout.
 */
export function meanOfScaled(values: readonly ScaledRating[]): ScaledRating | null {
  if (values.length === 0) {
    return null;
  }

  let total = 0;

  for (const value of values) {
    total += value;
  }

  return divideRounded(total, values.length, ROUNDING);
}

/**
 * Divide a doubly-scaled value back down to RATING_SCALE.
 *
 * Exact integer division, not `value / 100` — a float divide here would be the
 * one place this module quietly reintroduced the error it exists to prevent,
 * and the result would still look like a plausible integer.
 */
export function descale(value: ScaledRating | null): ScaledRating | null {
  return value === null ? null : divideRounded(value, SCALE_FACTOR, ROUNDING);
}

/** The highest and lowest rating given. Null for an empty set. */
export function extremes(
  ratings: readonly number[]
): { readonly highest: number; readonly lowest: number } | null {
  if (ratings.length === 0) {
    return null;
  }

  let highest = ratings[0];
  let lowest = ratings[0];

  for (const rating of ratings) {
    if (rating > highest) {
      highest = rating;
    }

    if (rating < lowest) {
      lowest = rating;
    }
  }

  return { highest, lowest };
}

/**
 * Render a scaled rating as a lossless decimal string.
 *
 * String rather than number, for the same reason every computed decimal in this
 * project crosses a boundary as one: a JSON number hands the client back the
 * float problem this module spent its whole existence avoiding.
 */
export function formatRating(value: ScaledRating | null): string | null {
  return value === null ? null : formatScaled(value, RATING_SCALE);
}
