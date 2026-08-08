// ============================================================================
// OWNER  : Gauransh
// MODULE : Assignment Management Enhancement (Phase 24)
// LAYER  : Constants
// PURPOSE: The authorisation sets, the resubmission rule, and the messages the
//          Phase 24 endpoints answer with.
//
// HOW THIS PHASE RELATES TO PHASE 10, WHICH IT DOES NOT REPLACE
//   Phase 10 already ships POST /api/assignments/[id]/submissions (STUDENT
//   only) and PATCH /api/assignments/[id]/submissions/[sid] (staff only).
//   Phase 24's /submit and /grade are the README's URLs over the same two
//   operations — not different operations.
//
//   What Phase 24 ADDS is the lifecycle Phase 10 has no concept of:
//     • /submit  snapshots a superseded attempt into
//                AssignmentSubmissionVersion, preserving the grade it replaces,
//                and reports the attempt number and history. Phase 10
//                overwrites in place.
//     • /grade   accepts a mark of ZERO, which Phase 10's schema refuses.
//
//   Both sets of routes stay live: the README names these URLs and Phase 10's
//   callers expect theirs. The Phase 10 files are UNTOUCHED.
//
// THE RESUBMISSION RULE, STATED ONCE
//   A student may resubmit while the assignment is open to submissions. Each
//   resubmission SNAPSHOTS the outgoing state into AssignmentSubmissionVersion
//   before overwriting, so a grade already awarded is preserved rather than
//   erased. That is the whole of "Resubmit" and "Submission History".
// ============================================================================

import { ROLES } from "@/constants/roles";
import { AssignmentStatus, SubmissionStatus } from "@/app/generated/prisma/enums";

// --- Authorization ----------------------------------------------------------

/** Who may create, edit, delete, publish and grade an assignment. */
export const ASSIGNMENT_MANAGE_ROLES = [
  ROLES.FACULTY,
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
  ROLES.UNIVERSITY_ADMIN,
] as const;

/**
 * Who may submit.
 *
 * STUDENT alone, matching the README's Phase 24, which lists "Upload
 * Submission" and "Resubmit" under Student — and matching Phase 10's own
 * submission route, which admits STUDENT alone for the same reason.
 */
export const ASSIGNMENT_SUBMIT_ROLES = [ROLES.STUDENT] as const;

/** Who may read the pending / submitted rosters and the analytics. */
export const ASSIGNMENT_ANALYTICS_ROLES = [
  ROLES.FACULTY,
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
  ROLES.UNIVERSITY_ADMIN,
] as const;

// --- Lifecycle rules --------------------------------------------------------

/**
 * Assignment states a student may submit against.
 *
 * PUBLISHED only. A DRAFT is not visible to students at all, and CLOSED and
 * GRADED are terminal for submission purposes — accepting one after grading has
 * begun would silently invalidate marks already awarded to a cohort.
 */
export const SUBMITTABLE_ASSIGNMENT_STATUSES = [AssignmentStatus.PUBLISHED] as const;

/**
 * Submission states that count as "has submitted" for the rosters.
 *
 * PENDING is the row's DEFAULT and means the opposite — a placeholder for a
 * student who has not acted. Counting it would report a cohort as fully
 * submitted the moment placeholder rows existed.
 */
export const SUBMITTED_STATUSES = [
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.LATE,
  SubmissionStatus.GRADED,
] as const;

/** Submission states that carry an awarded mark. */
export const GRADED_STATUSES = [SubmissionStatus.GRADED] as const;

// --- Bounds -----------------------------------------------------------------

/**
 * Assignments aggregated by GET /api/assignments/analytics in one request.
 *
 * Bounded for the same reason Phase 18 bounds its fee read: an unbounded
 * aggregate over a tenant's entire assignment history would grow without limit,
 * and a partial aggregate presented as a total is worse than a stated bound.
 * The service reports `truncated: true` when the bound is reached.
 */
export const ASSIGNMENT_ANALYTICS_LIMIT = 500;

/** Roster rows returned per page by the pending and submitted endpoints. */
export const ASSIGNMENT_ROSTER_MAX_LIMIT = 200;

// --- Messages ---------------------------------------------------------------

export const ASSIGNMENT_LIFECYCLE_MESSAGE = {
  NOT_FOUND: "Assignment not found",
  SUBMISSION_NOT_FOUND: "Submission not found",
  /** Used for "you are not a student" and "no such student", indistinguishably. */
  FORBIDDEN: "Forbidden",
  NOT_OPEN: "This assignment is not open for submissions",
  NOT_REGISTERED: "You are not registered for this assignment's course",
  /**
   * Refusing a DELETE that would orphan work students have already done.
   *
   * 409 rather than 403: the caller's role is not the problem, the state of the
   * resource is. Same reasoning as the attendance-lock refusal in Phase 22.
   */
  HAS_SUBMISSIONS: "This assignment has submissions and cannot be deleted",
  MARKS_EXCEED_MAX: "Marks exceed the assignment's maximum",
} as const;
