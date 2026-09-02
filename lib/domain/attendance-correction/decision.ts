// ============================================================================
// MODULE : Domain — attendance correction decision
// LAYER  : Domain. PURE — no database, no headers, no environment.
// PURPOSE: The three rules a correction review turns on: is the request still
//          open, is the reviewer allowed to be the one deciding it, and is the
//          correction a change at all.
//
// WHY THESE ARE HERE AND NOT INLINE IN THE SERVICE
//   Each is a refusal a caller can trigger deliberately, so each needs to be
//   exercisable without a database. Same reason
//   lib/domain/attendance-lock/lockWindow.ts sits apart from its service.
// ============================================================================

/** The states a request can be in. Mirrors AttendanceCorrectionStatus. */
export const CORRECTION_STATUS = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;

export type CorrectionStatus =
  (typeof CORRECTION_STATUS)[keyof typeof CORRECTION_STATUS];

export const CORRECTION_REFUSAL = {
  ALREADY_DECIDED: "ALREADY_DECIDED",
  SELF_REVIEW: "SELF_REVIEW",
  NO_CHANGE: "NO_CHANGE",
} as const;

export type CorrectionRefusal =
  (typeof CORRECTION_REFUSAL)[keyof typeof CORRECTION_REFUSAL];

export type ReviewDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: CorrectionRefusal };

export interface ReviewInput {
  readonly status: string;
  /** Who raised it. Null when that account has since been deleted. */
  readonly requestedById: string | null;
  /** The authenticated reviewer. */
  readonly reviewerId: string;
}

/**
 * May this reviewer decide this request?
 *
 * ALREADY DECIDED FIRST. A second approval must not re-apply a correction that
 * has already been applied, and a second rejection must not overwrite the note
 * explaining the first. Deciding a settled request is refused before anything
 * else is considered.
 *
 * SELF-REVIEW IS REFUSED. The PRD names an approval step, and an approval the
 * requester grants themselves is not one — it would make the whole workflow a
 * slower way of editing the record directly, which is what this replaces.
 * A request raised by an account that no longer exists (`requestedById: null`)
 * cannot be self-reviewed by anyone, so it is allowed through.
 */
export function decideReview(input: ReviewInput): ReviewDecision {
  if (input.status !== CORRECTION_STATUS.PENDING) {
    return { allowed: false, reason: CORRECTION_REFUSAL.ALREADY_DECIDED };
  }

  if (input.requestedById !== null && input.requestedById === input.reviewerId) {
    return { allowed: false, reason: CORRECTION_REFUSAL.SELF_REVIEW };
  }

  return { allowed: true };
}

/**
 * Is this request asking for an actual change?
 *
 * A request from PRESENT to PRESENT has nothing to approve and would occupy the
 * one pending slot for the record, blocking a real correction behind it.
 */
export function isRealChange(current: string, requested: string): boolean {
  return current !== requested;
}
