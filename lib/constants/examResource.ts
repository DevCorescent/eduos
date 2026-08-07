// ============================================================================
// OWNER  : Gauransh
// MODULE : Question Paper & Solution Repository (Phase 26)
// LAYER  : Constants
// PURPOSE: The authorisation sets, the lifecycle rules, and the messages this
//          module answers with.
//
// THREE DIFFERENT AUDIENCES, THREE DIFFERENT RULE SETS
//   The README gives Faculty, HOD and Student separate capability lists, and
//   they are genuinely different: faculty upload and manage their own material,
//   an HOD verifies and publishes across a department, a student reads what has
//   been released for the courses they are registered for. Collapsing them into
//   one role set would give a student a draft answer key.
//
// VERIFICATION IS ORTHOGONAL TO PUBLICATION, AND THAT IS DELIBERATE
//   The README lists "Verify Uploads" AND "Publish/Unpublish" as separate HOD
//   capabilities. So `isVerified` does NOT gate student visibility — a
//   published-but-unverified resource is visible and reports itself as
//   unverified. Making verification a gate would have been a stricter workflow
//   than the specification describes, and would silently hide material a
//   faculty member had deliberately released.
// ============================================================================

import { ROLES } from "@/constants/roles";
import { ExamResourceStatus } from "@/app/generated/prisma/enums";

// --- Authorization ----------------------------------------------------------

/** Who may upload and manage examination resources. */
export const EXAM_RESOURCE_MANAGE_ROLES = [
  ROLES.FACULTY,
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
  ROLES.UNIVERSITY_ADMIN,
] as const;

/**
 * Who may verify, publish, archive and delete ANY resource in the tenant.
 *
 * FACULTY absent. A faculty member manages their OWN uploads — enforced at the
 * data gate by comparing uploadedById — but publishing across a department and
 * verifying someone else's answer key are the README's HOD capabilities.
 */
export const EXAM_RESOURCE_ADMIN_ROLES = [
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
  ROLES.UNIVERSITY_ADMIN,
] as const;

/** Who may read the staff-facing repository. */
export const EXAM_RESOURCE_READ_ROLES = [
  ROLES.FACULTY,
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
  ROLES.UNIVERSITY_ADMIN,
] as const;

/** Who may read the student-facing repository. */
export const EXAM_RESOURCE_STUDENT_ROLES = [ROLES.STUDENT] as const;

// --- Lifecycle --------------------------------------------------------------

/**
 * The only status a student may ever see.
 *
 * DRAFT is the README's "Draft Mode" — work in progress, never visible.
 * ARCHIVED is withdrawn material, retained for staff but not listed to
 * students. Student visibility ALSO requires any scheduled publication instant
 * to have elapsed; see lib/domain/exam-resources/visibility.ts.
 */
export const STUDENT_VISIBLE_STATUS = ExamResourceStatus.PUBLISHED;

/**
 * Statuses a resource may be edited from.
 *
 * An ARCHIVED resource is frozen: it is the historical record students relied
 * on, and silently rewriting a withdrawn answer key would leave no trace that
 * the document changed. Re-publishing it first is the deliberate path back.
 */
export const EDITABLE_STATUSES = [
  ExamResourceStatus.DRAFT,
  ExamResourceStatus.PUBLISHED,
] as const;

// --- Bounds -----------------------------------------------------------------

/** Maximum page size for either repository listing. */
export const EXAM_RESOURCE_MAX_LIMIT = 100;

/** Default page size. */
export const EXAM_RESOURCE_DEFAULT_LIMIT = 20;

// --- Audit vocabulary -------------------------------------------------------

/** The resource name every AuditLog row from this module carries. */
export const EXAM_RESOURCE_AUDIT_RESOURCE = "ExamResource";

/**
 * The actions this module records.
 *
 * Publication and archival are audited because both change what students can
 * see. Ordinary edits are not: `updatedAt` records that one happened, and
 * auditing every typo correction would bury the two events that matter.
 */
export const EXAM_RESOURCE_ACTION = {
  PUBLISH: "EXAM_RESOURCE_PUBLISH",
  ARCHIVE: "EXAM_RESOURCE_ARCHIVE",
  DELETE: "EXAM_RESOURCE_DELETE",
} as const;

// --- Messages ---------------------------------------------------------------

export const EXAM_RESOURCE_MESSAGE = {
  NOT_FOUND: "Examination resource not found",
  COURSE_NOT_FOUND: "Course not found",
  SEMESTER_NOT_FOUND: "Semester not found",
  /** Used for "not yours" as well, so neither answer confirms the other. */
  FORBIDDEN: "Forbidden",
  NOT_EDITABLE: "An archived resource cannot be edited",
  ALREADY_PUBLISHED: "This resource is already published",
  ALREADY_ARCHIVED: "This resource is already archived",
  STUDENT_NOT_RESOLVED: "Forbidden",
} as const;
