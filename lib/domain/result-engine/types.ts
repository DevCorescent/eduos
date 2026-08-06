// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Shared Types
// LAYER  : Domain (pure)
// PURPOSE: Every shape the calculation engine passes between its stages.
//
// TWO CONVENTIONS RUN THROUGH ALL OF IT
//
//   1. Everything is `readonly`. The engine is a fold from configuration and
//      marks to a result, and a stage that mutated its input would make the
//      order of stages load-bearing in a way no test could pin down. Immutable
//      inputs mean any stage can be re-run on the same data and produce the
//      same answer — which IS the reproducibility requirement, expressed in the
//      type system.
//
//   2. Every number is a `Scaled` integer, never a float and never a Decimal
//      instance. Conversion happens once, at the boundary, and everything
//      afterwards is exact integer arithmetic. A type called `number` that
//      sometimes means 33.5 and sometimes means 3350 would be the single
//      easiest way to produce wrong grades, so the alias exists to make the
//      distinction visible at every signature.
//
// The Prisma imports below are TYPE-ONLY and therefore erased at compile time:
// the engine's runtime graph contains no database code at all.
// ============================================================================

import type {
  ComponentAggregation,
  ComponentRollup,
  ComponentSource,
  CourseOutcome,
  CriterionOutcome,
  FormulaVariable,
  MarkStatus,
  PassingMetric,
  RoundingMode,
  RulePhase,
  RuleOperation,
  ThresholdUnit,
} from "@/lib/domain/result-engine/enums";

/**
 * An exact value held as an integer at a declared scale.
 *
 * At MARK_SCALE, 3350 means 33.50. At GPA_SCALE, 8_571_429 means 8.571429.
 * Which scale applies is stated by the field's name and its documentation —
 * every field carrying MARK_SCALE ends in `Scaled`, and the two GPA fields say
 * so explicitly.
 */
export type Scaled = number;

// --- Configuration, as the engine consumes it -------------------------------

/**
 * One node of the assessment tree, converted to engine form.
 *
 * A projection of EvaluationComponent rather than the record itself: the engine
 * must not depend on a repository's select shape, and the conversion is where
 * Decimal becomes Scaled exactly once.
 */
export interface ComponentDefinition {
  readonly id: string;
  readonly code: string;
  readonly parentComponentId: string | null;
  readonly sequence: number;
  /** The scale this component contributes on. */
  readonly maxMarksScaled: Scaled;
  /** Percentage contribution to its parent, or to the course total at a root. */
  readonly weightageScaled: Scaled;
  /** How this component's own repeated sittings reduce. Leaves only. */
  readonly aggregation: ComponentAggregation | null;
  /** How this component's children combine. Branches only. */
  readonly rollup: ComponentRollup | null;
  readonly sourceType: ComponentSource;
  /** Whether a missing mark blocks the result or is treated as unattempted. */
  readonly isMandatory: boolean;
  /** Parameters for the aggregation and the mark source. Shape validated on write. */
  readonly ruleConfig: unknown;
}

/** One policy transform, converted to engine form. */
export interface RuleDefinition {
  readonly id: string;
  readonly code: string;
  /** Null when the rule transforms the course total rather than one component. */
  readonly componentId: string | null;
  readonly phase: RulePhase;
  readonly operation: RuleOperation;
  readonly sequence: number;
  readonly config: unknown;
  readonly condition: unknown;
}

/** One minimum threshold, converted to engine form. */
export interface CriterionDefinition {
  readonly id: string;
  readonly code: string;
  readonly componentId: string | null;
  readonly metric: PassingMetric;
  readonly thresholdScaled: Scaled;
  readonly unit: ThresholdUnit;
  readonly failureOutcome: CriterionOutcome;
}

/** One grade band, converted to engine form. */
export interface GradeBandDefinition {
  readonly grade: string;
  readonly label: string | null;
  /** Both bounds inclusive; the set tiles [0.00, 100.00]. */
  readonly minPercentScaled: Scaled;
  readonly maxPercentScaled: Scaled;
  readonly gradePointScaled: Scaled;
  readonly isPass: boolean;
  readonly countsForGpa: boolean;
  readonly sequence: number;
}

