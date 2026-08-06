// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Exact Arithmetic
// LAYER  : Domain (pure)
// PURPOSE: Every number the engine computes, as scaled INTEGERS.
//
// WHY NOT FLOATS
//   A grade is not a place to discover that 0.1 + 0.2 is not 0.3. Every value
//   the engine reads is an exact base-10 Decimal(_, 2); doing arithmetic on the
//   float conversions would let a student's grade depend on binary
//   representation error. C3 already proved the case concretely: 28.10 + 35.95
//   + 35.95 is exactly 100 in decimal and 100.00000000000001 in IEEE 754.
//
//   So a "mark" here is an integer count of hundredths, and every operation
//   below is integer arithmetic with an explicit rounding decision.
//
// MAGNITUDES
//   The largest intermediate is a weighted contribution: a mark (≤ 999_999 at
//   this scale) times a weight (≤ 10_000), giving ≤ 1e10 — comfortably inside
//   the 2^53 range where a JavaScript number is an exact integer. The GPA
//   numerator is smaller still. Nothing here can silently lose precision to
//   magnitude.
// ============================================================================

import { RoundingMode } from "@/app/generated/prisma/enums";
import { GPA_SCALE, MARK_SCALE } from "@/lib/constants/resultEngine";
import { parseHundredths, type DecimalLike } from "@/lib/domain/evaluationComponentTree";

/**
 * Read an exact decimal into scaled integer form.
 *
 * Delegates to the parser C3 already relies on rather than defining a second
 * one — two implementations of "what does 33.34 mean" is exactly the drift this
 * module exists to prevent. It would ideally live here rather than beside the
 * component tree, but moving it would modify a completed component.
 */
export function toScaled(value: DecimalLike): number {
  return parseHundredths(value);
}

/** 10^n, as an integer. */
function pow10(exponent: number): number {
  return 10 ** exponent;
}

/**
 * Divide two integers and round the remainder by an explicit policy.
 *
 * The single place a rounding decision is taken. Every mode is implemented on
 * the REMAINDER rather than by converting to a float and calling Math.round —
 * which would reintroduce the representation error this module avoids, and
 * cannot express HALF_EVEN at all.
 *
 * Sign is handled by magnitude, so FLOOR and CEILING mean toward negative and
 * positive infinity respectively — not toward and away from zero. A regulation
 * that says "always round down" means down, including below zero.
 *
 * Returns 0 for a zero denominator; every caller that could produce one guards
 * it and reports the condition rather than relying on this.
 */
export function divideRounded(
  numerator: number,
  denominator: number,
  mode: RoundingMode
): number {
  if (denominator === 0) {
    return 0;
  }

  const isNegative = numerator < 0 !== denominator < 0;
  const absNumerator = Math.abs(numerator);
  const absDenominator = Math.abs(denominator);

  const quotient = Math.floor(absNumerator / absDenominator);
  const remainder = absNumerator - quotient * absDenominator;

  if (remainder === 0) {
    return isNegative ? -quotient : quotient;
  }

  const doubled = remainder * 2;
  let rounded: number;

  switch (mode) {
    case RoundingMode.FLOOR:
      // Toward negative infinity: a negative quotient grows in magnitude.
      rounded = isNegative ? quotient + 1 : quotient;
      break;
    case RoundingMode.CEILING:
      rounded = isNegative ? quotient : quotient + 1;
      break;
    case RoundingMode.HALF_DOWN:
      rounded = doubled > absDenominator ? quotient + 1 : quotient;
      break;
    case RoundingMode.HALF_EVEN:
      if (doubled > absDenominator) {
        rounded = quotient + 1;
      } else if (doubled < absDenominator) {
        rounded = quotient;
      } else {
        // Exactly half: to the even neighbour. This is what removes the
        // systematic upward bias HALF_UP introduces across a cohort.
        rounded = quotient % 2 === 0 ? quotient : quotient + 1;
      }
      break;
    default:
      rounded = doubled >= absDenominator ? quotient + 1 : quotient;
      break;
  }

  return isNegative ? -rounded : rounded;
}

