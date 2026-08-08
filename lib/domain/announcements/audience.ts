// ============================================================================
// OWNER  : Gauransh
// MODULE : Notification Center & Announcement System (Phase 27)
// LAYER  : Domain
// PURPOSE: The two rules an announcement has — whether its audience and target
//          agree, and whether it is live at a given instant.
//
// WHY THE AUDIENCE RULE LIVES HERE
//   The schema cannot express "exactly one of departmentId, batchId and
//   sectionId is set, and it is the one `audience` names". A CHECK constraint
//   over an enum and three nullable columns is possible in raw SQL but is not
//   expressible in Prisma's schema language, so the invariant is behavioural.
//   Stating it once, as a pure function, means the create path and the update
//   path cannot enforce different versions of it.
//
// WHY THE LIVENESS RULE LIVES HERE
//   It is consulted from the list endpoint and the detail endpoint, and it will
//   be consulted again by anything that counts unread announcements. Three
//   copies of a scheduling predicate is three chances to publish something
//   early.
//
// SCHEDULING IS EVALUATED ON READ
//   Like Phase 26, and for the same reason: this project has no cron, queue or
//   job runner. `publishAt` is compared against now(); nothing flips a status
//   column on a timer.
// ============================================================================

import { AnnouncementAudience, AnnouncementStatus } from "@/app/generated/prisma/enums";

/** The audience columns, as plain values. Accepts a Prisma row unchanged. */
export interface AudienceTarget {
  readonly audience: AnnouncementAudience;
  readonly departmentId: string | null;
  readonly batchId: string | null;
  readonly sectionId: string | null;
}

/**
 * The three columns an audience can point at.
 *
 * Named as its own type rather than `keyof AudienceTarget`, which would also
 * admit `audience` itself — a caller passing that to a lookup would be a type
 * error nobody caught until runtime.
 */
export type TargetColumn = "departmentId" | "batchId" | "sectionId";

/** Which target column each audience requires. Null means "none of them". */
const REQUIRED_TARGET: Record<AnnouncementAudience, TargetColumn | null> = {
  [AnnouncementAudience.INSTITUTION]: null,
  [AnnouncementAudience.DEPARTMENT]: "departmentId",
  [AnnouncementAudience.BATCH]: "batchId",
  [AnnouncementAudience.SECTION]: "sectionId",
};

/**
 * Does this announcement's target match its audience?
 *
 * BOTH DIRECTIONS ARE CHECKED. A DEPARTMENT announcement with no departmentId
 * would be addressed to nobody; an INSTITUTION announcement carrying a batchId
 * would silently ignore it, leaving an author convinced they had narrowed the
 * audience when they had broadcast to everyone. The second case is the
 * dangerous one, and a check that only looked for missing targets would miss it
 * entirely.
 *
 * COMPLEXITY: O(1).
 */
export function isAudienceConsistent(target: AudienceTarget): boolean {
  const required = REQUIRED_TARGET[target.audience];

  const present: TargetColumn[] = [];
  if (target.departmentId !== null) present.push("departmentId");
  if (target.batchId !== null) present.push("batchId");
  if (target.sectionId !== null) present.push("sectionId");

  if (required === null) return present.length === 0;

  return present.length === 1 && present[0] === required;
}

/** Which target column an audience requires, for the service's lookup. */
export function requiredTargetFor(
  audience: AnnouncementAudience
): TargetColumn | null {
  return REQUIRED_TARGET[audience];
}

/** The columns the liveness decision reads. */
export interface LivenessInput {
  readonly status: AnnouncementStatus;
  readonly publishAt: Date | null;
  readonly expiresAt: Date | null;
}

/**
 * Is this announcement live at `now`?
 *
 * THREE CONDITIONS: PUBLISHED, any scheduled moment elapsed, and not expired.
 *
 * A null `publishAt` means "as soon as it is PUBLISHED" — the absence of a
 * schedule is not a schedule at the end of time. A null `expiresAt` means it
 * never stops, which is the ordinary case.
 *
 * The publish boundary is INCLUSIVE and the expiry boundary is EXCLUSIVE: an
 * announcement scheduled for 09:00 and expiring at 17:00 is live at 09:00 and
 * not at 17:00. That is how a person reads "from 9 until 5".
 *
 * COMPLEXITY: O(1).
 */
export function isLive(announcement: LivenessInput, now: Date): boolean {
  if (announcement.status !== AnnouncementStatus.PUBLISHED) return false;

  if (announcement.publishAt !== null && announcement.publishAt.getTime() > now.getTime()) {
    return false;
  }

  if (announcement.expiresAt !== null && announcement.expiresAt.getTime() <= now.getTime()) {
    return false;
  }

  return true;
}

/** Who a reader is, for the purpose of matching an announcement's audience. */
export interface ReaderScope {
  readonly departmentId: string | null;
  readonly batchId: string | null;
  readonly sectionId: string | null;
}

/**
 * Is this reader inside the announcement's audience?
 *
 * An INSTITUTION announcement reaches everyone in the tenant. A narrower one
 * reaches a reader whose corresponding scope matches.
 *
 * A reader with a NULL scope for the relevant dimension is NOT matched — a
 * faculty member with no department does not receive department announcements,
 * because there is no department they belong to. Matching them would mean
 * treating "unknown" as "all", which is how a section-scoped message reaches
 * the whole university.
 *
 * COMPLEXITY: O(1).
 */
export function reaches(target: AudienceTarget, reader: ReaderScope): boolean {
  switch (target.audience) {
    case AnnouncementAudience.INSTITUTION:
      return true;
    case AnnouncementAudience.DEPARTMENT:
      return reader.departmentId !== null && reader.departmentId === target.departmentId;
    case AnnouncementAudience.BATCH:
      return reader.batchId !== null && reader.batchId === target.batchId;
    case AnnouncementAudience.SECTION:
      return reader.sectionId !== null && reader.sectionId === target.sectionId;
    default:
      // Unreachable while AnnouncementAudience has four members. Fails CLOSED:
      // a member added later reaches nobody until this switch is extended,
      // which is the safe direction for a broadcast.
      return false;
  }
}
