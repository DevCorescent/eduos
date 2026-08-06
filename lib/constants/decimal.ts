// ============================================================================
// OWNER  : Gauransh
// MODULE : Core Infrastructure — Decimal Scale
// LAYER  : Constants
// PURPOSE: The decimal scale every Phase 16 numeric column shares, and the two
//          derived values that make an exact comparison possible.
//
//          Extracted from lib/constants/evaluationComponent.ts, where it was
//          declared, because C5's threshold column needs the identical rule.
//          A "shared" module reaching into a component-specific one would be
//          backwards layering, and a second copy of the tolerance would be a
//          second definition of what "exact" means.
// ============================================================================

/**
 * Decimal places carried by every marks, weight and threshold column in Phase
 * 16 — EvaluationComponent.maxMarks and .weightage, PassingCriterion.threshold,
 * GradeBand.minPercent and .gradePoint.
 */
export const DECIMAL_SCALE = 2;

/** The integer scaling factor implied by DECIMAL_SCALE — 100 for two places. */
export const DECIMAL_FACTOR = 10 ** DECIMAL_SCALE;

/**
 * Tolerance separating a two-decimal value from a three-decimal one.
 *
 * A two-decimal value scaled by 100 lands within roughly 1e-12 of an integer in
 * IEEE 754; a three-decimal value lands 0.5 away. 1e-9 sits well inside that
 * gap — loose enough that ordinary binary representation error never trips it,
 * tight enough that a genuine third decimal always does.
 */
export const SCALE_TOLERANCE = 1e-9;
