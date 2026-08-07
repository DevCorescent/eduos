// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Feedback System
// LAYER  : Constants
// PURPOSE: The rating scale, the disclosure threshold, and the bounds this
//          module enforces.
//
// SCOPE NOTE
//   Batch 2 declares only what the REPOSITORY and VALIDATION layers need. The
//   role sets, lifecycle transition table and messages arrive with the service
//   in Batch 3 — declaring them now would be surface with nothing behind it.
//
// THE SCALE IS DECLARED ONCE
//   1..5 appears here and nowhere else. Validation bounds an answer against it,
//   the domain engine will normalise a category score against it, and a report
//   renders it. Three copies of "5" would be three chances for one of them to
//   become "10" alone.
// ============================================================================

import { ROLES } from "@/constants/roles";

// --- The rating scale -------------------------------------------------------

/** Lowest rating a student may give. */
export const RATING_MIN = 1;

/** Highest rating a student may give. */
export const RATING_MAX = 5;

/**
 * The span of the scale, for normalising a score to a percentage.
 *
 * Derived rather than written as 4, so a scale change moves one number.
 */
export const RATING_SPAN = RATING_MAX - RATING_MIN;

// --- Disclosure -------------------------------------------------------------

/**
 * Submissions required before a FACULTY member may see their own results.
 *
 * Anonymity is not achieved by omitting a name. In a cohort of three, a faculty
 * member who knows who was registered can often infer who said what — so the
 * identity is protected by withholding the AGGREGATE until the sample is large
 * enough to hide an individual inside it.
 *
 * Five, per the Phase 20 decision. UNIVERSITY_ADMIN is never subject to this:
 * an administrator investigating a complaint needs the data, and they are
 * already trusted with attribution.
 *
 * A constant rather than a column because it is an institution-wide privacy
 * floor, not a per-form setting. If a tenant ever needs its own, it becomes a
 * column on FeedbackForm and this becomes the default.
 */
export const MIN_SUBMISSIONS_FOR_FACULTY_VIEW = 5;

// --- Working scale ----------------------------------------------------------

/**
 * Decimal places an average rating is computed and reported at.
 *
 * A rating is an integer 1..5, but a MEAN of ratings is a quotient — and 4.33
 * must not become 4.3299999999999996 on the way to a report. Averages are
 * therefore carried as scaled integers and rendered as decimal strings, exactly
 * as every other computed decimal in this project is.
 */
export const RATING_SCALE = 2;

// --- Who is looking ---------------------------------------------------------

/**
 * The audiences a feedback analytic may be shown to.
 *
 * FACULTY — the person the feedback is ABOUT. Sees aggregates only, and only
 *           above the disclosure threshold.
 * HOD     — a department head. Held to the SAME threshold as faculty: the risk
 *           the threshold exists to prevent — inferring who said what in a small
 *           cohort — is identical for a colleague who knows the roster. This is
 *           a judgement, not a decision the Phase 20 brief made; see the
 *           accompanying report.
 * ADMIN   — an examination or quality office. Never withheld: an administrator
 *           investigating a complaint needs the data, and is already trusted
 *           with attribution.
 */
export const FEEDBACK_VIEWER = {
  FACULTY: "FACULTY",
  HOD: "HOD",
  ADMIN: "ADMIN",
} as const;

export type FeedbackViewer = (typeof FEEDBACK_VIEWER)[keyof typeof FEEDBACK_VIEWER];

/** Viewers whose sight of an aggregate is gated by the sample size. */
export const THRESHOLD_GATED_VIEWERS: readonly FeedbackViewer[] = [
  FEEDBACK_VIEWER.FACULTY,
  FEEDBACK_VIEWER.HOD,
];

// --- Authorization ----------------------------------------------------------

/** Roles permitted to submit feedback. STUDENT alone — nobody rates by proxy. */
export const FEEDBACK_SUBMIT_ROLES = [ROLES.STUDENT] as const;

/**
 * Roles permitted to read one faculty member's feedback.
 *
 * FACULTY is admitted at the ROLE gate and confined at the DATA gate: the
 * service refuses a faculty member reading anyone but themselves, and the
 * threshold then decides whether even their own is visible.
 */
export const FEEDBACK_FACULTY_READ_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.DEPARTMENT_HOD,
  ROLES.FACULTY,
] as const;

/**
 * Roles permitted to read the institution-wide report.
 *
 * FACULTY is absent. A cross-faculty report is a comparison between colleagues,
 * and it is a quality office's document rather than a participant's.
 */
export const FEEDBACK_REPORT_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.DEPARTMENT_HOD,
] as const;

// --- Lifecycle --------------------------------------------------------------

/** The only form status in which a submission may be written or edited. */
export const FEEDBACK_EDITABLE_STATUS = "OPEN" as const;

// --- Messages ---------------------------------------------------------------

export const FEEDBACK_MESSAGE = {
  FORBIDDEN: "Forbidden",
  FORM_NOT_FOUND: "Feedback form not found",
  FACULTY_NOT_FOUND: "Faculty member not found",
  SUBMISSION_NOT_FOUND: "Feedback submission not found",
  FORM_NOT_OPEN: "This feedback form is not accepting submissions",
  NOT_TAUGHT: "You were not taught this course by this faculty member",
  NOT_A_LAB: "This form asks about a lab you did not attend",
  ALREADY_SUBMITTED: "You have already submitted feedback for this context",
  UNKNOWN_QUESTION: "An answer cites a question that is not on this form",
  COMMENT_NOT_INVITED: "A comment was given on a question that does not invite one",
  INCOMPLETE: "Every required question must be answered before submitting",
  WITHHELD: "Results are withheld until enough responses have been received",
  COHORT_TOO_LARGE: "The cohort exceeds the size this endpoint will aggregate in one request",
} as const;

// --- Bounds -----------------------------------------------------------------

/**
 * Most questions one form may carry.
 *
 * A bound rather than a policy claim: a questionnaire longer than this is not
 * one students complete honestly, and an unbounded form is an unbounded write
 * on every submission.
 */
export const MAX_QUESTIONS_PER_FORM = 50;

/** Longest a free-text comment may be. */
export const MAX_COMMENT_LENGTH = 1000;

/**
 * Largest cohort one report will aggregate in a single request.
 *
 * A bound rather than pagination: a mean, a median and a distribution are all
 * statements about the WHOLE population, and computing them from a page would
 * produce numbers that are wrong rather than partial.
 */
export const MAX_REPORT_COHORT = 5000;
