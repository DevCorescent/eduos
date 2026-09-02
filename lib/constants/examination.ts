// ============================================================================
// MODULE : Examination scheduling — authorization vocabulary
// LAYER  : Constants
// PURPOSE: Name who may read and who may run the examination CALENDAR, so the
//          three routes under /api/examinations stop restating role strings
//          inline and cannot drift apart.
//
// WHY THE CONTROLLER OF EXAMINATION IS ADDED HERE
//   These routes were written with the literal roles
//   ("UNIVERSITY_ADMIN", "FACULTY", "STUDENT") before CONTROLLER_OF_EXAMINATION
//   existed as a role at all. The omission was chronological, not a decision:
//   nothing in the code or the PRD says the examination office should be shut
//   out of the examination calendar, and until now it was.
//
//   PRD 57 lists "Examinations" as a top-level area of University
//   Administration, and PRD 17.2 puts the examination calendar inside
//   Examination Configuration. The agreed product model gives the Controller of
//   Examination the examination and evaluation surface inside University
//   Administration — with no separate portal — so the calendar is theirs to
//   operate. Leaving it to UNIVERSITY_ADMIN alone would mean the role named
//   after examinations could not schedule one.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//   It does not widen the COE anywhere else. The student, faculty, course and
//   timetable registries stay closed to them, which the API tests assert.
//
// SCOPE
//   Every examination read and write is tenant-bounded by requireTenant, as it
//   already was. No department narrowing applies: an Examination belongs to a
//   course and a semester, and the calendar is a university-wide instrument
//   operated by the examination office. DEPARTMENT_HOD is deliberately NOT
//   admitted here — see the report; the PRD assigns them nothing on this
//   surface and adding them would be a permission without a basis.
// ============================================================================

import { ROLES } from "@/constants/roles";

/**
 * Who may READ the examination calendar.
 *
 * STUDENT and FACULTY are retained exactly as they were: the student portal's
 * Examinations screen and the faculty portal's Exams screen are the only
 * consumers this API has ever had, and removing either would break a working
 * flow to tidy a list.
 */
export const EXAMINATION_READ_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CONTROLLER_OF_EXAMINATION,
  ROLES.FACULTY,
  ROLES.STUDENT,
] as const;

/**
 * Who may CREATE or AMEND an examination, and record its results.
 *
 * STUDENT is absent, as before. FACULTY is retained because the faculty portal
 * already schedules and marks its own examinations through these routes.
 */
export const EXAMINATION_MANAGE_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CONTROLLER_OF_EXAMINATION,
  ROLES.FACULTY,
] as const;

/**
 * Who may READ the academic calendar — academic years and their semesters.
 *
 * WHY THE COE IS HERE
 *   An examination is scheduled against a semester. GET /api/academic-years and
 *   GET /api/academic-years/[id]/semesters were UNIVERSITY_ADMIN only, so the
 *   examination office could not resolve a single semester id and could not
 *   create an examination.
 *
 * READ ONLY, AND ONLY THE CALENDAR
 *   The POST handlers on both routes keep requireRole("UNIVERSITY_ADMIN")
 *   untouched: creating an academic year or a semester is academic
 *   administration, not examination administration. A test asserts the writes
 *   stayed closed.
 */
export const ACADEMIC_CALENDAR_READ_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CONTROLLER_OF_EXAMINATION,
] as const;