/**
 * The arithmetic policy a regulation declares.
 *
 * Carried through every stage rather than read from a global, because two
 * students in the same cohort may be graded under different scheme versions —
 * and each must be rounded the way ITS regulation said.
 */
export interface RoundingPolicy {
  readonly marksRounding: RoundingMode;
  readonly marksPrecision: number;
  readonly gpaRounding: RoundingMode;
  readonly gpaPrecision: number;
}

// --- Marks, as the engine consumes them -------------------------------------

/**
 * One student's mark at one sitting.
 *
 * `maxMarksScaled` is the SITTING's own total, not the component's — a paper
 * set out of 25 and contributing on a scale of 20 is an ordinary arrangement,
 * and normalising against the wrong one would misprice every mark on it.
 */
export interface AssessmentValue {
  readonly componentId: string;
  /** Which sitting of the component; what LATEST orders by. */
  readonly sequenceNumber: number;
  readonly maxMarksScaled: Scaled;
  /** Null exactly when the status is ABSENT. */
  readonly marksScaled: Scaled | null;
  readonly status: MarkStatus;
}

// --- Evaluation contexts ----------------------------------------------------

/** The variables a formula or condition may read, and their bound values. */
export type VariableBindings = Readonly<Partial<Record<FormulaVariable, Scaled>>>;

/**
 * What the formula evaluator needs.
 *
 * The rounding mode travels with the bindings because DIVIDE and MULTIPLY both
 * need one, and taking it from anywhere else would let two formulas in the same
 * regulation round differently.
 */
export interface FormulaContext {
  readonly bindings: VariableBindings;
  readonly rounding: RoundingMode;
}

/**
 * The broader context a rule is applied in.
 *
 * `passMarkScaled` is present for GRACE alone, which is the one operation that
 * consults a threshold — and does not own it. The engine supplies it from the
 * lowest passing grade band so the rule stays a pure numeric transform.
 */
export interface EvaluationContext extends FormulaContext {
  readonly policy: RoundingPolicy;
  readonly passMarkScaled: Scaled | null;
}

/** Applying one rule to one value. */
export interface RuleContext {
  readonly rule: RuleDefinition;
  readonly valueScaled: Scaled;
  /** The scale the value sits on — a component's maximum, or 100 at course level. */
  readonly maxScaled: Scaled;
  readonly evaluation: EvaluationContext;
}

/** Reducing one component's sittings to a single figure. */
export interface AggregationContext {
  readonly component: ComponentDefinition;
  readonly sessions: readonly AssessmentValue[];
  readonly rounding: RoundingMode;
}

// --- Stage outputs ----------------------------------------------------------

/** Why the engine could not produce a value. */
export interface EvaluationFailure {
  readonly code: string;
  readonly message: string;
  /** The component or rule the failure is attributable to, when there is one. */
  readonly subject?: string;
}

/**
 * The result of any stage that can fail.
 *
 * A discriminated union rather than an exception, because a batch computing a
 * thousand students must record which one could not be computed and carry on —
 * a throw would abandon the other nine hundred and ninety-nine.
 */
export type EngineOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: EvaluationFailure };

/** What one component contributed, and how it got there. */
export interface ComponentResult {
  readonly componentId: string;
  readonly code: string;
  readonly isLeaf: boolean;
  /** After session aggregation, before any component-level rule. */
  readonly rawScaled: Scaled;
  /** After component-level rules. */
  readonly adjustedScaled: Scaled;
  readonly maxMarksScaled: Scaled;
  /** What this component added to its parent's total, in percentage points. */
  readonly contributionScaled: Scaled;
  /** Sittings that fed it — 0 means nothing was recorded. */
  readonly sessionCount: number;
}

/**
 * The band a percentage fell in, and what it awards.
 *
 * `label` is where CLASSIFICATION lives — "Distinction", "First Class", "First
 * Division", "Honours". There is no separate classification column in GradeBand
 * and there must not be one here either: a university that awards a distinction
 * configures a band labelled that, and an engine that computed the label from a
 * percentage would be hardcoding the very policy this phase exists to remove.
 * Two regulations disagree about where first class begins; both are right, and
 * only their own band tables can say.
 */
