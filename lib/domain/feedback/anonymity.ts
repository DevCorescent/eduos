// ============================================================================
// OWNER  : Gauransh
// MODULE : Feedback — Anonymity
// LAYER  : Domain (pure)
// PURPOSE: Decide whether an aggregate may be shown, and to whom.
//
// PURITY
//   No Prisma, no HTTP, no repository, no service, no DTO. This module takes a
//   COUNT and a VIEWER and returns a decision. It never sees a submission, so
//   it cannot leak one.
//
// ANONYMITY IS NOT THE ABSENCE OF A NAME
//   The repository already withholds `studentId` from every faculty-facing
//   projection, and that is necessary but nowhere near sufficient. In a cohort
//   of three, a faculty member who knows the roster can often infer who said
//   what from the ratings alone — so an identity is protected by withholding
//   the AGGREGATE until the sample is large enough to hide an individual inside
//   it.
//
//   That is what this module decides, and it is why a "small cohort" answer is
//   WITHHELD rather than empty: an empty result would tell a faculty member
//   nobody responded, which is a different and false statement.
//
// WHY A DEPARTMENT HEAD IS GATED LIKE A FACULTY MEMBER
//   The Phase 20 brief named FACULTY and ADMIN. A HOD is neither, and the risk
//   the threshold exists to prevent — a colleague who knows the roster
//   inferring an author — is identical for them. So they are gated, and the
//   choice is flagged in the accompanying report rather than buried here.
//
// COMPLEXITY
//   O(1). Every function is a comparison.
// ============================================================================

import {
  FEEDBACK_VIEWER,
  MIN_SUBMISSIONS_FOR_FACULTY_VIEW,
  THRESHOLD_GATED_VIEWERS,
  type FeedbackViewer,
} from "@/lib/constants/feedback";

/** Why an aggregate was withheld, when it was. */
export const WITHHOLDING_REASON = {
  BELOW_THRESHOLD: "BELOW_THRESHOLD",
  NOT_OWN_RECORD: "NOT_OWN_RECORD",
} as const;

export type WithholdingReason =
  (typeof WITHHOLDING_REASON)[keyof typeof WITHHOLDING_REASON];

/** Whether an aggregate may be disclosed to a viewer, and why not. */
export interface DisclosureVerdict {
  readonly isVisible: boolean;
  readonly reason: WithholdingReason | null;
  /** How many more responses are needed. Null when visible or not applicable. */
  readonly shortfall: number | null;
  /** The threshold applied, so a caller can explain it without knowing it. */
  readonly threshold: number;
}

/** Whether a viewer's sight of an aggregate depends on the sample size. */
export function isThresholdGated(viewer: FeedbackViewer): boolean {
  return THRESHOLD_GATED_VIEWERS.includes(viewer);
}

/**
 * Decide whether an aggregate may be shown.
 *
 * ADMIN is never gated: an administrator investigating a complaint needs the
 * data, and is already trusted with attribution. Everyone else must clear the
 * threshold.
 *
 * The verdict carries the SHORTFALL as well as the refusal, so a portal can say
 * "two more responses needed" rather than "unavailable" — the second is the
 * kind of message that generates a support ticket.
 *
 * COMPLEXITY : O(1).
 */
export function evaluateDisclosure(
  viewer: FeedbackViewer,
  submissionCount: number,
  threshold: number = MIN_SUBMISSIONS_FOR_FACULTY_VIEW
): DisclosureVerdict {
  if (!isThresholdGated(viewer)) {
    return { isVisible: true, reason: null, shortfall: null, threshold };
  }

  if (submissionCount >= threshold) {
    return { isVisible: true, reason: null, shortfall: null, threshold };
  }

  return {
    isVisible: false,
    reason: WITHHOLDING_REASON.BELOW_THRESHOLD,
    shortfall: threshold - submissionCount,
    threshold,
  };
}

/**
 * Whether a faculty member is looking at their OWN record.
 *
 * A faculty member reads feedback about themselves and nobody else. This is a
 * separate check from the threshold and runs BEFORE it: refusing with
 * "not enough responses" for a colleague's record would confirm the colleague
 * exists and hint at how many responses they have.
 *
 * COMPLEXITY : O(1).
 */
export function evaluateOwnership(
  viewer: FeedbackViewer,
  viewerFacultyId: string | null,
  subjectFacultyId: string
): DisclosureVerdict | null {
  if (viewer !== FEEDBACK_VIEWER.FACULTY) {
    return null;
  }

  if (viewerFacultyId !== null && viewerFacultyId === subjectFacultyId) {
    return null;
  }

  return {
    isVisible: false,
    reason: WITHHOLDING_REASON.NOT_OWN_RECORD,
    shortfall: null,
    threshold: MIN_SUBMISSIONS_FOR_FACULTY_VIEW,
  };
}

/**
 * The full gate: ownership first, then the threshold.
 *
 * Order matters and is the point of this function existing rather than callers
 * composing the two themselves — a caller who checked the threshold first would
 * leak a colleague's response count through the shortfall.
 *
 * COMPLEXITY : O(1).
 */
export function evaluateAccess(
  viewer: FeedbackViewer,
  viewerFacultyId: string | null,
  subjectFacultyId: string,
  submissionCount: number,
  threshold: number = MIN_SUBMISSIONS_FOR_FACULTY_VIEW
): DisclosureVerdict {
  const ownership = evaluateOwnership(viewer, viewerFacultyId, subjectFacultyId);

  if (ownership !== null) {
    return ownership;
  }

  return evaluateDisclosure(viewer, submissionCount, threshold);
}

/**
 * Whether a viewer may see WHO submitted.
 *
 * ADMIN alone, per the Phase 20 decision. Declared here as a function rather
 * than left to each caller's judgement, so "may this reader see a name" has one
 * answer in one place — and a test can assert that FACULTY never gets a true.
 *
 * COMPLEXITY : O(1).
 */
export function mayViewAttribution(viewer: FeedbackViewer): boolean {
  return viewer === FEEDBACK_VIEWER.ADMIN;
}

/**
 * Replace an aggregate with nothing when it may not be shown.
 *
 * Generic over what is being withheld, so a caller cannot accidentally return
 * the payload alongside a negative verdict — the function gives back either the
 * data or null, and there is no shape carrying both.
 *
 * COMPLEXITY : O(1).
 */
export function withhold<T>(verdict: DisclosureVerdict, payload: T): T | null {
  return verdict.isVisible ? payload : null;
}