/**
 * Round a scaled value to a coarser number of decimal places, keeping its
 * scale.
 *
 * Rounding 3355 (33.55 at MARK_SCALE) to one place yields 3360 (33.60) — still
 * at MARK_SCALE, so downstream arithmetic needs no unit conversion. Asking for
 * MORE places than the value carries is a no-op rather than an error: precision
 * cannot be invented.
 */
export function roundToPrecision(
  value: number,
  valueScale: number,
  precision: number,
  mode: RoundingMode
): number {
  if (precision >= valueScale) {
    return value;
  }

  const factor = pow10(valueScale - precision);
  return divideRounded(value, factor, mode) * factor;
}

/**
 * A component's contribution to its parent: value × weight%, normalised by the
 * component's own maximum.
 *
 * `(marks / maxMarks) × weightage`, computed as one integer expression so the
 * intermediate ratio is never rounded. Rounding `marks / maxMarks` first would
 * discard up to half a hundredth per component, and a tree of eight components
 * would carry that error into the course total.
 *
 * Returns 0 for a zero maximum, which the tree validator already forbids.
 */
export function weightedContribution(
  valueScaled: number,
  maxScaled: number,
  weightScaled: number,
  mode: RoundingMode
): number {
  if (maxScaled === 0) {
    return 0;
  }

  return divideRounded(valueScaled * weightScaled, maxScaled, mode);
}

/**
 * A percentage of a maximum: value / max × 100, at MARK_SCALE.
 *
 * `valueScaled` and `maxScaled` share a scale, so their ratio is a pure number
 * and the scale cancels. Reaching MARK_SCALE therefore needs the ratio lifted
 * by 100 (to make it a percentage) AND by 10^MARK_SCALE — putting BOTH factors
 * on the numerator. An earlier revision had 10^MARK_SCALE on the denominator as
 * well, where it cancelled the one above it and returned whole percents: 25 of
 * 30 came back as 83 rather than 83.33, and every grade band boundary would
 * have been decided on a truncated figure.
 */
export function asPercentage(
  valueScaled: number,
  maxScaled: number,
  mode: RoundingMode
): number {
  if (maxScaled === 0) {
    return 0;
  }

  return divideRounded(valueScaled * 100 * pow10(MARK_SCALE), maxScaled, mode);
}

/** One weighted term of an average — a credit value and the point it carries. */
export interface WeightedTerm {
  weightScaled: number;
  valueScaled: number;
}

/**
 * A credit-weighted average, carried at GPA_SCALE.
 *
 * SGPA = Σ(credits × points) / Σ(credits). Both sums are exact integers, and
 * the numerator is lifted to GPA_SCALE BEFORE the division rather than after —
 * dividing first and scaling second would round away the very digits the
 * regulation's precision setting exists to control.
 *
 * A zero total weight returns null rather than zero: a student with no
 * credit-bearing results has no average, and reporting 0.00 would put them
 * bottom of a merit list they do not belong on.
 */
export function creditWeightedAverage(
  terms: readonly WeightedTerm[],
  mode: RoundingMode
): number | null {
  let numerator = 0;
  let denominator = 0;

  for (const term of terms) {
    numerator += term.weightScaled * term.valueScaled;
    denominator += term.weightScaled;
  }

  if (denominator === 0) {
    return null;
  }

  // numerator is at MARK_SCALE², denominator at MARK_SCALE, so their quotient
  // is at MARK_SCALE. Lifting by the remaining places puts it at GPA_SCALE.
  const lift = pow10(GPA_SCALE - MARK_SCALE);

  return divideRounded(numerator * lift, denominator, mode);
}

/**
 * Render a scaled integer as an exact decimal string.
 *
 * String rather than number, for the same reason every Phase 16 DTO reports a
 * Decimal as a string: a JSON number would hand the caller back the float
 * problem this module spent its whole existence avoiding.
 */
export function formatScaled(value: number, scale: number): string {
  const isNegative = value < 0;
  const absolute = Math.abs(value);
  const factor = pow10(scale);

  const whole = Math.floor(absolute / factor);
  const sign = isNegative ? "-" : "";

  if (scale === 0) {
    return `${sign}${whole}`;
  }

  const fraction = absolute - whole * factor;

  return `${sign}${whole}.${String(fraction).padStart(scale, "0")}`;
}

/** Convenience: render at MARK_SCALE. */
export function formatMark(value: number): string {
  return formatScaled(value, MARK_SCALE);
}
