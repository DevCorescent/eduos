// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Lock & Audit System (Phase 22)
// LAYER  : Constants
// PURPOSE: The authorisation sets, the audit vocabulary, and the messages this
//          module answers with.
//
// WHO MAY LOCK AND WHO MAY UNLOCK ARE DIFFERENT SETS, AND THAT IS THE PHASE
//   The README's premise is that "once attendance is finalized, no faculty
//   member should be able to modify it unless explicitly unlocked by the HOD".
//   If FACULTY could unlock, the lock would be a suggestion — a faculty member
//   wanting to change a finalised record would simply unlock, edit and relock,
//   and the legal record the phase exists to protect would be no more protected
//   than before. So LOCK_ROLES includes FACULTY and UNLOCK_ROLES does not.
//
// UNIVERSITY_ADMIN IS ADMITTED EVERYWHERE, AND IS NOT IN THE README'S LIST
//   The README names DEPARTMENT_HOD and FACULTY. UNIVERSITY_ADMIN is added
//   because every other administrative surface in this project admits it (see
//   Phases 9, 10, 11 and 12) and a university administrator locked out of their
//   own institution's attendance controls has no recourse — there is no
//   platform-level override. This is the one addition beyond the README's
//   stated roles, recorded here so it is a decision rather than a slip.
// ============================================================================

import { ROLES } from "@/constants/roles";

// --- Authorization ----------------------------------------------------------

/**
 * Who may FINALISE a teaching unit's attendance.
 *
 * FACULTY included: the person who marked the register is the person who knows
 * when it is finished, and requiring an HOD to finalise every course would make
 * the feature unusable at scale.
 */
export const ATTENDANCE_LOCK_ROLES = [
  ROLES.FACULTY,
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
  ROLES.UNIVERSITY_ADMIN,
] as const;

/**
 * Who may RELEASE a lock.
 *
 * FACULTY deliberately absent — see the module header. Both HOD spellings are
 * accepted because the project carries two (constants/roles.ts records the
 * duplicate vocabulary as debt to be converged in a dedicated pass); accepting
 * one and not the other would grant or deny the capability by accident of which
 * spelling a tenant seeded.
 */
export const ATTENDANCE_UNLOCK_ROLES = [
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
  ROLES.UNIVERSITY_ADMIN,
] as const;

/** Who may READ lock state and audit history. Every role that can be affected. */
export const ATTENDANCE_LOCK_READ_ROLES = [
  ROLES.FACULTY,
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
  ROLES.UNIVERSITY_ADMIN,
] as const;

// --- Audit vocabulary -------------------------------------------------------

/**
 * The resource name every AuditLog row from this module carries.
 *
 * AuditLog's own repository states that resource names are set by each calling
 * module rather than centrally, so this is Phase 22's declaration of its own.
 * `GET /api/attendance/audit` reads back by exactly this value.
 */
export const ATTENDANCE_LOCK_RESOURCE = "AttendanceLock";

/**
 * The actions this module records.
 *
 * Both transitions are audited, not just the unlock. An audit trail that
 * recorded only releases could not answer "when was this finalised", which is
 * the question a disputed attendance record actually raises.
 */
export const ATTENDANCE_LOCK_ACTION = {
  LOCK: "ATTENDANCE_LOCK",
  UNLOCK: "ATTENDANCE_UNLOCK",
} as const;

/** Every action name, for the audit endpoint's filter. */
export const ATTENDANCE_LOCK_ACTIONS = [
  ATTENDANCE_LOCK_ACTION.LOCK,
  ATTENDANCE_LOCK_ACTION.UNLOCK,
] as const;

// --- Messages ---------------------------------------------------------------

export const ATTENDANCE_LOCK_MESSAGE = {
  COURSE_NOT_FOUND: "Course not found",
  SECTION_NOT_FOUND: "Section not found",
  SEMESTER_NOT_FOUND: "Semester not found",
  LOCK_NOT_FOUND: "No attendance lock exists for this teaching unit",
  ALREADY_LOCKED: "Attendance is already locked for this teaching unit",
  NOT_LOCKED: "Attendance is not currently locked for this teaching unit",
  /**
   * The refusal every guarded attendance WRITE answers with.
   *
   * 409 CONFLICT rather than 403 FORBIDDEN: the caller's role is not the
   * problem — the same faculty member could write this record yesterday and
   * will be able to again once an HOD unlocks. The state of the resource is
   * what conflicts, which is precisely what 409 means.
   */
  LOCKED: "Attendance for this course and section is locked",
  INVALID_WINDOW: "fromDate must not be after toDate",
} as const;