export interface GradeResolution {
  readonly grade: string;
  /** The band's classification text, verbatim from configuration. */
  readonly label: string | null;
  readonly gradePointScaled: Scaled;
  readonly isPass: boolean;
  readonly countsForGpa: boolean;
  /** The band's position in its scale — what a grade card orders by. */
  readonly sequence: number;
  /** True when a criterion or a mandatory failure overrode the band's verdict. */
  readonly isOverridden: boolean;
}

/** A criterion the student did not meet. */
export interface CriterionFailure {
  readonly code: string;
  readonly metric: PassingMetric;
  readonly thresholdScaled: Scaled;
  readonly actualScaled: Scaled;
  readonly outcome: CriterionOutcome;
}

/**
 * One course, computed.
 *
 * `pendingCohortRules` is not an error. MODERATION, CURVE and a RELATIVE grade
 * scale cannot be evaluated for one student in isolation, so the per-student
 * pass reports them and a cohort pass applies them — recording which ones are
 * outstanding is what makes that second pass auditable rather than implicit.
 */
export interface CourseResultValue {
  readonly courseRegistrationId: string;
  readonly evaluationSchemeId: string;
  readonly components: readonly ComponentResult[];
  /** The course total as a percentage, after every applicable rule. */
  readonly percentageScaled: Scaled;
  readonly grade: GradeResolution | null;
  readonly outcome: CourseOutcome;
  readonly creditsScaled: Scaled;
  /** Credits actually earned — zero unless the outcome awards them. */
  readonly creditsEarnedScaled: Scaled;
  readonly failedCriteria: readonly CriterionFailure[];
  readonly pendingCohortRules: readonly string[];
}

/** A credit-weighted average and what went into it. */
export interface GpaResult {
  /** Null when nothing carried credit — not zero, which would rank a student bottom. */
  readonly valueScaled: Scaled | null;
  /** GPA_SCALE, not MARK_SCALE. */
  readonly scale: number;
  readonly creditsAttemptedScaled: Scaled;
  readonly creditsEarnedScaled: Scaled;
  readonly coursesCounted: number;
}

/** One semester, computed. */
export interface SemesterResultValue {
  readonly semesterId: string;
  readonly courses: readonly CourseResultValue[];
  readonly sgpa: GpaResult;
  readonly backlogCount: number;
  readonly isPromoted: boolean;
}

/** One line of a transcript — the foundation C9 will build on. */
export interface TranscriptRow {
  readonly semesterId: string;
  readonly creditsRegisteredScaled: Scaled;
  readonly creditsEarnedScaled: Scaled;
  readonly sgpaScaled: Scaled | null;
  readonly cgpaScaled: Scaled | null;
  readonly backlogCount: number;
}

// --- Ranking ----------------------------------------------------------------

/** One competitor in a ranking. */
export interface RankEntry {
  readonly subjectId: string;
  /** Null entries are excluded from the ranking rather than ranked last. */
  readonly valueScaled: Scaled | null;
}

/** A subject's position, and how many shared it. */
export interface RankPosition {
  readonly subjectId: string;
  readonly rank: number;
  readonly outOf: number;
  readonly isTied: boolean;
}

/** What a ranking pass needs. */
export interface RankContext {
  readonly entries: readonly RankEntry[];
  /** Standard competition ranking leaves gaps after a tie; dense does not. */
  readonly dense: boolean;
}

// --- Orchestration ----------------------------------------------------------

/**
 * Everything the course calculator needs, gathered once.
 *
 * Deliberately a single immutable bundle rather than a long parameter list: a
 * cohort computation loads this ONCE per scheme and reuses it across every
 * student, which is what keeps the batch path free of repeated tree building
 * and repeated queries.
 */
export interface CalculatorContext {
  readonly evaluationSchemeId: string;
  readonly components: readonly ComponentDefinition[];
  readonly rules: readonly RuleDefinition[];
  readonly criteria: readonly CriterionDefinition[];
  readonly gradeBands: readonly GradeBandDefinition[];
  readonly policy: RoundingPolicy;
  /** True when the scale grades by cohort position rather than by percentage. */
  readonly isRelativeGrading: boolean;
}

/** One student's inputs for one course. */
export interface CourseCalculationInput {
  readonly courseRegistrationId: string;
  readonly creditsScaled: Scaled;
  readonly marks: readonly AssessmentValue[];
  /** Present when the regulation reads attendance, absent otherwise. */
  readonly attendancePercentScaled: Scaled | null;
}
