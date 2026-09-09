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
import {
  AssessmentEventStatus,
  ResultPublicationStatus,
} from "@/app/generated/prisma/enums";

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

/**
 * Roles permitted to APPROVE a semester's cohort result — PRD §17.4, §49.4
 * stage 8.
 *
 * NARROWER THAN THE READ SET BY ONE, AND THE OMISSION IS THE POINT.
 * UNIVERSITY_ADMIN reads the cohort report and does NOT sign it off. Approval
 * is the examination controller's statutory act: it is the moment a computed
 * result becomes the institution's official position on a cohort, and PRD §49.4
 * places it between Moderation and Publication precisely because it is a named
 * office's decision rather than an administrative convenience. A confirmed
 * product decision, not an oversight — a test pins the absence so that widening
 * it later has to be deliberate.
 *
 * DEPARTMENT_HOD is absent here because it is absent from
 * SEMESTER_RESULT_READ_ROLES too: a head of department cannot read a cohort
 * report at all, for the reason given above it, so there is nothing for them to
 * approve.
 *
 * FACULTY, STUDENT and PARENT reach neither set.
 */
export const SEMESTER_RESULT_APPROVE_ROLES = [ROLES.CONTROLLER_OF_EXAMINATION] as const;

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
  ALREADY_APPROVED: "This semester's result has already been approved",
  APPROVAL_HAS_FAILURES:
    "The result cannot be approved while the engine could not compute every student in the cohort",
  APPROVAL_EMPTY_COHORT:
    "The result cannot be approved because no student is registered for this semester",
} as const;

// --- Approval ---------------------------------------------------------------

/**
 * The status an approval writes, and the one it refuses to write again.
 *
 * REUSES ResultPublicationStatus rather than declaring a second lifecycle. That
 * enum was created by the Phase 16 migration and, until the approval table
 * existed, was attached to no column anywhere in the database — adopting it is
 * what stops approval becoming a parallel vocabulary for the same idea.
 *
 * APPROVAL NEVER WRITES `PUBLISHED`. PRD §49.4 separates Result Approval from
 * Publication, and collapsing them would release marks to students the instant
 * a controller signed off. `VERIFIED` is likewise never written: it names a
 * moderation step this project has not built, and is left unused rather than
 * repurposed.
 */
export const SEMESTER_APPROVAL_TARGET_STATUS = ResultPublicationStatus.APPROVED;

/**
 * Statuses from which approval is refused as a 409.
 *
 * Only APPROVED. A DRAFT is the ordinary starting point, and a semester with no
 * row at all is DRAFT by absence — the two mean the same thing, which is why
 * nothing pre-creates rows. PUBLISHED is included because a published result is
 * past approval, not before it: re-approving one would move the lifecycle
 * backwards.
 */
export const SEMESTER_APPROVAL_TERMINAL_STATUSES: readonly ResultPublicationStatus[] = [
  ResultPublicationStatus.APPROVED,
  ResultPublicationStatus.PUBLISHED,
];
