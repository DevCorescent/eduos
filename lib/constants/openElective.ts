// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : Constants
// PURPOSE: The authorisation sets, the lifecycle transition table, and the
//          messages this module raises.
//
// THE TRANSITION TABLE IS THE POINT OF THIS FILE
//   A lifecycle scattered across `if (status === ...)` checks in three service
//   methods is a lifecycle nobody can read and nobody can test. Declared once
//   as data, it can be asserted directly — and a transition that was never
//   intended cannot be reached by a method that forgot to check.
// ============================================================================

import { OpenElectiveStatus } from "@/app/generated/prisma/enums";
import { ROLES } from "@/constants/roles";

// --- Authorization ----------------------------------------------------------

/**
 * Roles that may READ the offering catalogue.
 *
 * STUDENT is included because choosing an elective requires seeing them. What a
 * student sees is narrower than what staff see — the service annotates each
 * offering with that student's own eligibility — but the endpoint is the same.
 */
export const ELECTIVE_READ_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.DEPARTMENT_HOD,
  ROLES.STUDENT,
] as const;

/**
 * Roles that may submit preferences.
 *
 * STUDENT alone. An administrator choosing on a student's behalf would be
 * indistinguishable in the data from the student choosing, and preference order
 * is the input to an allocation someone may later dispute.
 */
export const ELECTIVE_SELECT_ROLES = [ROLES.STUDENT] as const;

/**
 * Roles that may ALLOCATE or LOCK.
 *
 * DEPARTMENT_HOD is included because an offering belongs to a department and
 * its seats are that department's to give. STUDENT is absent for the obvious
 * reason; the absence is enforced at the route, not merely documented here.
 */
export const ELECTIVE_MANAGE_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.DEPARTMENT_HOD,
] as const;

// --- Lifecycle --------------------------------------------------------------

/**
 * Which status may follow which.
 *
 * DRAFT     -> OPEN      publish the offering to students
 * OPEN      -> LOCKED    freeze the preference set
 * OPEN      -> DRAFT     withdraw it again, while nothing has been decided
 * LOCKED    -> OPEN      re-open, if the freeze was premature
 * LOCKED    -> ALLOCATED run the allocation against the frozen set
 * ALLOCATED -> (nothing) terminal
 *
 * ALLOCATED is terminal by design. Seats have been awarded and enrolments
 * created; re-opening would leave registrations whose allocation no longer
 * exists. A re-run is expressed as `force` on the allocate call, which clears
 * the previous verdicts inside one transaction rather than by walking the
 * lifecycle backwards.
 */
export const ELECTIVE_TRANSITIONS: Readonly<
  Record<OpenElectiveStatus, readonly OpenElectiveStatus[]>
> = {
  [OpenElectiveStatus.DRAFT]: [OpenElectiveStatus.OPEN],
  [OpenElectiveStatus.OPEN]: [OpenElectiveStatus.LOCKED, OpenElectiveStatus.DRAFT],
  [OpenElectiveStatus.LOCKED]: [OpenElectiveStatus.ALLOCATED, OpenElectiveStatus.OPEN],
  [OpenElectiveStatus.ALLOCATED]: [],
};

/** The only status in which a preference may be written. */
export const PREFERENCE_EDITABLE_STATUS = OpenElectiveStatus.OPEN;

/**
 * The only status an allocation may run from.
 *
 * LOCKED, not OPEN. Allocating against a set that can still move underneath the
 * run would make the result unreproducible — which is the whole reason LOCKED
 * precedes ALLOCATED in this lifecycle rather than following it.
 */
export const ALLOCATABLE_STATUS = OpenElectiveStatus.LOCKED;

/** Whether a transition is permitted. Declared once, asserted directly. */
export function canTransition(
  from: OpenElectiveStatus,
  to: OpenElectiveStatus
): boolean {
  return ELECTIVE_TRANSITIONS[from].includes(to);
}

// --- Bounds -----------------------------------------------------------------

/**
 * Largest cohort one allocation run will process.
 *
 * A bound rather than pagination: an allocation is a statement about a whole
 * cohort, and running it against a page would award seats from a slice while
 * reporting them as final. Beyond this the run is refused loudly.
 */
export const MAX_ALLOCATION_COHORT = 5000;

// --- Messages ---------------------------------------------------------------

export const ELECTIVE_MESSAGE = {
  /** One message for "not a student" and "no such student" alike. */
  FORBIDDEN: "Forbidden",
  OFFERING_NOT_FOUND: "Open elective offering not found",
  SEMESTER_MISMATCH: "A chosen offering belongs to a different semester",
  NOT_OPEN: "This offering is not accepting preferences",
  NOT_ALLOCATABLE: "This offering must be locked before it can be allocated",
  ALREADY_ALLOCATED:
    "This offering has already been allocated. Re-run with force to replace the previous result",
  INVALID_TRANSITION: "That status change is not permitted",
  COHORT_TOO_LARGE: "The cohort exceeds the size this endpoint will allocate in one run",
  INELIGIBLE: "You are not eligible for one of the chosen electives",
} as const;
