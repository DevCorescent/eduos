// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Lock & Audit System (Phase 22)
// LAYER  : Domain
// PURPOSE: The single definition of "is this date inside this lock's window",
//          and the single definition of "is this attendance write refused".
//
// WHY THIS IS A PURE MODULE AND NOT A PRISMA PREDICATE
//   The rule is consulted from THREE places: the lock-status endpoint, the
//   attendance POST route and the attendance DELETE route. Written as a Prisma
//   `where` fragment it would be three fragments, and the day the semantics of
//   an open-ended window changed, two would be updated and one forgotten — in a
//   module whose entire purpose is that a finalised record cannot be altered.
//
//   Stated here as a function over plain values it is testable with no
//   database, and every caller is provably asking the same question.
//
// THE WINDOW IS INCLUSIVE AT BOTH ENDS
//   A lock stated as 1st-31st covers the 31st. The alternative — a half-open
//   interval — is defensible in the abstract and wrong here: an administrator
//   typing the last day of a month means that day, and a register silently
//   editable on the final day of a "locked" month is the exact failure this
//   phase exists to prevent.
//
// NULL MEANS UNBOUNDED, WHICH IS HOW "SEMESTER LOCK" IS EXPRESSED
//   fromDate null = from the beginning of time. toDate null = to the end of it.
//   Both null is therefore the whole semester, which is the README's "Semester
//   Lock", and a supplied range is its "Attendance Freeze". One mechanism.
// ============================================================================

import { AttendanceLockStatus } from "@/app/generated/prisma/enums";

/** The window columns, as plain values. Accepts a Prisma row unchanged. */
export interface LockWindow {
  readonly fromDate: Date | null;
  readonly toDate: Date | null;
}

/** A lock's state and window — the minimum needed to decide a refusal. */
export interface LockDecisionInput extends LockWindow {
  readonly status: AttendanceLockStatus;
}

/**
 * Reduce an instant to the UTC day it names.
 *
 * Attendance.date and AttendanceLock.fromDate/toDate are both `@db.Date`, so
 * both arrive from Prisma as midnight UTC. A caller comparing a timestamped
 * `new Date()` against them would otherwise get an off-by-one on any machine
 * east or west of UTC — the boundary of a legal record must not depend on where
 * the server happens to run.
 */
export function toUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  );
}

/**
 * Does this lock's window cover `date`?
 *
 * Both bounds are INCLUSIVE, and a null bound is unbounded on that side. The
 * comparison is performed on whole UTC days, so a time component on either
 * operand cannot move a date across a boundary.
 *
 * COMPLEXITY: O(1).
 */
export function windowCoversDate(window: LockWindow, date: Date): boolean {
  const day = toUtcDay(date).getTime();

  if (window.fromDate !== null && day < toUtcDay(window.fromDate).getTime()) {
    return false;
  }

  if (window.toDate !== null && day > toUtcDay(window.toDate).getTime()) {
    return false;
  }

  return true;
}

/**
 * Is a write to attendance dated `date` refused by this lock?
 *
 * TWO CONDITIONS, BOTH REQUIRED: the lock must currently be LOCKED, and its
 * window must cover the date. An UNLOCKED row is retained for its history and
 * refuses nothing — which is why the status is checked here rather than assumed
 * by the caller's query.
 *
 * COMPLEXITY: O(1).
 */
export function isWriteBlocked(lock: LockDecisionInput, date: Date): boolean {
  return lock.status === AttendanceLockStatus.LOCKED && windowCoversDate(lock, date);
}

/**
 * The first lock among `locks` that refuses a write dated `date`, or null.
 *
 * Returns the LOCK rather than a boolean so a caller can report WHICH teaching
 * unit refused — "attendance is locked" with no indication of which course is a
 * message a faculty member cannot act on.
 *
 * COMPLEXITY: O(n) in the number of locks, which is bounded by the distinct
 * (course, section) pairs in one request rather than by the tenant's total.
 */
export function findBlockingLock<T extends LockDecisionInput>(
  locks: readonly T[],
  date: Date
): T | null {
  return locks.find((lock) => isWriteBlocked(lock, date)) ?? null;
}

/**
 * Validate a window before it is stored.
 *
 * The schema cannot express "fromDate <= toDate" — a CHECK constraint could,
 * but adding one is a change to a table this phase creates and every other
 * range in the project (Semester, AcademicYear, Certificate) validates the same
 * way, in code. Consistency wins over a lone structural guarantee here.
 */
export function isWindowOrdered(window: LockWindow): boolean {
  if (window.fromDate === null || window.toDate === null) return true;

  return toUtcDay(window.fromDate).getTime() <= toUtcDay(window.toDate).getTime();
}
