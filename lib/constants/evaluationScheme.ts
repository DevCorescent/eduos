// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Scheme
// LAYER  : Constants
// PURPOSE: Every literal the Evaluation Scheme module would otherwise inline —
//          authorised role sets, audit vocabulary, field bounds, lifecycle
//          transitions and messages.
//
//          One module, one place. A role set restated in four route files
//          drifts; a status transition restated in the service and the tests
//          stops being a specification and becomes two opinions.
// ============================================================================

// Imported from the generated `enums` module rather than from `client`.
// `client` builds the PrismaClient class at module load; `enums` is nothing but
// frozen const objects. Since the service imports this file, taking the lighter
// path keeps lib/db/prisma out of the service's runtime graph and lets the unit
// tests run with no database and no environment.
import { EvaluationSchemeStatus } from "@/app/generated/prisma/enums";
import { ROLES } from "@/constants/roles";

// --- Authorization ----------------------------------------------------------

/**
 * Roles permitted to create, amend, activate, archive or discard a regulation.
 *
 * Deliberately narrow. An evaluation scheme decides how every student in a
 * programme is graded, so authorship sits with the university administration
 * and the examination controller — not with a department or a lecturer.
 */
export const EVALUATION_SCHEME_MANAGE_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CONTROLLER_OF_EXAMINATION,
] as const;

/**
 * Roles permitted to read regulations.
 *
 * Wider than the manage set by design: a head of department reviewing a
 * curriculum, and a lecturer who must know how their course is weighted, both
 * need to read the rulebook they are governed by. Students are excluded — a
 * regulation is reported to them through their grade card, not as raw
 * configuration.
 */
export const EVALUATION_SCHEME_READ_ROLES = [
  ...EVALUATION_SCHEME_MANAGE_ROLES,
  ROLES.DEPARTMENT_HOD,
  ROLES.FACULTY,
] as const;

// --- Audit ------------------------------------------------------------------

/** AuditLog.resource value for every entry this module writes. */
export const EVALUATION_SCHEME_RESOURCE = "EvaluationScheme";

/**
 * AuditLog.action vocabulary.
 *
 * Prefixed with the resource so the action is self-describing when read out of
 * context in a cross-resource audit query, which is how AuditLog is indexed
 * (@@index([resource, resourceId]) and @@index([createdAt])).
 */
export const EVALUATION_SCHEME_AUDIT_ACTION = {
  CREATED: "EVALUATION_SCHEME_CREATED",
  UPDATED: "EVALUATION_SCHEME_UPDATED",
  ACTIVATED: "EVALUATION_SCHEME_ACTIVATED",
  ARCHIVED: "EVALUATION_SCHEME_ARCHIVED",
  DELETED: "EVALUATION_SCHEME_DELETED",
} as const;

export type EvaluationSchemeAuditAction =
  (typeof EVALUATION_SCHEME_AUDIT_ACTION)[keyof typeof EVALUATION_SCHEME_AUDIT_ACTION];

// --- Field bounds -----------------------------------------------------------

/**
 * Accepted shape of `code`.
 *
 * Upper-case alphanumeric with dashes and underscores, starting on an
 * alphanumeric. The code is the stable identifier a regulation keeps across
 * every version, and it appears on transcripts, so it is normalised at the
 * boundary rather than left to whatever a spreadsheet import supplies. Case is
 * fixed because "BTECH-R2023" and "btech-r2023" must not become two families.
 */
export const EVALUATION_SCHEME_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/;

export const EVALUATION_SCHEME_CODE_MIN_LENGTH = 2;
export const EVALUATION_SCHEME_CODE_MAX_LENGTH = 40;
export const EVALUATION_SCHEME_NAME_MIN_LENGTH = 2;
export const EVALUATION_SCHEME_NAME_MAX_LENGTH = 150;
export const EVALUATION_SCHEME_DESCRIPTION_MAX_LENGTH = 1000;

/**
 * Bounds on marksPrecision and gpaPrecision.
 *
 * Zero is permitted — a regulation may publish whole-number marks. Six is a
 * deliberate ceiling well above any real policy: the columns are plain Int, so
 * without a bound a caller could store a precision no decimal arithmetic can
 * honour. This is the same class of gap recorded as TD-005, closed at the
 * boundary rather than left to the column.
 */
export const PRECISION_MIN = 0;
export const PRECISION_MAX = 6;

/** Version number assigned to the first revision of a regulation. */
export const FIRST_VERSION = 1;

// --- Lifecycle --------------------------------------------------------------

/**
 * The complete state machine, as data.
 *
 * Declared once so the service enforces it and the tests assert against the
 * same source rather than a re-typed copy. ARCHIVED is terminal: an archived
 * regulation is never revived, because reviving one would silently change the
 * meaning of results already computed under it. The correct move is always a
 * new version.
 */
export const EVALUATION_SCHEME_TRANSITIONS: Readonly<
  Record<EvaluationSchemeStatus, readonly EvaluationSchemeStatus[]>
> = {
  [EvaluationSchemeStatus.DRAFT]: [EvaluationSchemeStatus.ACTIVE],
  [EvaluationSchemeStatus.ACTIVE]: [EvaluationSchemeStatus.ARCHIVED],
  [EvaluationSchemeStatus.ARCHIVED]: [],
};

/** The only status in which a regulation may be amended or discarded. */
export const EVALUATION_SCHEME_MUTABLE_STATUS = EvaluationSchemeStatus.DRAFT;

// --- Messages ---------------------------------------------------------------

/**
 * Every message this module raises through AppError.
 *
 * Written once so the same condition cannot be described two ways in two
 * methods. Phrased for the caller, never leaking an internal identifier.
 */
export const EVALUATION_SCHEME_MESSAGE = {
  NOT_FOUND: "Evaluation scheme not found",
  GRADE_SCALE_NOT_FOUND: "Grade scale not found",
  GRADE_SCALE_NOT_ACTIVE: "Grade scale must be active before a scheme citing it can be activated",
  DRAFT_ALREADY_EXISTS: "A draft revision of this scheme code already exists",
  NOT_MUTABLE: "Only a draft evaluation scheme can be modified or deleted",
  INVALID_TRANSITION: "Evaluation scheme cannot move to the requested status",
} as const;

// List ordering is NOT declared here. It is a property of the query itself and
// lives beside that query, in evaluationScheme.repository.ts.
