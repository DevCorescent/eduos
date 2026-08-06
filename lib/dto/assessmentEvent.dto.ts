// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessment Event
// LAYER  : DTO
// PURPOSE: The exact shapes returned to the client. The service builds these
//          and nothing downstream reshapes them.
//
// The same two boundary conversions as every Phase 16 DTO: Date to ISO-8601
// string, and Decimal to a lossless string.
//
// THREE FIELDS ARE DERIVED, NOT STORED
//   `acceptsMarks`, `isPublished` and `isEditable` all come from `status`. Each
//   answers a question a client asks on every render — may I show the marks
//   grid, may a student see this, may I offer an edit form — and each is
//   already settled by the status enum. A stored flag would be a second source
//   of truth able to disagree with the state it describes.
// ============================================================================

import type { AssessmentEventStatus } from "@/app/generated/prisma/client";
import type { Pagination } from "@/types/api";

/** One sitting of one evaluation component. */
export interface AssessmentEventDTO {
  id: string;
  tenantId: string;

  evaluationComponentId: string;
  courseId: string;
  semesterId: string;
  /** Null when the sitting covers every registration for the course and term. */
  sectionId: string | null;

  title: string;
  /** Decimal(6,2) as a lossless string — what THIS paper was marked out of. */
  maxMarks: string;
  /** Which sitting of this component, starting at 1. Server-assigned. */
  sequenceNumber: number;

  /** ISO-8601, or null while the date is unfixed. */
  scheduledAt: string | null;
  conductedById: string | null;

  status: AssessmentEventStatus;
  /** ISO-8601. While the status is PUBLISHED this is the publication date. */
  statusChangedAt: string;

  /** Derived: marks may be created or amended right now. */
  acceptsMarks: boolean;
  /** Derived: students can see this sitting's marks. */
  isPublished: boolean;
  /** Derived: the sitting's own definition may still be amended. */
  isEditable: boolean;

  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
}

/**
 * One page of sittings.
 *
 * Paginated, like the registration list and unlike the rule and criterion
 * collections. The difference is real: a rule set is a pipeline whose members
 * compose, so a page of it misrepresents the whole. An assessment calendar is a
 * genuine collection that grows with the institution — every sitting of every
 * component of every course in a term — so it must be paged.
 */
export interface AssessmentEventListDTO {
  events: AssessmentEventDTO[];
  pagination: Pagination;
}
