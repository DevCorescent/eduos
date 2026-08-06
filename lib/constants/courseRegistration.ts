// ============================================================================
// OWNER  : Gauransh
// MODULE : Course Registration
// LAYER  : Constants
// PURPOSE: Every literal the Course Registration module would otherwise inline
//          — authorised role sets, audit vocabulary, the lifecycle state
//          machine, the attempt/type coherence tables and field bounds.
// ============================================================================

import { RegistrationStatus, RegistrationType } from "@/app/generated/prisma/enums";
import { ROLES } from "@/constants/roles";

// --- Authorization ----------------------------------------------------------

/**
 * Roles permitted to register, amend or withdraw a student.
 *
 * An enrolment is the academic contract every downstream engine reads, so
 * authorship sits with the registry and the examination controller. A lecturer
 * may read a roster but may not decide who is on it.
 */
export const REGISTRATION_MANAGE_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CONTROLLER_OF_EXAMINATION,
] as const;

/**
 * Roles permitted to read any registration in the tenant.
 *
 * FACULTY is included because the roster is what a lecturer enters marks
 * against; DEPARTMENT_HOD because programme planning reads enrolment counts.
 */
export const REGISTRATION_READ_ROLES = [
  ...REGISTRATION_MANAGE_ROLES,
  ROLES.DEPARTMENT_HOD,
  ROLES.FACULTY,
] as const;

/** The role confined to its own enrolments — never another student's. */
export const REGISTRATION_SELF_ROLE = ROLES.STUDENT;

// --- Audit ------------------------------------------------------------------

export const COURSE_REGISTRATION_RESOURCE = "CourseRegistration";

export const COURSE_REGISTRATION_AUDIT_ACTION = {
  REGISTERED: "COURSE_REGISTRATION_REGISTERED",
  BULK_REGISTERED: "COURSE_REGISTRATION_BULK_REGISTERED",
  UPDATED: "COURSE_REGISTRATION_UPDATED",
} as const;

// --- Lifecycle --------------------------------------------------------------

/**
 * The complete state machine, as data.
 *
 * Declared once so the service enforces it and the tests assert against the
 * same source rather than a re-typed copy. Every terminal state has an empty
 * list: a discharged, withdrawn, dropped or cancelled enrolment is history, and
 * reviving one would silently change what a past roster contained.
 */
export const REGISTRATION_TRANSITIONS: Readonly<
  Record<RegistrationStatus, readonly RegistrationStatus[]>
> = {
  [RegistrationStatus.REGISTERED]: [
    RegistrationStatus.CONFIRMED,
    RegistrationStatus.DROPPED,
    RegistrationStatus.CANCELLED,
  ],
  [RegistrationStatus.CONFIRMED]: [
    RegistrationStatus.WITHDRAWN,
    RegistrationStatus.COMPLETED,
    RegistrationStatus.CANCELLED,
  ],
  [RegistrationStatus.DROPPED]: [],
  [RegistrationStatus.WITHDRAWN]: [],
  [RegistrationStatus.COMPLETED]: [],
  [RegistrationStatus.CANCELLED]: [],
};

/**
 * Statuses in which an enrolment is live.
 *
 * The single most consulted list in the module: a student may hold at most ONE
 * active enrolment per course, which is the rule that closes duplicate
 * registration and duplicate attempt together.
 */
export const ACTIVE_REGISTRATION_STATUSES: readonly RegistrationStatus[] = [
  RegistrationStatus.REGISTERED,
  RegistrationStatus.CONFIRMED,
];

// --- Attempt coherence ------------------------------------------------------

/** Attempt numbers start here. Server-assigned, never accepted from a client. */
export const FIRST_ATTEMPT = 1;

/**
 * Types valid on a FIRST attempt.
 *
 * A first sitting cannot be a backlog, an improvement or a repeat — each of
 * those describes a relationship to an earlier attempt that does not exist.
 */
export const FIRST_ATTEMPT_TYPES: readonly RegistrationType[] = [
  RegistrationType.REGULAR,
  RegistrationType.ELECTIVE,
  RegistrationType.OPEN_ELECTIVE,
  RegistrationType.AUDIT,
  RegistrationType.CREDIT_TRANSFER,
];

/**
 * Types valid on a SECOND or later attempt.
 *
 * The complement of the list above, and deliberately exclusive of it: a second
 * REGULAR registration for the same course is incoherent — whatever the reason
 * for re-sitting, it is one of these three.
 */
export const REATTEMPT_TYPES: readonly RegistrationType[] = [
  RegistrationType.BACKLOG,
  RegistrationType.IMPROVEMENT,
  RegistrationType.REPEAT,
];

/**
 * Types that carry no credit toward the degree.
 *
 * Derived from the type by the DTO rather than stored as a flag, because the
 * type already settles it and a column able to disagree would be a second
 * source of truth.
 */
export const NON_CREDIT_TYPES: readonly RegistrationType[] = [RegistrationType.AUDIT];

// --- Bulk bounds ------------------------------------------------------------

/**
 * Largest batch one bulk registration may carry.
 *
 * Chosen to exceed any real teaching cohort while bounding the work a single
 * request can demand: the whole batch is validated in memory and inserted in
 * one statement, so this caps both the memory held and the size of the
 * transaction taken.
 */
export const MAX_BULK_REGISTRATIONS = 500;

// --- Messages ---------------------------------------------------------------

export const COURSE_REGISTRATION_MESSAGE = {
  NOT_FOUND: "Course registration not found",
  STUDENT_NOT_FOUND: "Student not found",
  COURSE_NOT_FOUND: "Course not found",
  SEMESTER_NOT_FOUND: "Semester not found",
  SECTION_NOT_FOUND: "Section not found",
  SCHEME_NOT_FOUND: "Evaluation scheme not found",
  SCHEME_NOT_ACTIVE:
    "A registration must cite an ACTIVE evaluation scheme, so the regulation it is graded under cannot change afterwards",
  ALREADY_REGISTERED: "The student already holds an active registration for this course",
  INVALID_FIRST_ATTEMPT:
    "A first attempt cannot be a backlog, improvement or repeat registration",
  INVALID_REATTEMPT:
    "A second or later attempt must be a backlog, improvement or repeat registration",
  INVALID_TRANSITION: "The registration cannot move to the requested status",
  IMMUTABLE_FIELD:
    "Student, course, semester, programme, credits, evaluation scheme and attempt number are fixed at registration",
  DUPLICATE_STUDENT_IDS: "The same student appears more than once in this batch",
} as const;

/** The reasons a student can be skipped by a bulk registration. */
export const BULK_SKIP_REASON = {
  ALREADY_REGISTERED: "ALREADY_REGISTERED",
} as const;

export type BulkSkipReason = (typeof BULK_SKIP_REASON)[keyof typeof BULK_SKIP_REASON];
