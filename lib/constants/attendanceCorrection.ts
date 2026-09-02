// ============================================================================
// MODULE : Attendance corrections — authorization vocabulary and messages
// LAYER  : Constants
// PURPOSE: Name who may raise a correction and who may decide one, in one place.
//
// PRD §13.2 lists "Attendance correction requests", "Faculty approval" and
// "Academic admin approval" as three adjacent bullets and states NO sequence
// between them. The split below therefore follows this module's OWN existing
// convention rather than inventing a second one:
//
//   ATTENDANCE_LOCK_ROLES   — FACULTY, DEPARTMENT_HOD, HOD, UNIVERSITY_ADMIN
//   ATTENDANCE_UNLOCK_ROLES — DEPARTMENT_HOD, HOD, UNIVERSITY_ADMIN
//
// The lock module already draws the line at "a lecturer may finalise their own
// register but may not reopen it". A correction is the same shape of act: the
// person closest to the register raises it, and the tier that may release a
// lock is the tier that may approve a change to a finalised one.
//
// ASSUMPTION, STATED RATHER THAN BURIED
//   This is a SINGLE-STAGE approval. The PRD's two approval bullets are read as
//   naming the two kinds of approver a university has, not as two sequential
//   gates — it establishes no order, and a two-stage engine is materially more
//   machinery than the requirement supports. If the product means sequential
//   faculty-then-admin approval, this is the file that changes, and the request
//   model already carries a single reviewer that would need a second.
// ============================================================================

import { ROLES } from "@/constants/roles";

/**
 * Who may RAISE a correction request.
 *
 * The same set that may lock a register: the people who own the register are
 * the people who notice it is wrong.
 */
export const ATTENDANCE_CORRECTION_REQUEST_ROLES = [
  ROLES.FACULTY,
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
  ROLES.UNIVERSITY_ADMIN,
] as const;

/**
 * Who may APPROVE or REJECT one — PRD §13.2 "Academic admin approval".
 *
 * FACULTY is deliberately absent, mirroring ATTENDANCE_UNLOCK_ROLES. A lecturer
 * approving their own correction would make the workflow a slower way of
 * editing the record directly, which is the thing it exists to replace.
 * Self-review is refused separately in the domain, so a head who raised a
 * request still cannot decide it.
 */
export const ATTENDANCE_CORRECTION_REVIEW_ROLES = [
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
  ROLES.UNIVERSITY_ADMIN,
] as const;

/** Who may READ the queue. Everyone who participates in the workflow. */
export const ATTENDANCE_CORRECTION_READ_ROLES = [
  ROLES.FACULTY,
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
  ROLES.UNIVERSITY_ADMIN,
] as const;

export const ATTENDANCE_CORRECTION_MESSAGE = {
  ATTENDANCE_NOT_FOUND: "No attendance record exists for this id",
  REQUEST_NOT_FOUND: "No correction request exists for this id",
  ALREADY_PENDING: "A correction request for this record is already awaiting review",
  ALREADY_DECIDED: "This correction request has already been decided",
  SELF_REVIEW: "A correction cannot be approved by the person who raised it",
  NO_CHANGE: "The requested status is the same as the current one",
  REJECTION_NEEDS_NOTE: "A rejection must state a reason",
} as const;
