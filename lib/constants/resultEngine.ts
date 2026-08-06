// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine
// LAYER  : Constants
// PURPOSE: The scales the engine computes in, the outcome vocabulary, and the
//          reasons a result cannot be produced.
//
//          There are no academic values here. No pass mark, no 40%, no 21, no
//          weightage, no grade letter. Every one of those comes from the
//          tenant's GradeScale, EvaluationScheme, EvaluationComponent,
//          EvaluationRule or PassingCriterion — which is the whole point of the
//          phase.
// ============================================================================

import { RuleOperation } from "@/app/generated/prisma/enums";

// --- Working scales ---------------------------------------------------------

/**
 * Decimal places the engine computes marks, percentages and weights in.
 *
 * Matches every Decimal(_, 2) column it reads, so a stored value converts
 * without loss. All arithmetic runs on INTEGERS at this scale — never floats —
 * because a grade is not a place to discover that 0.1 + 0.2 is not 0.3.
 */
export const MARK_SCALE = 2;

/**
 * Decimal places GPA division is carried out at, before rounding to the
 * regulation's own precision.
 *
 * Higher than MARK_SCALE deliberately: a grade-point average is a quotient, and
 * truncating it at two places before the regulation says to would silently
 * apply a rounding policy the regulation did not choose.
 */
export const GPA_SCALE = 6;

// --- Outcomes ---------------------------------------------------------------

/**
 * What the engine concluded about one course.
 *
 * PASS       — every passing criterion held and the awarded band is a pass.
 * FAIL       — the band is not a pass, or a criterion with a FAIL outcome was
 *              missed.
 * INELIGIBLE — a criterion with an INELIGIBLE outcome was missed. Distinct from
 *              FAIL because the student was barred rather than beaten: it is
 *              not cleared by re-sitting the same attempt.
 * WITHHELD   — a contributing mark is withheld, so no result may be stated.
 * INCOMPLETE — a mandatory component has no mark yet. Not a failure; the
 *              assessment simply has not finished.
 */
export const COURSE_OUTCOME = {
  PASS: "PASS",
  FAIL: "FAIL",
  INELIGIBLE: "INELIGIBLE",
  WITHHELD: "WITHHELD",
  INCOMPLETE: "INCOMPLETE",
} as const;

export type CourseOutcome = (typeof COURSE_OUTCOME)[keyof typeof COURSE_OUTCOME];

/** Outcomes that award credit and enter a grade average. */
export const CREDIT_BEARING_OUTCOMES: readonly CourseOutcome[] = [COURSE_OUTCOME.PASS];

/**
 * Outcomes for which no result may be published or averaged.
 *
 * A withheld or incomplete course is not a zero — averaging it as one would
 * punish a student for an assessment that has not concluded.
 */
export const UNRESOLVED_OUTCOMES: readonly CourseOutcome[] = [
  COURSE_OUTCOME.WITHHELD,
  COURSE_OUTCOME.INCOMPLETE,
];

// --- Deferred rules ---------------------------------------------------------

/**
 * Operations that CANNOT be evaluated for one student in isolation.
 *
 * The per-student calculator recognises them, refuses to guess, and reports
 * them as deferred. Applying a curve from one student's marks would be
 * meaningless; applying it to a cohort is a second pass over results the first
 * pass produced.
 *
 * Mirrors COHORT_SCOPED_OPERATIONS in the rule constants, restated here as the
 * engine's own view: the rule module says which operations are cohort-scoped,
 * this says what the calculator does about it.
 */
export const DEFERRED_OPERATIONS: readonly RuleOperation[] = [
  RuleOperation.MODERATION,
  RuleOperation.CURVE,
];

// --- Guards -----------------------------------------------------------------

/**
 * Deepest a formula may descend during EVALUATION.
 *
 * The validator already bounds a stored expression, but the evaluator walks
 * whatever the database hands it — which may predate a tightening — so it
 * enforces its own ceiling rather than trusting that the write path did.
 */
export const MAX_EVALUATION_DEPTH = 16;

/**
 * Total nodes the evaluator will visit before refusing to continue.
 *
 * The BREADTH guard, complementing MAX_EVALUATION_DEPTH above. A wide, shallow
 * expression never breaches the depth ceiling, so without this it would run to
 * whatever size the payload chose.
 *
 * Cycles are caught by DEPTH rather than by this, because every expansion along
 * a cyclic path descends a level. Detecting them by identity instead would need
 * a visited set that also rejects legitimately shared subtrees, so the two
 * budgets together are both cheaper and more permissive.
 */
export const MAX_EVALUATION_NODES = 256;

/**
 * Largest magnitude a formula constant may carry.
 *
 * Not arbitrary: JavaScript renders numbers at or above 1e21 in exponential
 * form, and the exact-decimal parser reads a plain decimal string. A constant
 * beyond this bound would be parsed from "1e+21" and produce a silently wrong
 * value, so it is refused instead.
 */
export const MAX_CONSTANT_MAGNITUDE = 1_000_000_000;

// --- Messages ---------------------------------------------------------------

export const RESULT_ENGINE_MESSAGE = {
  NO_GRADE_BAND: "No grade band covers the computed percentage",
  UNKNOWN_COMPONENT: "A mark cites a component that is not in this scheme",
  MISSING_MANDATORY: "A mandatory component has no recorded mark",
  WITHHELD_MARK: "A contributing mark is withheld",
  DIVISION_BY_ZERO: "A formula divided by zero",
  UNBOUND_VARIABLE: "A formula read a variable the engine could not bind",
  MAX_DEPTH: "A formula nested deeper than the engine will evaluate",
} as const;
