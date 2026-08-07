// ============================================================================
// OWNER  : Gauransh
// MODULE : Feedback — Eligibility
// LAYER  : Domain (pure)
// PURPOSE: Decide whether a student may submit feedback about a faculty member
//          for a course in a semester.
//
// PURITY
//   No Prisma, no HTTP, no repository, no service, no DTO. Every fact arrives
//   as plain data — the caller supplies the EVIDENCE and this module supplies
//   the verdict.
//
// THREE THINGS MUST HOLD, AND THEY FAIL DIFFERENTLY
//
//   1. The form must be OPEN. A CLOSED form is not an authorisation failure —
//      the window shut — and telling a student "forbidden" when the honest
//      answer is "too late" sends them to the wrong person for help.
//
//   2. The student must actually have been TAUGHT. Registration alone is not
//      enough: a student registered for a course was taught it by whichever
//      faculty the assignment names, and rating a different one would be rating
//      a stranger. The evidence is FacultyCourseAssignment, whose sectionId and
//      semesterId are NULLABLE — and a null there means "all sections" or "all
//      semesters", not "no match". Getting that backwards would silently refuse
//      every student of a department-wide assignment.
//
//   3. For a LAB form, a LAB session must have happened. Per the Phase 20
//      decision this reads Timetable.sessionType, NOT Course.type — a lab
//      course taught only as lectures should not collect lab feedback, and a
//      lecture course with a weekly lab should.
//
//   A duplicate is checked separately and last, because it is the only one that
//   is not about entitlement: the student WAS entitled, and already used it.
//
// COMPLEXITY
//   O(a + t) in the assignments and timetable entries supplied — a handful per
//   student. No nested scan.
// ============================================================================

import type { SessionType } from "@/app/generated/prisma/enums";

/** The context a student is trying to give feedback about. */
export interface FeedbackContext {
  readonly facultyId: string;
  readonly courseId: string;
  readonly semesterId: string;
}

/**
 * One FacultyCourseAssignment, as evidence.
 *
 * `sectionId` and `semesterId` are nullable in the schema and a null means
 * "any" — see the file header.
 */
export interface TeachingAssignment {
  readonly facultyId: string;
  readonly courseId: string;
  readonly sectionId: string | null;
  readonly semesterId: string | null;
  readonly isActive: boolean;
}

/** One Timetable entry, as evidence that a session of a kind took place. */
export interface ScheduledSession {
  readonly facultyId: string;
  readonly courseId: string;
  readonly semesterId: string;
  readonly sectionId: string;
  readonly sessionType: SessionType;
  readonly isActive: boolean;
}

/** What the student's own registration says. */
export interface RegistrationEvidence {
  readonly courseId: string;
  readonly semesterId: string;
  readonly sectionId: string | null;
}

/** Everything an eligibility decision needs. */
export interface EligibilityInput {
  readonly context: FeedbackContext;
  /** The form's window. Only OPEN admits a write. */
  readonly formIsOpen: boolean;
  /** LECTURE or LAB — which kind of teaching the form asks about. */
  readonly formSessionType: SessionType;
  /** The student's own registrations. Empty means they took nothing. */
  readonly registrations: readonly RegistrationEvidence[];
  readonly assignments: readonly TeachingAssignment[];
  readonly sessions: readonly ScheduledSession[];
  /** Whether a submission already exists for this exact context. */
  readonly hasExistingSubmission: boolean;
  /** Whether that existing submission is already final. */
  readonly existingIsSubmitted: boolean;
}

/** Why a student may not submit. */
export const INELIGIBILITY_REASON = {
  FORM_NOT_OPEN: "FORM_NOT_OPEN",
  NOT_REGISTERED: "NOT_REGISTERED",
  NOT_TAUGHT_BY_FACULTY: "NOT_TAUGHT_BY_FACULTY",
  NO_LAB_SESSION: "NO_LAB_SESSION",
  ALREADY_SUBMITTED: "ALREADY_SUBMITTED",
} as const;

export type IneligibilityReason =
  (typeof INELIGIBILITY_REASON)[keyof typeof INELIGIBILITY_REASON];

