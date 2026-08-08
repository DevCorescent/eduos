// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Lock & Audit System (Phase 22)
// LAYER  : Validation
// PURPOSE: The request contracts for the four Phase 22 endpoints.
//
// EVERY BODY SCHEMA IS .strict()
//   A supplied `tenantId`, `lockedById` or `status` is a 400 rather than a
//   silent strip. The difference matters here more than elsewhere: a client
//   that believes it set the actor of a lock, and is quietly ignored, produces
//   an audit record attributing a legal finalisation to the wrong person. A
//   rejection tells them; a strip does not.
//
// DATES ARE PARSED, NOT COERCED
//   TD-002 records that the project's `z.coerce.date()` turns null, true and
//   false into the Unix epoch instead of rejecting them. That is tolerable for
//   a due date; it is not tolerable for the boundary of a lock, where an epoch
//   fromDate silently widens a freeze to cover every record the tenant holds.
//   These schemas therefore use z.iso.date() and refuse anything that is not an
//   actual calendar date. This is a DELIBERATE divergence from the project-wide
//   convention, taken because the failure mode differs in kind.
// ============================================================================

import { z } from "zod";
import { identifier } from "@/lib/validations/shared";
import { ATTENDANCE_LOCK_ACTIONS, ATTENDANCE_LOCK_MESSAGE } from "@/lib/constants/attendanceLock";
import { isWindowOrdered } from "@/lib/domain/attendance-lock/lockWindow";

/**
 * A calendar date, as YYYY-MM-DD, interpreted at UTC midnight.
 *
 * The transform is what makes the value comparable with a `@db.Date` column:
 * `new Date("2026-03-01")` is already UTC midnight, but stating it explicitly
 * means a future change to the input format cannot silently introduce a local
 * timezone offset.
 */
const calendarDate = z.iso
  .date()
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

/**
 * The triple that names a teaching unit.
 *
 * All three are REQUIRED. A lock naming only a course would have to mean "every
 * section", which the unique key cannot express and the enforcement predicate
 * could not evaluate without a second query shape — so the scope is stated
 * fully or not at all.
 */
const teachingUnit = {
  courseId: identifier,
  sectionId: identifier,
  semesterId: identifier,
};

/** The window, shared by lock and by the status query. */
const window = {
  fromDate: calendarDate.nullish(),
  toDate: calendarDate.nullish(),
};

/**
 * POST /api/attendance/lock
 *
 * `status` is absent: a lock request produces a LOCKED row by definition, and
 * accepting the column would let a caller create an already-released lock,
 * which is a state with no meaning and no audit story.
 */
export const lockAttendanceSchema = z
  .object({
    ...teachingUnit,
    ...window,
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine(
    (value) => isWindowOrdered({ fromDate: value.fromDate ?? null, toDate: value.toDate ?? null }),
    { message: ATTENDANCE_LOCK_MESSAGE.INVALID_WINDOW, path: ["toDate"] }
  );

export type LockAttendanceInput = z.infer<typeof lockAttendanceSchema>;

/**
 * POST /api/attendance/unlock
 *
 * No window. An unlock releases the lock that exists; permitting a partial
 * release would mean splitting one row into two, and the README describes
 * unlocking a finalised unit rather than carving a hole in it.
 *
 * `reason` is REQUIRED here and optional on lock. Releasing a legal record is
 * the consequential direction — TD-008 and TD-C39 both record what an
 * unexplained reversal costs — and an HOD overriding a finalisation should have
 * to say why.
 */
export const unlockAttendanceSchema = z
  .object({
    ...teachingUnit,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type UnlockAttendanceInput = z.infer<typeof unlockAttendanceSchema>;

/**
 * GET /api/attendance/lock-status
 *
 * Every filter optional, so the endpoint answers both "is THIS unit locked"
 * and "what is locked in this semester". `date` narrows further: supplied, the
 * response reports whether each lock would refuse a write on that day, which is
 * the question a faculty member opening a register actually has.
 */
export const lockStatusQuerySchema = z
  .object({
    courseId: identifier.optional(),
    sectionId: identifier.optional(),
    semesterId: identifier.optional(),
    date: calendarDate.optional(),
  })
  .strict();

export type LockStatusQuery = z.infer<typeof lockStatusQuerySchema>;

/**
 * GET /api/attendance/audit
 *
 * Paginated, because an audit history is unbounded by nature — a busy
 * department locks and unlocks continuously across a semester, and an
 * unpaginated read would grow without limit.
 */
export const attendanceAuditQuerySchema = z
  .object({
    courseId: identifier.optional(),
    sectionId: identifier.optional(),
    semesterId: identifier.optional(),
    action: z.enum(ATTENDANCE_LOCK_ACTIONS).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type AttendanceAuditQuery = z.infer<typeof attendanceAuditQuerySchema>;
