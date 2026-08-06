// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Component
// LAYER  : Constants
// PURPOSE: Every literal the Evaluation Component module would otherwise
//          inline — audit vocabulary, field bounds, tree limits, violation
//          codes and messages.
//
//          Authorisation is NOT redeclared here. A component is part of the
//          regulation that owns it, so the people who may read or amend a
//          scheme are exactly the people who may read or amend its components.
//          Both route files import EVALUATION_SCHEME_MANAGE_ROLES and
//          EVALUATION_SCHEME_READ_ROLES directly; a parallel set would be two
//          policies pretending to be one.
// ============================================================================

// --- Audit ------------------------------------------------------------------

/** AuditLog.resource value for every entry this module writes. */
export const EVALUATION_COMPONENT_RESOURCE = "EvaluationComponent";

export const EVALUATION_COMPONENT_AUDIT_ACTION = {
  CREATED: "EVALUATION_COMPONENT_CREATED",
  UPDATED: "EVALUATION_COMPONENT_UPDATED",
  DELETED: "EVALUATION_COMPONENT_DELETED",
} as const;

// --- Field bounds -----------------------------------------------------------

/**
 * Accepted shape of a component `code`.
 *
 * Same rule as a scheme code — upper-case alphanumeric with dashes and
 * underscores, leading on an alphanumeric — because both appear on transcripts
 * and neither may fork on case.
 */
export const EVALUATION_COMPONENT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/;

export const EVALUATION_COMPONENT_CODE_MIN_LENGTH = 1;
export const EVALUATION_COMPONENT_CODE_MAX_LENGTH = 30;
export const EVALUATION_COMPONENT_NAME_MIN_LENGTH = 2;
export const EVALUATION_COMPONENT_NAME_MAX_LENGTH = 150;
export const EVALUATION_COMPONENT_DESCRIPTION_MAX_LENGTH = 1000;

/**
 * Bounds on maxMarks, matching Decimal(6,2).
 *
 * The ceiling is the largest value the column can hold. Without it a caller
 * could submit a figure the schema accepts and the database rejects at INSERT —
 * the exact overflow recorded as TD-005 against ExamResult.marksObtained,
 * closed here at the boundary instead.
 *
 * The floor is above zero: a component worth no marks at all is a component
 * that should not exist.
 */
export const MAX_MARKS_MIN = 0.01;
export const MAX_MARKS_MAX = 9999.99;

/**
 * Bounds on weightage, matching Decimal(5,2) narrowed to a percentage.
 *
 * Zero is permitted — a component may be recorded and carry no weight, which is
 * how a purely diagnostic assessment is expressed.
 */
export const WEIGHTAGE_MIN = 0;
export const WEIGHTAGE_MAX = 100;

export const SEQUENCE_MIN = 1;
export const SEQUENCE_MAX = 999;

/** Bounds on ruleConfig.count for BEST_N and DROP_LOWEST_N. */
export const RULE_COUNT_MIN = 1;
export const RULE_COUNT_MAX = 100;

/** Bounds on an attendance band's marks award. */
export const ATTENDANCE_BAND_MARKS_MIN = 0;

// --- Aggregation policy -----------------------------------------------------
//
// Added for C7 Step 4. The result engine must not hardcode what an absent or
// withheld sitting means, because universities genuinely disagree: one scores
// absence as zero, another discounts the sitting entirely, a third fails the
// component outright. That choice belongs to the component's own parameter bag.
//
// These live here rather than with the engine because `ruleConfig` is this
// module's vocabulary, and because a plain z.object() STRIPS unknown keys —
// without declaring them in componentRuleConfigSchema, a stored policy would be
// silently discarded on write and the configurability would be unreachable.

/**
 * What an ABSENT sitting contributes.
 *
 * ZERO   — counts as a zero on its own scale, and still occupies its place in
 *          an average. The most common regulation, and the default.
 * IGNORE — excluded entirely: an average over three sittings with one absence
 *          divides by two, not three.
 * FAIL   — the component cannot be computed at all. Used where attendance at
 *          every sitting is itself the requirement.
 */
export const ABSENCE_POLICY = {
  ZERO: "ZERO",
  IGNORE: "IGNORE",
  FAIL: "FAIL",
} as const;

export type AbsencePolicy = (typeof ABSENCE_POLICY)[keyof typeof ABSENCE_POLICY];

/**
 * What a WITHHELD sitting does to the component.
 *
 * BLOCK  — no result may be stated while a contributing mark is withheld. The
 *          default, because withholding exists precisely to stop publication.
 * IGNORE — excluded from the aggregation, and the rest still computes.
 */
