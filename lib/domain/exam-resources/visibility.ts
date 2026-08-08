// ============================================================================
// OWNER  : Gauransh
// MODULE : Question Paper & Solution Repository (Phase 26)
// LAYER  : Domain
// PURPOSE: The single definition of "may a student see this resource yet".
//
// WHY THIS IS A PURE MODULE
//   The rule is consulted from THREE places: the student list endpoint, the
//   student detail endpoint and the student download endpoint. Written inline
//   it would be three predicates, and the day the scheduling semantics changed,
//   two would be updated and one forgotten — leaving a route that serves an
//   unpublished answer key. Stated here it is testable with no database, and
//   every caller provably asks the same question.
//
// SCHEDULED PUBLICATION IS EVALUATED ON READ, NOT BY A JOB
//   The project has no cron, queue or job runner — verified before this module
//   was written. `scheduledPublishAt` is therefore a stored instant compared
//   against `now()` at query time; nothing flips a status column on a timer.
//
//   The consequence, stated plainly: a resource can be PUBLISHED and still
//   invisible because its scheduled moment has not arrived. That is a real
//   state and both the staff listing and this predicate report it honestly,
//   rather than pretending the status alone decides.
//
// THE BOUNDARY IS INCLUSIVE
//   A resource scheduled for 09:00 is visible AT 09:00, not one millisecond
//   after. A student refreshing on the hour must see it.
// ============================================================================

import { ExamResourceStatus } from "@/app/generated/prisma/enums";

/** The columns the visibility decision reads. Accepts a Prisma row unchanged. */
export interface VisibilityInput {
  readonly status: ExamResourceStatus;
  readonly scheduledPublishAt: Date | null;
}

/**
 * Has this resource's scheduled publication moment arrived?
 *
 * A null `scheduledPublishAt` means "as soon as it is PUBLISHED" — the absence
 * of a schedule is not a schedule at the end of time, which is the failure
 * TD-002 records for coerced dates elsewhere in this project.
 *
 * COMPLEXITY: O(1).
 */
export function isScheduleElapsed(resource: VisibilityInput, now: Date): boolean {
  if (resource.scheduledPublishAt === null) return true;

  return resource.scheduledPublishAt.getTime() <= now.getTime();
}

/**
 * May a student see this resource?
 *
 * TWO CONDITIONS, BOTH REQUIRED: the resource must be PUBLISHED, and any
 * scheduled moment must have elapsed. A DRAFT is the README's "Draft Mode" and
 * is never visible; an ARCHIVED resource is withdrawn and is retained for staff
 * only.
 *
 * `isVerified` is deliberately NOT consulted. The README lists HOD verification
 * and HOD publication as SEPARATE capabilities, so verification is a quality
 * signal reported alongside a resource rather than a gate in front of it.
 * Making it a gate would silently hide material a faculty member deliberately
 * released.
 *
 * COMPLEXITY: O(1).
 */
export function isVisibleToStudent(resource: VisibilityInput, now: Date): boolean {
  return (
    resource.status === ExamResourceStatus.PUBLISHED && isScheduleElapsed(resource, now)
  );
}

/**
 * Why a published resource is not yet visible, for the staff listing.
 *
 * Returns null when the resource IS visible, so a caller can render "live"
 * versus "scheduled for ..." without re-deriving the condition.
 */
export function pendingReason(
  resource: VisibilityInput,
  now: Date
): "DRAFT" | "ARCHIVED" | "SCHEDULED" | null {
  if (resource.status === ExamResourceStatus.DRAFT) return "DRAFT";
  if (resource.status === ExamResourceStatus.ARCHIVED) return "ARCHIVED";
  if (!isScheduleElapsed(resource, now)) return "SCHEDULED";

  return null;
}
