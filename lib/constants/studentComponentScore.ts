// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Component Score
// LAYER  : Constants
// PURPOSE: Every literal the marks module would otherwise inline — the two
//          authorisation sets, audit vocabulary, batch bounds, status
//          invariants and messages.
// ============================================================================

import { MarkStatus, RegistrationStatus } from "@/app/generated/prisma/enums";
import { ROLES } from "@/constants/roles";

// --- Authorization ----------------------------------------------------------

/**
 * Roles permitted to upload INTERNAL marks.
 *
 * FACULTY is admitted here and nowhere else — a lecturer marks their own
 * continuous assessment. Admitting them is not sufficient on its own, though:
 * see FACULTY_RESTRICTED_TO_OWN_EVENTS below.
 */
export const INTERNAL_MARK_UPLOAD_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CONTROLLER_OF_EXAMINATION,
  ROLES.FACULTY,
] as const;

/**
 * Roles permitted to upload EXTERNAL marks.
 *
 * FACULTY is deliberately absent. A university examination is marked under the
 * examination controller's authority, and a lecturer must never be able to
 * enter one.
 */
export const EXTERNAL_MARK_UPLOAD_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CONTROLLER_OF_EXAMINATION,
] as const;

/** Roles permitted to read a marks sheet. */
export const MARK_READ_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CONTROLLER_OF_EXAMINATION,
  ROLES.DEPARTMENT_HOD,
  ROLES.FACULTY,
] as const;

/**
 * A FACULTY caller may upload only to sittings they conduct.
 *
 * This is the rule that makes the internal/external split real rather than
 * cosmetic. Admitting FACULTY to /internal by role alone would let a lecturer
 * upload the end-semester theory marks through it — the exact thing the
 * external endpoint exists to prevent.
 *
 * Gating by COMPONENT TYPE instead was rejected: it would hardcode which
 * assessments are "internal" into application code, and this phase exists to
 * make that a tenant's configuration rather than ours. Whether a lecturer runs
 * a given sitting is a fact the sitting already records.
 */
export const FACULTY_RESTRICTED_TO_OWN_EVENTS = true;

// --- Audit ------------------------------------------------------------------

export const STUDENT_COMPONENT_SCORE_RESOURCE = "StudentComponentScore";

export const MARK_AUDIT_ACTION = {
  INTERNAL_UPLOADED: "STUDENT_MARKS_INTERNAL_UPLOADED",
  EXTERNAL_UPLOADED: "STUDENT_MARKS_EXTERNAL_UPLOADED",
} as const;

export type MarkUploadAction = (typeof MARK_AUDIT_ACTION)[keyof typeof MARK_AUDIT_ACTION];

// --- Batch bounds -----------------------------------------------------------

/**
 * Largest batch one upload may carry.
 *
 * A single upload is a batch of one, so no separate endpoint exists for it. The
 * ceiling bounds both the memory one request holds and the size of the
 * transaction it takes; a thousand covers any real teaching cohort in one call.
 */
export const MAX_BULK_MARKS = 1000;

/** Bounds on a mark. The upper bound is the SITTING's total, checked in the service. */
export const MARK_MIN = 0;

/** Longest permitted remark. */
export const MARK_REMARKS_MAX_LENGTH = 500;

// --- Status invariants ------------------------------------------------------

/**
 * Statuses that REQUIRE a mark to be present.
 *
 * The complement of ABSENT. A withheld mark is a mark being withheld — a
 * student who did not sit is ABSENT, not withheld — so only absence carries a
 * null.
 */
export const STATUSES_REQUIRING_MARKS: readonly MarkStatus[] = [
  MarkStatus.RECORDED,
  MarkStatus.WITHHELD,
];

/** The one status that forbids a mark. */
export const STATUS_WITHOUT_MARKS = MarkStatus.ABSENT;

/**
 * Registration statuses that may receive marks.
 *
 * A withdrawn, dropped, completed or cancelled enrolment is history; recording
 * a mark against one would attach an assessment to a contract that has ended.
 */
export const MARKABLE_REGISTRATION_STATUSES: readonly RegistrationStatus[] = [
  RegistrationStatus.REGISTERED,
  RegistrationStatus.CONFIRMED,
];

// --- Messages ---------------------------------------------------------------

export const MARK_MESSAGE = {
  EVENT_NOT_FOUND: "Assessment event not found",
  EVENT_NOT_OPEN:
    "Marks may only be recorded while the assessment event is OPEN; it is locked, published or not yet opened",
  COMPONENT_NOT_FOUND: "Evaluation component not found",
  SCHEME_NOT_ACTIVE:
    "The regulation governing this assessment is no longer active, so marks cannot be recorded under it",
  REGISTRATION_NOT_FOUND: "One or more course registrations were not found in this tenant",
  REGISTRATION_WRONG_COURSE:
    "A registration does not belong to the course and term this assessment was held for",
  REGISTRATION_WRONG_SECTION:
    "A registration belongs to a different teaching group than this sitting",
  REGISTRATION_WRONG_SCHEME:
    "A registration is governed by a different regulation than this assessment",
  REGISTRATION_NOT_MARKABLE:
    "A registration is withdrawn, dropped, completed or cancelled and cannot receive marks",
  DUPLICATE_REGISTRATION: "The same registration appears more than once in this upload",
  MARKS_REQUIRED: "A mark is required unless the student was absent",
  MARKS_FORBIDDEN_WHEN_ABSENT: "An absent student cannot carry a mark",
  MARKS_EXCEED_MAXIMUM: "A mark exceeds the total this assessment was set out of",
  FACULTY_NOT_CONDUCTOR:
    "A lecturer may only record marks for assessments they conduct",
  FACULTY_PROFILE_MISSING: "No faculty profile is linked to this account",
} as const;
