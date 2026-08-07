// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Profile & Performance Analytics (Phase 23)
// LAYER  : Constants
// PURPOSE: The authorisation sets and the messages this module answers with.
//
// THERE IS NO WEIGHTING TABLE HERE, AND THAT IS THE POINT
//   The README lists "Teaching Performance" among Phase 23's features but
//   defines no formula for it, no inputs, and no scale. Every other weighting
//   in this project — PROFILE_COMPLETION_WEIGHTS, EvaluationComponent.weightage
//   — either comes from a specification or is configured by the university.
//   Inventing one here would produce a number that looks authoritative, that a
//   head of department might act on, and that nobody decided.
//
//   So this module reports the COMPONENT METRICS instead: average feedback
//   rating, attendance-marking rate, pass rate, lecture and student counts,
//   each labelled and each traceable to a query. A client is free to combine
//   them; the server does not pretend to know how.
//
// SELF-ACCESS IS THE DEFAULT, NOT AN EXCEPTION
//   A faculty member may always read their OWN profile, workload, performance
//   and analytics. Reading someone ELSE'S requires an administrative role. That
//   split is enforced in the service, which resolves the caller to their own
//   FacultyMember row and compares — see facultyProfile.service.ts.
// ============================================================================

import { ROLES } from "@/constants/roles";

// --- Authorization ----------------------------------------------------------

/**
 * Roles permitted to reach any Phase 23 endpoint.
 *
 * FACULTY is admitted at the ROLE gate and is still narrowed at the DATA gate:
 * a faculty member reaching another member's id is refused by the service. The
 * route decides who may knock; the service decides whose record opens. Same
 * split as Phase 18.
 */
export const FACULTY_PROFILE_ROLES = [
  ROLES.FACULTY,
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
  ROLES.UNIVERSITY_ADMIN,
] as const;

/**
 * Roles permitted to read or write ANOTHER faculty member's record.
 *
 * FACULTY absent: a lecturer may not edit a colleague's qualifications, nor
 * read their feedback scores. Both HOD spellings are accepted because the
 * project carries two (recorded as debt in constants/roles.ts) and honouring
 * one but not the other would grant the capability by accident of seeding.
 */
export const FACULTY_PROFILE_ADMIN_ROLES = [
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
  ROLES.UNIVERSITY_ADMIN,
] as const;

// --- Bounds -----------------------------------------------------------------

/**
 * Rows read when computing result analytics for one faculty member.
 *
 * The analytics endpoint aggregates exam results across every course a member
 * teaches. That set is unbounded in principle, so it is capped, and the service
 * reports `truncated: true` rather than presenting a partial aggregate as a
 * total. Same never-fabricate rule as DASHBOARD_PENDING_FEE_LIMIT in Phase 18.
 */
export const FACULTY_ANALYTICS_RESULT_LIMIT = 5000;

/**
 * Attendance rows read when computing the attendance-marking statistic.
 *
 * Bounded for the same reason and reported the same way.
 */
export const FACULTY_ANALYTICS_ATTENDANCE_LIMIT = 5000;

// --- Messages ---------------------------------------------------------------

export const FACULTY_PROFILE_MESSAGE = {
  /**
   * Used for BOTH "no such faculty member" and "not yours to read".
   *
   * One message and one status, because distinguishing them would confirm the
   * existence of a record the caller may not read — the same reasoning Phase 17
   * and Phase 18 apply to student records.
   */
  NOT_FOUND: "Faculty member not found",
  FORBIDDEN: "Forbidden",
  NO_FACULTY_RECORD: "Forbidden",
} as const;
