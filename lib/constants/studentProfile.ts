// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Profile Portal
// LAYER  : Constants
// PURPOSE: The authorisation set, the profile-completion weighting, and the
//          bounds the profile service needs.
//
// THE COMPLETION WEIGHTING IS POLICY, WHICH IS WHY IT IS HERE
//   "How complete is this profile" has no objectively correct answer — it is a
//   decision about what an institution considers a finished record. Putting the
//   weights in a named constant rather than inline in the service means the
//   policy is readable in one place, assertable by a test, and changeable
//   without touching the arithmetic that consumes it.
//
// THERE IS NO ATTENDANCE THRESHOLD HERE, DELIBERATELY
//   The 75% warning line already exists inside AttendanceAnalyticsService,
//   which exposes it as `alerts.lowAttendance`. Restating it here would create
//   a second definition of the same rule, and the day one moved the dashboard
//   and the attendance page would disagree about whether a student is at risk.
//   The profile service reads the flag; it does not re-derive it.
// ============================================================================

import { ROLES } from "@/constants/roles";

// --- Authorization ----------------------------------------------------------

/**
 * Roles permitted to reach the profile portal.
 *
 * UNIVERSITY_ADMIN is admitted at the ROLE gate and will still be refused at
 * the data gate unless they are themselves a student — Phase 18 is
 * self-service, so the caller is resolved userId -> Student and an admin with
 * no Student row is FORBIDDEN. Admitting the role here and refusing it there is
 * deliberate: the route decides who may knock, the service decides whose record
 * exists to open.
 */
export const STUDENT_PROFILE_ROLES = [ROLES.STUDENT, ROLES.UNIVERSITY_ADMIN] as const;

// --- Profile completion -----------------------------------------------------

/**
 * A section of the profile, and what it is worth.
 *
 * The eight weights total exactly 100. That is asserted by a test rather than
 * trusted, because a weighting that summed to 95 would silently cap every
 * student at 95% complete and nobody would notice for months.
 *
 * Scoring is ALL-OR-NOTHING per section rather than partial. Partial credit
 * would need a second weighting inside each section — how much of "Basic Info"
 * is a phone number worth? — and every one of those sub-weights would be a
 * further policy decision with no better justification than the first. A
 * student instead learns exactly what is missing from `missingFields`, which is
 * more actionable than a fractional score.
 */
export const PROFILE_COMPLETION_WEIGHTS = {
  BASIC_INFO: 20,
  PERSONAL_DETAILS: 20,
  PARENTS: 15,
  DOCUMENTS: 20,
  PHOTO: 10,
  EMERGENCY_CONTACT: 10,
  ACHIEVEMENTS: 5,
} as const;

export type ProfileSection = keyof typeof PROFILE_COMPLETION_WEIGHTS;

/** What a complete profile scores. Derived, never hardcoded as 100. */
export const PROFILE_COMPLETION_TOTAL = Object.values(PROFILE_COMPLETION_WEIGHTS).reduce(
  (sum, weight) => sum + weight,
  0
);

/**
 * The fields each section requires before it counts as complete.
 *
 * Named rather than described in prose so the service reports exactly these
 * strings in `missingFields` and a portal can map them to its own form
 * controls. A section with no listed fields — PARENTS, DOCUMENTS,
 * ACHIEVEMENTS — is satisfied by the presence of at least one record.
 */
export const PROFILE_REQUIRED_FIELDS = {
  BASIC_INFO: ["firstName", "lastName", "email", "phone"],
  PERSONAL_DETAILS: ["dateOfBirth", "gender", "bloodGroup", "nationality"],
  PARENTS: ["parents"],
  DOCUMENTS: ["documents"],
  PHOTO: ["photo"],
  EMERGENCY_CONTACT: ["emergencyContact"],
  ACHIEVEMENTS: ["achievements"],
} as const;

// --- Bounds -----------------------------------------------------------------

/**
 * Pending demands read when computing the dashboard's outstanding figure.
 *
 * The finance service paginates, so the outstanding total can only be stated
 * when every demand was returned. This bound is set high enough that a real
 * student never exceeds it; when one does, the service reports the COUNT and
 * leaves the AMOUNT null rather than summing a page and presenting it as a
 * total. See composeFinance() — it is the never-fabricate rule applied to a
 * figure that would otherwise look authoritative and be wrong.
 */
export const DASHBOARD_PENDING_FEE_LIMIT = 100;

// --- Messages ---------------------------------------------------------------

export const STUDENT_PROFILE_MESSAGE = {
  /**
   * Used for BOTH "you are not a student" and "no such student".
   *
   * One message and one status, because distinguishing them would tell a
   * caller something about a record they may not read.
   */
  FORBIDDEN: "Forbidden",
  PROFILE_NOT_FOUND: "Student profile not found",
} as const;