export const WITHHELD_POLICY = {
  BLOCK: "BLOCK",
  IGNORE: "IGNORE",
} as const;

export type WithheldPolicy = (typeof WITHHELD_POLICY)[keyof typeof WITHHELD_POLICY];

/** Defaults applied when a component's parameter bag says nothing. */
export const DEFAULT_ABSENCE_POLICY = ABSENCE_POLICY.ZERO;
export const DEFAULT_WITHHELD_POLICY = WITHHELD_POLICY.BLOCK;

// There is deliberately NO `failOnMissing` policy: EvaluationComponent already
// carries `isMandatory`, which says exactly that. A second switch for one fact
// is the duplication this phase forbids.

// --- Tree limits ------------------------------------------------------------

/**
 * The exact total a weighted sibling group must reach, in HUNDREDTHS.
 *
 * Integer hundredths, not 100.0, because the comparison must be exact.
 * weightage is Decimal(5,2) — exact base-10 — and three components of 33.33,
 * 33.33 and 33.34 total exactly 100.00 in decimal but 99.99999999999999 in IEEE
 * 754 binary. A regulation would be rejected by floating-point noise. Every
 * weight is therefore parsed into an integer number of hundredths and compared
 * against this.
 */
export const TOTAL_WEIGHTAGE_HUNDREDTHS = 10_000;

// DECIMAL_SCALE is no longer declared here. C5's threshold column needs the
// identical scale, so it moved to lib/constants/decimal.ts and is re-exported
// below — one definition, and existing importers of this module keep working.
export { DECIMAL_SCALE } from "@/lib/constants/decimal";

/**
 * Deepest permitted nesting, counting roots as depth 1.
 *
 * Real regulations nest two or three levels — course → internal → ST1. Five
 * leaves generous headroom while bounding the tree walk and stopping a
 * configuration error from producing a structure no grade card can render.
 */
export const MAX_TREE_DEPTH = 5;

// --- Violation vocabulary ---------------------------------------------------

/**
 * The machine-readable reasons a component tree is not fit for activation.
 *
 * Codes rather than prose so a client can branch on them and a UI can highlight
 * the offending node, while `message` stays free to be reworded.
 */
export const COMPONENT_TREE_VIOLATION = {
  EMPTY_TREE: "EMPTY_TREE",
  ORPHANED_NODE: "ORPHANED_NODE",
  CYCLE: "CYCLE",
  MAX_DEPTH_EXCEEDED: "MAX_DEPTH_EXCEEDED",
  WEIGHTAGE_TOTAL: "WEIGHTAGE_TOTAL",
  LEAF_MISSING_AGGREGATION: "LEAF_MISSING_AGGREGATION",
  LEAF_HAS_ROLLUP: "LEAF_HAS_ROLLUP",
  BRANCH_MISSING_ROLLUP: "BRANCH_MISSING_ROLLUP",
  BRANCH_HAS_AGGREGATION: "BRANCH_HAS_AGGREGATION",
  BRANCH_HAS_MARK_SOURCE: "BRANCH_HAS_MARK_SOURCE",
  DUPLICATE_ROOT_SEQUENCE: "DUPLICATE_ROOT_SEQUENCE",
  RULE_CONFIG_MISSING_COUNT: "RULE_CONFIG_MISSING_COUNT",
  RULE_CONFIG_MISSING_BANDS: "RULE_CONFIG_MISSING_BANDS",
} as const;

export type ComponentTreeViolationCode =
  (typeof COMPONENT_TREE_VIOLATION)[keyof typeof COMPONENT_TREE_VIOLATION];

// --- Messages ---------------------------------------------------------------

export const EVALUATION_COMPONENT_MESSAGE = {
  NOT_FOUND: "Evaluation component not found",
  SCHEME_NOT_FOUND: "Evaluation scheme not found",
  PARENT_NOT_FOUND: "Parent component not found in this scheme",
  SCHEME_NOT_MUTABLE: "Components can only be changed while the scheme is a draft",
  DUPLICATE_SEQUENCE: "Another component already occupies this position among its siblings",
  AGGREGATION_AND_ROLLUP: "A component cannot declare both an aggregation and a rollup",
  CYCLE: "A component cannot be moved beneath its own descendant",
  RULE_CONFIG_COUNT_REQUIRED: "This aggregation requires ruleConfig.count",
  RULE_CONFIG_BANDS_REQUIRED: "An attendance-derived component requires ruleConfig.attendanceBands",
  TREE_INVALID: "The evaluation scheme's component tree is not valid for activation",
} as const;

/** Prefix for the `field` of a tree violation, e.g. "components.ST1.weightage". */
export const COMPONENT_FIELD_PREFIX = "components";
