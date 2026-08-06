// ============================================================================
// OWNER  : Gauransh
// MODULE : Passing Criterion
// LAYER  : Constants
// PURPOSE: Every literal the Passing Criterion module would otherwise inline —
//          audit vocabulary, field bounds, and the metric/unit/scope coherence
//          tables the validation layer and the engine both read.
//
//          Authorisation is not redeclared here, for the same reason as C3 and
//          C4: a criterion belongs to the regulation that owns it.
// ============================================================================

import { PassingMetric, ThresholdUnit } from "@/app/generated/prisma/enums";

// --- Audit ------------------------------------------------------------------

export const PASSING_CRITERION_RESOURCE = "PassingCriterion";

export const PASSING_CRITERION_AUDIT_ACTION = {
  CREATED: "PASSING_CRITERION_CREATED",
  UPDATED: "PASSING_CRITERION_UPDATED",
  DELETED: "PASSING_CRITERION_DELETED",
} as const;

// --- Field bounds -----------------------------------------------------------

export const PASSING_CRITERION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/;

export const PASSING_CRITERION_CODE_MIN_LENGTH = 1;
export const PASSING_CRITERION_CODE_MAX_LENGTH = 30;
export const PASSING_CRITERION_NAME_MIN_LENGTH = 2;
export const PASSING_CRITERION_NAME_MAX_LENGTH = 150;
export const PASSING_CRITERION_DESCRIPTION_MAX_LENGTH = 1000;

/**
 * Bounds on `threshold`, matching Decimal(6,2).
 *
 * Zero is permitted and meaningful: a criterion requiring at least zero marks
 * is how a regulation records that a component is assessed but carries no
 * minimum, which is different from having no criterion at all.
 */
export const THRESHOLD_MIN = 0;
export const THRESHOLD_MAX = 9999.99;

/** A percentage threshold can never exceed 100, whatever the column allows. */
export const PERCENT_THRESHOLD_MAX = 100;

// --- Coherence tables -------------------------------------------------------

/**
 * The units each metric may be expressed in.
 *
 * Only COMPONENT_SCORE is genuinely ambiguous — "21 out of 70" and "30%" are
 * both real regulations, and the two diverge the moment a later scheme version
 * rescales the component, which is why the author's intent is stored rather
 * than converted. The other two metrics admit exactly one unit each, and the
 * validation layer rejects any other pairing rather than storing a combination
 * the engine would have to guess at.
 */
export const METRIC_UNITS: Readonly<Record<PassingMetric, readonly ThresholdUnit[]>> = {
  [PassingMetric.COMPONENT_SCORE]: [ThresholdUnit.MARKS, ThresholdUnit.PERCENT],
  [PassingMetric.ATTENDANCE_PERCENT]: [ThresholdUnit.PERCENT],
  [PassingMetric.SEMESTER_CREDITS_EARNED]: [ThresholdUnit.CREDITS],
};

/**
 * Metrics that constrain ONE component and therefore require a componentId.
 *
 * Attendance is a property of the student in the course and credits are a
 * property of the student in the semester; neither belongs to a component, and
 * naming one would imply a constraint the engine has no way to apply.
 */
export const COMPONENT_SCOPED_METRICS: readonly PassingMetric[] = [
  PassingMetric.COMPONENT_SCORE,
];

/**
 * Metrics evaluated once per student per SEMESTER rather than per course.
 *
 * Derived from the metric rather than stored as a scope column, because the
 * metric already determines it. The engine reads this to decide when a
 * criterion is evaluated: course-scoped criteria run while a course result is
 * computed, semester-scoped ones run once against the student's governing
 * regulation for that semester.
 */
export const SEMESTER_SCOPED_METRICS: readonly PassingMetric[] = [
  PassingMetric.SEMESTER_CREDITS_EARNED,
];

/** The two scopes a criterion can be evaluated at, reported in the DTO. */
export const CRITERION_SCOPE = {
  COURSE: "COURSE",
  SEMESTER: "SEMESTER",
} as const;

export type CriterionScope = (typeof CRITERION_SCOPE)[keyof typeof CRITERION_SCOPE];

// --- Messages ---------------------------------------------------------------

export const PASSING_CRITERION_MESSAGE = {
  NOT_FOUND: "Passing criterion not found",
  SCHEME_NOT_FOUND: "Evaluation scheme not found",
  COMPONENT_NOT_FOUND: "Target component not found in this scheme",
  SCHEME_NOT_MUTABLE: "Passing criteria can only be changed while the scheme is a draft",
  COMPONENT_REQUIRED: "This metric constrains one component and requires componentId",
  COMPONENT_FORBIDDEN: "This metric is not a property of a component",
  UNIT_NOT_PERMITTED: "The threshold unit is not valid for this metric",
  PERCENT_OUT_OF_RANGE: "A percentage threshold cannot exceed 100",
  THRESHOLD_EXCEEDS_COMPONENT: "The threshold exceeds the component's maximum marks",
} as const;
