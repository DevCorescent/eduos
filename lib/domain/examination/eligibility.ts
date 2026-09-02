// ============================================================================
// MODULE : Domain — Examination eligibility
// LAYER  : Domain. PURE — no database, no headers, no environment.
// PURPOSE: Decide whether one student may sit one examination.
//
// PRD §17.2 lists "Student eligibility" under Examination Configuration, and
// §13.2 lists "Attendance eligibility calculation" and "Detention-list
// generation" under Attendance. This is the intersection of those two: a
// student sits an examination when they are enrolled in its course and have
// attended enough of it.
//
// ELIGIBILITY IS DERIVED, NEVER STORED
//   Every input — the enrolment status and the attendance register — already
//   exists and already changes. A stored eligibility flag would be a CACHE of
//   them, and the day it disagreed with the register nobody could say which was
//   right. It is recomputed on every read instead, which is also why there is
//   no eligibility table in this change.
//
// WHY IT IS ITS OWN PURE FUNCTION
//   It gates hall-ticket issue, so it is a security-relevant branch: "may this
//   student be given a ticket" has to be answerable without a database in a
//   test. Same reason lib/domain/department/scope.ts exists apart from its
//   lookup.
// ============================================================================

/** Enrolment states that represent a live registration in a course. */
export const ELIGIBLE_REGISTRATION_STATUSES = [
  "REGISTERED",
  "CONFIRMED",
] as const;

/**
 * The attendance floor, as a percentage.
 *
 * Re-stated from lib/services/attendanceAnalytics.service.ts rather than
 * imported: that module reaches for the database, and this one must stay pure.
 * The value is asserted equal to it by a test, so the two cannot drift.
 */
export const MINIMUM_ATTENDANCE_PERCENTAGE = 75;

/** Why a student may not sit. Ordered by precedence, most fundamental first. */
export const INELIGIBILITY_REASON = {
  NOT_REGISTERED: "NOT_REGISTERED",
  REGISTRATION_NOT_ACTIVE: "REGISTRATION_NOT_ACTIVE",
  ATTENDANCE_SHORTAGE: "ATTENDANCE_SHORTAGE",
} as const;

export type IneligibilityReason =
  (typeof INELIGIBILITY_REASON)[keyof typeof INELIGIBILITY_REASON];

export interface EligibilityInput {
  /** The student's enrolment in the examination's course, or null. */
  readonly registrationStatus: string | null;
  /** Sessions held for the course. Zero means the register has not started. */
  readonly sessionsHeld: number;
  /** Sessions the student was present or otherwise credited for. */
  readonly sessionsAttended: number;
}

export type EligibilityDecision =
  | { readonly eligible: true; readonly attendancePercentage: number }
  | {
      readonly eligible: false;
      readonly reason: IneligibilityReason;
      readonly attendancePercentage: number;
    };

/**
 * Attendance as a whole-number percentage.
 *
 * A register with no sessions held yields 100, NOT 0. Nobody has missed a class
 * that never happened, and returning 0 would make every student in a freshly
 * created course ineligible — which is how an eligibility rule ends up being
 * switched off in production rather than fixed.
 */
export function attendancePercentage(held: number, attended: number): number {
  if (held <= 0) return 100;

  return Math.round((attended / held) * 100);
}

/**
 * Decide whether this student may sit this examination.
 *
 * PRECEDENCE: registration first, attendance second. A student who is not
 * enrolled is not "short of attendance" — telling them the wrong thing sends
 * them to the wrong office.
 *
 * @example
 * decideEligibility({ registrationStatus: "CONFIRMED", sessionsHeld: 10, sessionsAttended: 9 })
 * // { eligible: true, attendancePercentage: 90 }
 */
export function decideEligibility(input: EligibilityInput): EligibilityDecision {
  const percentage = attendancePercentage(input.sessionsHeld, input.sessionsAttended);

  if (input.registrationStatus === null) {
    return {
      eligible: false,
      reason: INELIGIBILITY_REASON.NOT_REGISTERED,
      attendancePercentage: percentage,
    };
  }

  const active = (ELIGIBLE_REGISTRATION_STATUSES as readonly string[]).includes(
    input.registrationStatus
  );

  if (!active) {
    return {
      eligible: false,
      reason: INELIGIBILITY_REASON.REGISTRATION_NOT_ACTIVE,
      attendancePercentage: percentage,
    };
  }

  if (percentage < MINIMUM_ATTENDANCE_PERCENTAGE) {
    return {
      eligible: false,
      reason: INELIGIBILITY_REASON.ATTENDANCE_SHORTAGE,
      attendancePercentage: percentage,
    };
  }

  return { eligible: true, attendancePercentage: percentage };
}
