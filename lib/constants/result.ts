// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Reporting
// LAYER  : Constants
// PURPOSE: The authorisation sets and bounds the four result endpoints need.
//
//          There are no academic values here — no pass mark, no classification
//          threshold, no grade letter. Every one of those comes from the
//          tenant's GradeScale, EvaluationScheme and PassingCriterion, which is
//          the whole point of the phase.
// ============================================================================

import { ROLES } from "@/constants/roles";
import { AssessmentEventStatus } from "@/app/generated/prisma/enums";

// --- Authorization ----------------------------------------------------------

/**
 * Roles that may read ANY student's result in the tenant.
 *
 * FACULTY is deliberately absent. A lecturer marks their own sittings and reads
 * their own marks sheets; a student's whole academic record — every course,
 * every semester, their standing and their rank — is not theirs to browse.
 * Admitting them here would make the marks-sheet confinement built in C6.2
 * pointless, since the same data would be reachable one endpoint over.
 */
export const RESULT_READ_ANY_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CONTROLLER_OF_EXAMINATION,
  ROLES.DEPARTMENT_HOD,
] as const;

/**
 * Roles confined to their OWN record.
 *
 * A caller holding one of these and none of the elevated set may read exactly
 * one student: the one their user account resolves to. The requested id is
 * never used to look anything up for them — it is only ever COMPARED, so the
 * endpoint discloses no student's existence to a student.
 */
export const RESULT_READ_OWN_ROLES = [ROLES.STUDENT] as const;

/**
 * Roles permitted to read a whole cohort's semester result.
 *
 * Narrower than RESULT_READ_ANY_ROLES by one: a cohort report carries every
 * student's standing side by side and a merit list ordering them, which is an
 * examination-office document rather than a departmental one.
 */
export const SEMESTER_RESULT_READ_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CONTROLLER_OF_EXAMINATION,
] as const;

// --- Publication ------------------------------------------------------------

/**
 * The sitting state at which a mark may appear in a published result.
 *
 * PUBLICATION IS NOT A NEW CONCEPT AND DELIBERATELY GETS NO NEW TABLE.
 * AssessmentEvent already carries DRAFT → OPEN → LOCKED → PUBLISHED, and C6.1
 * already governs who may move it and when. A result is publishable exactly
 * when every sitting that fed it is PUBLISHED — so publication state is DERIVED
 * from the single source of truth rather than copied into a second one that
 * could disagree with it.
 */
export const PUBLISHED_EVENT_STATUS = AssessmentEventStatus.PUBLISHED;

/**
 * The sitting state at which marks stop changing.
 *
 * LOCKED and PUBLISHED both refuse further entry (C6.1 makes `acceptsMarks`
 * true only while OPEN), so a result built entirely from these two is stable
 * even before it is released to students.
 */
export const SETTLED_EVENT_STATUSES = [
  AssessmentEventStatus.LOCKED,
  AssessmentEventStatus.PUBLISHED,
] as const;

// --- Bounds -----------------------------------------------------------------

/**
 * Largest cohort one semester request will process.
 *
 * A bound rather than pagination, because a semester result is a COHORT
 * document — pass percentages, a median and a merit list are all statements
 * about the whole population, and computing them from a page would produce
 * numbers that are wrong rather than partial. A cohort beyond this is refused
 * loudly instead of silently summarised from a slice.
 */
export const MAX_COHORT_SIZE = 5000;

/** Largest number of courses one student's record will process. */
export const MAX_STUDENT_COURSES = 500;

// --- Messages ---------------------------------------------------------------

export const RESULT_MESSAGE = {
  STUDENT_NOT_FOUND: "Student not found",
  SEMESTER_NOT_FOUND: "Semester not found",
  COHORT_TOO_LARGE: "The cohort exceeds the size this endpoint will process in one request",
  TOO_MANY_COURSES: "The student has more registrations than this endpoint will process",
  FORBIDDEN: "Forbidden",
  NO_SCHEME: "A registration cites a regulation that no longer exists",
} as const;
