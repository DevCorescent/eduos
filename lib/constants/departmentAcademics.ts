// ============================================================================
// MODULE : Constants — department-scoped academic read access
// PURPOSE: Name, in one place, the roles that may READ the university's
//          student, faculty and course directories — and record why a head of
//          department is on that list while remaining narrowed to their own
//          department.
//
// WHERE THESE COME FROM
//   Not the PRD. §4.2 names "Head of Department" and assigns it nothing; §17,
//   §18 and §49.4 describe examination and grading without naming an actor.
//   The product decision is the source: a HOD has access to their department's
//   students, faculty, courses and academic operations. These arrays encode
//   exactly that and nothing wider.
//
// READ, NOT MANAGE — AND THAT IS DELIBERATE
//   Only the collection GETs admit a head. Creating a student, hiring a faculty
//   member and defining a course stay with UNIVERSITY_ADMIN, because the
//   product decision grants a HOD their department's academic operations and
//   does not grant them the university's registry. A write surface is a
//   separate decision, not an inference from a read one.
//
// THE ARRAY IS NOT THE SCOPE
//   Being on this list gets a head past the role check. It does NOT decide
//   which rows they see — lib/auth/departmentScope.ts does, from their
//   authenticated identity, and every route that uses these constants applies
//   it. Adding a role here without applying the scope would hand that role the
//   whole tenant.
// ============================================================================

import { ROLES } from "@/constants/roles";

/**
 * Who may read the student directory.
 *
 * UNIVERSITY_ADMIN sees the university. DEPARTMENT_HOD sees the students of
 * the programmes their department owns — Student carries no departmentId, so
 * the route resolves the department's programmes and filters on those.
 */
export const STUDENT_READ_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.DEPARTMENT_HOD,
] as const;

/**
 * Who may read the faculty directory.
 *
 * FacultyMember.departmentId is a real column, so a head's restriction is a
 * direct equality rather than a resolved set.
 */
export const FACULTY_READ_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.DEPARTMENT_HOD,
] as const;

/**
 * Who may read the course catalogue.
 *
 * Course.departmentId is nullable — a course may belong to no department. Such
 * a course is NOT visible to a head: `departmentId: <id>` excludes NULL in
 * Postgres, which is the correct reading. An unowned course is the
 * university's, and a head has no claim on it merely because nobody claimed it.
 */
export const COURSE_READ_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.DEPARTMENT_HOD,
  // The Controller of Examination, for examination setup ONLY.
  //
  // Scheduling an examination means naming the course it is for, and PRD 17.2
  // puts the examination calendar inside Examination Configuration. Without
  // this the examination office could not resolve a single course id and could
  // not create an examination at all.
  //
  // READ of the course catalogue and nothing more. The COE is deliberately NOT
  // added to STUDENT_READ_ROLES or FACULTY_READ_ROLES above, and it is NOT in
  // COURSE_WRITE_ROLES below either — a test asserts all three.
  ROLES.CONTROLLER_OF_EXAMINATION,
] as const;

// --- Writes -----------------------------------------------------------------
//
// WHY THESE EXIST — tester issues #49 and #50
//   A head of department could READ the faculty directory and the course
//   catalogue and write neither: both POST and PATCH were
//   requireRole("UNIVERSITY_ADMIN"), so a head managing their own department's
//   staff and syllabus was answered "Forbidden". The product decision has since
//   confirmed that a head SHOULD create and edit both.
//
// THE ROLE LIST IS HALF OF THE RULE, AND THE SMALLER HALF
//   A role array can only say yes or no, so admitting a head here would grant
//   tenant-wide writes — a head editing another department's professor, or
//   retitling a course they do not own. The other half is
//   resolveDepartmentScope, applied in each route exactly as the matching
//   listing already applies it: a restricted head writes rows whose
//   departmentId equals their own, and nothing else.
//
//   That is why these are separate constants rather than the READ sets reused.
//   The COE reads the course catalogue and must not write it, so the two lists
//   genuinely differ — and a single list would have quietly granted that.

/**
 * Who may create and edit faculty records.
 *
 * FacultyMember.departmentId is a real column, so a head's restriction is a
 * direct equality — the same instrument the listing uses. A head may not create
 * a member into another department, nor move one out of theirs.
 *
 * Deleting is not here because there is no faculty delete: a faculty record
 * anchors teaching assignments, timetables and attendance, and leaving is a
 * status change through the same edit path.
 */
export const FACULTY_WRITE_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.DEPARTMENT_HOD,
] as const;

/**
 * Who may create and edit courses.
 *
 * Course.departmentId is nullable, and an unowned course stays the
 * university's: a head cannot edit one, for the same reason they cannot see it.
 * A course a head CREATES is stamped with their own department rather than left
 * unowned, or they would author rows they could not afterwards read.
 *
 * DELETE is deliberately absent. Removing a course is destructive and
 * irreversible — it is refused outright while anything references it — and the
 * confirmed decision covers create and edit. Retiring a course (isActive false)
 * is an edit and is therefore available to a head.
 */
export const COURSE_WRITE_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.DEPARTMENT_HOD,
] as const;
