// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Rule
// LAYER  : Constants
// PURPOSE: Every literal the Evaluation Rule module would otherwise inline —
//          audit vocabulary, field bounds, the formula and condition
//          whitelists, and the limits that bound a tenant-supplied expression.
//
//          Authorisation is NOT redeclared. A rule is part of the regulation
//          that owns it, so the roles that may read or amend a scheme are
//          exactly the roles that may read or amend its rules; both route files
//          will import EVALUATION_SCHEME_MANAGE_ROLES and
//          EVALUATION_SCHEME_READ_ROLES directly.
// ============================================================================

import { RuleOperation, RulePhase } from "@/app/generated/prisma/enums";

// --- Audit ------------------------------------------------------------------

export const EVALUATION_RULE_RESOURCE = "EvaluationRule";

export const EVALUATION_RULE_AUDIT_ACTION = {
  CREATED: "EVALUATION_RULE_CREATED",
  UPDATED: "EVALUATION_RULE_UPDATED",
  DELETED: "EVALUATION_RULE_DELETED",
} as const;

// --- Field bounds -----------------------------------------------------------

/** Same shape as a scheme and a component code, for the same reasons. */
export const EVALUATION_RULE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/;

export const EVALUATION_RULE_CODE_MIN_LENGTH = 1;
export const EVALUATION_RULE_CODE_MAX_LENGTH = 30;
export const EVALUATION_RULE_NAME_MIN_LENGTH = 2;
export const EVALUATION_RULE_NAME_MAX_LENGTH = 150;
export const EVALUATION_RULE_DESCRIPTION_MAX_LENGTH = 1000;

export const RULE_SEQUENCE_MIN = 1;
export const RULE_SEQUENCE_MAX = 999;

/**
 * Bounds on every numeric rule parameter.
 *
 * Wide enough for any real policy — a 9999.99 bonus is absurd but storable —
 * and narrow enough that a parameter can never produce a value the Decimal(6,2)
 * columns downstream cannot hold. This is the TD-005 overflow class closed at
 * the boundary rather than at the column.
 */
export const RULE_AMOUNT_MIN = -9999.99;
export const RULE_AMOUNT_MAX = 9999.99;

/** A percentage adjustment. Negative is legitimate — a penalty is a rule too. */
export const RULE_PERCENT_MIN = -100;
export const RULE_PERCENT_MAX = 100;

/**
 * Bounds on SCALE's multiplier.
 *
 * Strictly positive: a zero factor silently annihilates a component's marks and
 * a negative one inverts them, and neither is a scaling policy — both are
 * configuration mistakes that would be discovered as wrong grades.
 */
export const RULE_FACTOR_MIN = 0.01;
export const RULE_FACTOR_MAX = 100;

/** Bounds on CAP and FLOOR limits, and on GRACE's maximum award. */
export const RULE_LIMIT_MIN = 0;
export const RULE_LIMIT_MAX = 9999.99;

/** Bounds on MODERATION's target spread. Zero would collapse the cohort. */
export const RULE_STDDEV_MIN = 0.01;
export const RULE_STDDEV_MAX = 100;

// --- Formula whitelist ------------------------------------------------------

/**
 * The node kinds a custom formula may contain.
 *
 * A closed whitelist is the entire security model. Nothing in this system will
 * ever evaluate a tenant-supplied string — a formula is a typed tree whose node
 * kinds are enumerated here, so an expression can express arithmetic and
 * nothing else. There is no function call node, no property access, no
 * assignment, and no way to reach a host object.
 */
export const FORMULA_NODE_KIND = {
  CONST: "CONST",
  VAR: "VAR",
  BINARY: "BINARY",
} as const;

export type FormulaNodeKind = (typeof FORMULA_NODE_KIND)[keyof typeof FORMULA_NODE_KIND];

/**
 * The operators a formula may apply.
 *
 * MIN and MAX are included because clamping is the single most common thing a
 * formula does, and expressing it as division-free arithmetic would be worse.
 */
export const FORMULA_OPERATOR = {
  ADD: "ADD",
  SUBTRACT: "SUBTRACT",
  MULTIPLY: "MULTIPLY",
  DIVIDE: "DIVIDE",
  MIN: "MIN",
  MAX: "MAX",
} as const;

export type FormulaOperator = (typeof FORMULA_OPERATOR)[keyof typeof FORMULA_OPERATOR];