/** Whether a student may submit, and why not. */
export interface EligibilityVerdict {
  readonly isEligible: boolean;
  readonly reason: IneligibilityReason | null;
  /**
   * True when an existing DRAFT may be edited rather than a new row created.
   *
   * Distinct from eligibility: a student with an open draft IS eligible, and
   * the caller needs to know to update rather than insert.
   */
  readonly isEdit: boolean;
}

const ELIGIBLE: EligibilityVerdict = { isEligible: true, reason: null, isEdit: false };

function refuse(reason: IneligibilityReason): EligibilityVerdict {
  return { isEligible: false, reason, isEdit: false };
}

/** Whether the student was registered for this course in this semester. */
export function isRegistered(
  registrations: readonly RegistrationEvidence[],
  context: FeedbackContext
): boolean {
  return registrations.some(
    (registration) =>
      registration.courseId === context.courseId &&
      registration.semesterId === context.semesterId
  );
}

/**
 * Whether an assignment covers this context.
 *
 * A null `semesterId` on the assignment means the faculty member teaches the
 * course in EVERY semester, so it matches. A null `sectionId` means every
 * section. Treating either null as a non-match would refuse every student whose
 * department assigns faculty course-wide rather than section-by-section — which
 * is the ordinary arrangement.
 */
export function assignmentCovers(
  assignment: TeachingAssignment,
  context: FeedbackContext
): boolean {
  if (!assignment.isActive) {
    return false;
  }

  if (assignment.facultyId !== context.facultyId) {
    return false;
  }

  if (assignment.courseId !== context.courseId) {
    return false;
  }

  // Null means "any semester".
  return assignment.semesterId === null || assignment.semesterId === context.semesterId;
}

/** Whether any assignment shows this faculty member taught this course. */
export function wasTaughtBy(
  assignments: readonly TeachingAssignment[],
  context: FeedbackContext
): boolean {
  return assignments.some((assignment) => assignmentCovers(assignment, context));
}

/**
 * Whether a session of the required kind actually took place.
 *
 * Reads Timetable.sessionType per the Phase 20 decision. A LECTURE form needs no
 * such evidence — the teaching assignment already establishes it — so this is
 * consulted only for a LAB form, where the whole point is that the lab may not
 * have happened even though the course exists.
 */
export function hadSessionOfType(
  sessions: readonly ScheduledSession[],
  context: FeedbackContext,
  sessionType: SessionType
): boolean {
  return sessions.some(
    (session) =>
      session.isActive &&
      session.facultyId === context.facultyId &&
      session.courseId === context.courseId &&
      session.semesterId === context.semesterId &&
      session.sessionType === sessionType
  );
}

/**
 * Decide whether a student may submit.
 *
 * Checks run in the order a student would want to hear them: the window first
 * (a shut form is nobody's fault), then entitlement, then the duplicate. An
 * existing DRAFT is eligible and flagged as an EDIT; an existing SUBMITTED one
 * is refused — the Phase 20 rule is one submission per context, and editing
 * after finishing is a different feature nobody asked for.
 *
 * COMPLEXITY : O(r + a + t), one pass over each evidence list.
 */
export function evaluateEligibility(input: EligibilityInput): EligibilityVerdict {
  if (!input.formIsOpen) {
    return refuse(INELIGIBILITY_REASON.FORM_NOT_OPEN);
  }

  if (!isRegistered(input.registrations, input.context)) {
    return refuse(INELIGIBILITY_REASON.NOT_REGISTERED);
  }

  if (!wasTaughtBy(input.assignments, input.context)) {
    return refuse(INELIGIBILITY_REASON.NOT_TAUGHT_BY_FACULTY);
  }

  if (
    input.formSessionType === "LAB" &&
    !hadSessionOfType(input.sessions, input.context, "LAB")
  ) {
    return refuse(INELIGIBILITY_REASON.NO_LAB_SESSION);
  }

  if (input.hasExistingSubmission && input.existingIsSubmitted) {
    return refuse(INELIGIBILITY_REASON.ALREADY_SUBMITTED);
  }

  // An open draft is eligible, and the caller must UPDATE rather than insert —
  // the unique constraint would refuse a second row.
  return input.hasExistingSubmission ? { ...ELIGIBLE, isEdit: true } : ELIGIBLE;
}
