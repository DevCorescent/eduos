// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessment Event
// LAYER  : Constants
// PURPOSE: Every literal the Assessment Event module would otherwise inline —
//          authorised role sets, audit vocabulary, the lifecycle state machine
//          and field bounds.
// ============================================================================

import { AssessmentEventStatus } from "@/app/generated/prisma/enums";
import { ROLES } from "@/constants/roles";

// --- Authorization ----------------------------------------------------------

/**
 * Roles permitted to schedule a sitting and move it through its lifecycle.
 *
 * Deliberately narrow. Opening a sitting authorises marks to be written, and
 * publishing one makes them visible to students — both are registry acts rather
 * than teaching acts.
 *
 * A lecturer scheduling their own quiz is a real need this does NOT yet serve,
 * and serving it would require deciding which components a lecturer owns. That
 * decision belongs on the component (an assessment-mode column), not to a
 * hard-coded list of component types here, so it is left for a deliberate
 * change to C3 rather than smuggled in.
 */
export const ASSESSMENT_EVENT_MANAGE_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CONTROLLER_OF_EXAMINATION,
] as const;

/**
 * Roles permitted to read sittings.
 *
 * FACULTY is included because a lecturer must see the sitting before entering
 * marks against it, and DEPARTMENT_HOD because an assessment calendar is a
 * departmental planning document.
 */
export const ASSESSMENT_EVENT_READ_ROLES = [
  ...ASSESSMENT_EVENT_MANAGE_ROLES,
  ROLES.DEPARTMENT_HOD,
  ROLES.FACULTY,
] as const;

// --- Audit ------------------------------------------------------------------

export const ASSESSMENT_EVENT_RESOURCE = "AssessmentEvent";

export const ASSESSMENT_EVENT_AUDIT_ACTION = {
  CREATED: "ASSESSMENT_EVENT_CREATED",
  UPDATED: "ASSESSMENT_EVENT_UPDATED",
  STATUS_CHANGED: "ASSESSMENT_EVENT_STATUS_CHANGED",
} as const;

// --- Lifecycle --------------------------------------------------------------

/**
 * The complete state machine, as data.
 *
 * Declared once so the service enforces it and the tests assert against the
 * same source rather than a re-typed copy.
 *
 * Two entries run backwards on purpose. LOCKED -> OPEN reopens entry to correct
 * an error; PUBLISHED -> LOCKED is the unpublish the workflow requires. A
 * lifecycle with no correction path is the defect recorded as TD-C40.
 *
 * OPEN -> PUBLISHED is absent, and its absence is the verification gate: no
 * sitting reaches a student without someone having closed entry first.
 */
export const ASSESSMENT_EVENT_TRANSITIONS: Readonly<
  Record<AssessmentEventStatus, readonly AssessmentEventStatus[]>
> = {
  [AssessmentEventStatus.DRAFT]: [AssessmentEventStatus.OPEN],
  [AssessmentEventStatus.OPEN]: [AssessmentEventStatus.LOCKED],
  [AssessmentEventStatus.LOCKED]: [AssessmentEventStatus.OPEN, AssessmentEventStatus.PUBLISHED],
  [AssessmentEventStatus.PUBLISHED]: [AssessmentEventStatus.LOCKED],
};

/**
 * The ONLY status in which a mark may be created or amended.
 *
 * Exported because C6.2 reads it: locking is not a separate mechanism, it is
 * this single predicate. A sitting that is DRAFT, LOCKED or PUBLISHED rejects
 * every write to its marks.
 */
export const MARK_ENTRY_STATUS = AssessmentEventStatus.OPEN;

/**
 * Statuses in which a sitting's marks are visible to a student.
 *
 * A list rather than an equality check, so a future PARTIALLY_PUBLISHED state
 * would be a one-line change here rather than a hunt through the read paths.
 */
export const PUBLISHED_STATUSES: readonly AssessmentEventStatus[] = [
  AssessmentEventStatus.PUBLISHED,
];

/**
 * Statuses in which the sitting's own definition may still be amended.
 *
 * Once entry has opened, changing what the paper was marked out of would
 * silently revalue every mark already recorded against it.
 */
export const EDITABLE_STATUSES: readonly AssessmentEventStatus[] = [
  AssessmentEventStatus.DRAFT,
];

// --- Field bounds -----------------------------------------------------------

export const ASSESSMENT_EVENT_TITLE_MIN_LENGTH = 2;
export const ASSESSMENT_EVENT_TITLE_MAX_LENGTH = 150;

/** Sitting numbers start here. Server-assigned, never accepted from a client. */
export const FIRST_SEQUENCE = 1;

/**
 * Ceiling on the sitting number.
 *
 * Far above any real arrangement — "best 2 of 3" needs three — while bounding
 * what a runaway loop or a mistaken import could create against one component.
 */
export const MAX_SEQUENCE = 99;

// --- Messages ---------------------------------------------------------------

export const ASSESSMENT_EVENT_MESSAGE = {
  NOT_FOUND: "Assessment event not found",
  COMPONENT_NOT_FOUND: "Evaluation component not found",
  COURSE_NOT_FOUND: "Course not found",
  SEMESTER_NOT_FOUND: "Semester not found",
  SECTION_NOT_FOUND: "Section not found",
  FACULTY_NOT_FOUND: "Faculty member not found",
  SCHEME_NOT_ACTIVE:
    "Marks may only be assessed under an ACTIVE evaluation scheme, so the rules that grade them cannot change afterwards",
  NOT_EDITABLE:
    "An assessment event can only be amended before mark entry opens; reopen it as a draft is not possible once marks exist",
  INVALID_TRANSITION: "The assessment event cannot move to the requested status",
  MAX_MARKS_EXCEEDS_COMPONENT:
    "A sitting may be marked out of a different total to its component, but not one this schema cannot store",
  SEQUENCE_EXHAUSTED: "This component already has the maximum number of sittings for this course",
} as const;