/**
 * The variables the engine binds when it evaluates a formula or a condition.
 *
 * Whitelisted, not open: the engine must know in advance what it has to supply,
 * and an unrecognised name must be a configuration error caught at save time
 * rather than an undefined at grade-computation time.
 *
 * VALUE              — the figure flowing into this rule's stage.
 * MAX_MARKS          — the target's maximum, for normalising and clamping.
 * ATTENDANCE_PERCENT — the student's attendance in the course.
 * COURSE_TOTAL       — the course total. Bound only at COURSE_ADJUSTMENT; the
 *                      service rejects it at an earlier phase, where it does
 *                      not yet exist.
 */
export const FORMULA_VARIABLE = {
  VALUE: "VALUE",
  MAX_MARKS: "MAX_MARKS",
  ATTENDANCE_PERCENT: "ATTENDANCE_PERCENT",
  COURSE_TOTAL: "COURSE_TOTAL",
} as const;

export type FormulaVariable = (typeof FORMULA_VARIABLE)[keyof typeof FORMULA_VARIABLE];

/** Variables that only exist once every component has rolled up. */
export const COURSE_SCOPED_VARIABLES: readonly FormulaVariable[] = [FORMULA_VARIABLE.COURSE_TOTAL];

/**
 * Deepest permitted formula nesting, and the ceiling on total nodes.
 *
 * Both are load-bearing, not tidiness. A JSON body may nest arbitrarily, and a
 * recursive validator over an unbounded tree is a stack-overflow denial of
 * service reachable by any authenticated administrator. The validator walks
 * ITERATIVELY and refuses anything past these limits, so the work a single
 * request can demand is bounded before any of it is done.
 *
 * Eight levels expresses (a + b) * clamp(c, d, e) style arithmetic with room to
 * spare; sixty-four nodes is far beyond any real grading formula.
 */
export const MAX_FORMULA_DEPTH = 8;
export const MAX_FORMULA_NODES = 64;

// --- Condition whitelist ----------------------------------------------------

/**
 * Comparators a rule condition may use.
 *
 * No equality on floating figures beyond EQ, which is retained because a
 * condition on an integer-valued variable is legitimate. Ordering comparators
 * cover every stated policy: "grace only when the total is below the pass mark"
 * and "bonus only above 90% attendance".
 */
export const CONDITION_COMPARATOR = {
  GT: "GT",
  GTE: "GTE",
  LT: "LT",
  LTE: "LTE",
  EQ: "EQ",
} as const;

export type ConditionComparator =
  (typeof CONDITION_COMPARATOR)[keyof typeof CONDITION_COMPARATOR];

/**
 * Maximum comparisons in one condition.
 *
 * A condition is a FLAT conjunction, deliberately — not a nested boolean tree.
 * Every policy named for this phase is expressible as "all of these hold", and
 * a flat list needs no recursion, no depth limit and no lazy schema. Nesting
 * can arrive later as a JSON shape change with no migration, if a real
 * requirement ever demands it.
 */
export const MAX_CONDITION_CLAUSES = 8;

// --- Phase / scope coherence ------------------------------------------------

/**
 * Phases that transform ONE component's figures and therefore require a
 * componentId. COURSE_ADJUSTMENT is the complement: it transforms the course
 * total and must NOT name a component.
 */
export const COMPONENT_SCOPED_PHASES: readonly RulePhase[] = [
  RulePhase.SESSION_ADJUSTMENT,
  RulePhase.COMPONENT_ADJUSTMENT,
];

/**
 * Operations that cannot be computed for one student in isolation.
 *
 * Derived from the operation rather than stored as a column, because the
 * operation already determines it — a second column would be a second source of
 * truth. The batch engine reads this to decide whether a scheme can be computed
 * per student or must be computed cohort-wide.
 */
export const COHORT_SCOPED_OPERATIONS: readonly RuleOperation[] = [
  RuleOperation.MODERATION,
  RuleOperation.CURVE,
];

// --- Messages ---------------------------------------------------------------

export const EVALUATION_RULE_MESSAGE = {
  NOT_FOUND: "Evaluation rule not found",
  SCHEME_NOT_FOUND: "Evaluation scheme not found",
  COMPONENT_NOT_FOUND: "Target component not found in this scheme",
  SCHEME_NOT_MUTABLE: "Rules can only be changed while the scheme is a draft",
  DUPLICATE_SEQUENCE: "Another rule already occupies this position in the same phase",
  COMPONENT_REQUIRED: "This phase transforms one component and requires componentId",
  COMPONENT_FORBIDDEN: "A course-level phase must not name a component",
  CONFIG_REQUIRED: "This operation requires configuration",
  CONFIG_MISMATCH: "The supplied configuration does not match the operation",
  COURSE_VARIABLE_TOO_EARLY:
    "COURSE_TOTAL is only available at the course-adjustment phase",
} as const;
