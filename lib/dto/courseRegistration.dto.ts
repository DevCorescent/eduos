// ============================================================================
// OWNER  : Gauransh
// MODULE : Course Registration
// LAYER  : DTO
// PURPOSE: The exact shapes returned to the client. The service builds these
//          and nothing downstream reshapes them.
//
// The same two boundary conversions as every Phase 16 DTO: Date to ISO-8601
// string so the wire contract is this file rather than a serializer's
// behaviour, and Decimal to a lossless string so a Prisma class instance never
// leaks into a response type.
//
// TWO FIELDS ARE DERIVED, NOT STORED
//   `isActive` from `status`, and `countsForCredit` from `registrationType`.
//   Both are read constantly — a roster is the active registrations, and SGPA
//   weights only the credit-bearing ones — and both are already settled by the
//   enum they derive from. Storing either would be a second source of truth
//   able to disagree with the field it describes.
// ============================================================================

import type { RegistrationStatus, RegistrationType } from "@/app/generated/prisma/client";
import type { Pagination } from "@/types/api";
import type { BulkSkipReason } from "@/lib/constants/courseRegistration";

/** One academic enrolment. */
export interface CourseRegistrationDTO {
  id: string;
  tenantId: string;

  studentId: string;
  courseId: string;
  semesterId: string;

  /** The teaching group, or null when the course has none. Mutable. */
  sectionId: string | null;

  /** Snapshot: the programme this course was taken under. */
  programmeId: string | null;
  /** Snapshot: the immutable regulation revision governing this enrolment. */
  evaluationSchemeId: string;
  /** Snapshot: Decimal(4,2) as a lossless string, e.g. "4.00". */
  credits: string;

  registrationType: RegistrationType;
  /** Snapshot: which attempt at this course, starting at 1. */
  attemptNumber: number;

  status: RegistrationStatus;
  /** ISO-8601. */
  statusChangedAt: string;

  /** Derived: the enrolment is live and appears on rosters. */
  isActive: boolean;
  /** Derived: this enrolment's credits count toward the degree. */
  countsForCredit: boolean;

  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
}

/**
 * One page of registrations.
 *
 * Paginated, unlike the rule and criterion collections. The difference is real
 * rather than stylistic: those are a pipeline and a conjunction, where a page
 * misrepresents the whole. A registration list is a genuine collection whose
 * size grows with the institution — every enrolment in a semester across a
 * university is tens of thousands of rows — so it must be paged.
 */
export interface CourseRegistrationListDTO {
  registrations: CourseRegistrationDTO[];
  pagination: Pagination;
}

/** One student a bulk registration did not enrol, and why. */
export interface BulkRegistrationSkipDTO {
  studentId: string;
  reason: BulkSkipReason;
}

/**
 * The outcome of a bulk registration.
 *
 * Reports counts and skips rather than echoing every created row: a 500-student
 * batch would otherwise return a payload proportional to the cohort for
 * information the caller already holds.
 *
 * Skips are NOT failures. Registering a whole section when a handful already
 * hold an active enrolment is the ordinary case, and failing the batch over it
 * would force the caller to diff the roster by hand. The enrolments that were
 * created are all-or-nothing within one transaction; the skipped ones were
 * no-ops.
 */
export interface BulkRegistrationResultDTO {
  courseId: string;
  semesterId: string;
  requestedCount: number;
  registeredCount: number;
  skipped: BulkRegistrationSkipDTO[];
}
