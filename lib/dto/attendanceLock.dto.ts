// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Lock & Audit System (Phase 22)
// LAYER  : DTO
// PURPOSE: The shapes the four Phase 22 endpoints return.
//
// NO PRISMA VALUE CROSSES THIS BOUNDARY
//   Every mapper returns a plain object with Date columns converted to ISO
//   strings. The window columns are `@db.Date`, so they are rendered as
//   YYYY-MM-DD rather than a full timestamp — reporting "2026-03-31T00:00:00Z"
//   for a value that only ever meant a calendar day invites a client to apply a
//   timezone to it and land on the 30th.
//
// THE ACTOR IS REPORTED AS A NAME WHERE ONE EXISTS
//   lockedBy and unlockedBy are nullable foreign keys to User. A bare cuid in
//   an audit view is unreadable, so the relation is expanded to a display name
//   and email. A null actor — the SetNull case, a user since deleted — is
//   reported as null rather than as "Unknown", because inventing a label would
//   obscure that the person is genuinely gone.
// ============================================================================

import type { AttendanceLockStatus } from "@/app/generated/prisma/enums";
import { windowCoversDate } from "@/lib/domain/attendance-lock/lockWindow";

/** A `@db.Date` column, as the calendar day it names. */
function toCalendarDay(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** Who took an action, when a User row is still resolvable. */
export interface LockActorDto {
  readonly id: string;
  readonly name: string | null;
  readonly email: string;
}

/** The User columns this module reads for attribution. */
export interface LockActorRow {
  readonly id: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly displayName: string | null;
  readonly email: string;
}

function toActorDto(actor: LockActorRow | null): LockActorDto | null {
  if (actor === null) return null;

  // displayName first because it is what a tenant chose to show; the name parts
  // are a fallback, and a row carrying neither reports null rather than "".
  const composed = [actor.firstName, actor.lastName].filter(Boolean).join(" ").trim();

  return {
    id: actor.id,
    name: actor.displayName ?? (composed.length > 0 ? composed : null),
    email: actor.email,
  };
}

/** What is named by the teaching unit a lock covers. */
export interface LockUnitDto {
  readonly courseId: string;
  readonly courseCode: string | null;
  readonly courseName: string | null;
  readonly sectionId: string;
  readonly sectionName: string | null;
  readonly semesterId: string;
  readonly semesterName: string | null;
}

/** One lock, as every endpoint in this module reports it. */
export interface AttendanceLockDto {
  readonly id: string;
  readonly tenantId: string;
  readonly unit: LockUnitDto;
  readonly status: AttendanceLockStatus;
  readonly fromDate: string | null;
  readonly toDate: string | null;
  readonly reason: string | null;
  readonly lockedBy: LockActorDto | null;
  readonly lockedAt: string;
  readonly unlockedBy: LockActorDto | null;
  readonly unlockedAt: string | null;
  readonly unlockReason: string | null;
  /**
   * Whether this lock would refuse a write on the date the caller asked about.
   *
   * Present only when `?date` was supplied to the lock-status endpoint. Null
   * otherwise — the honest answer to a question nobody asked, rather than a
   * default of `false` that reads as "this would be allowed".
   */
  readonly blocksRequestedDate: boolean | null;
}

/** The row shape the repository selects. Declared so the mapper states its need. */
export interface AttendanceLockRow {
  readonly id: string;
  readonly tenantId: string;
  readonly courseId: string;
  readonly sectionId: string;
  readonly semesterId: string;
  readonly status: AttendanceLockStatus;
  readonly fromDate: Date | null;
  readonly toDate: Date | null;
  readonly reason: string | null;
  readonly lockedAt: Date;
  readonly unlockedAt: Date | null;
  readonly unlockReason: string | null;
  readonly course: { code: string; name: string } | null;
  readonly section: { name: string } | null;
  readonly semester: { name: string } | null;
  readonly lockedBy: LockActorRow | null;
  readonly unlockedBy: LockActorRow | null;
}

/**
 * Map one lock.
 *
 * @param requestedDate the `?date` the caller asked about, or null. Drives
 *        `blocksRequestedDate` and nothing else.
 */
export function toAttendanceLockDto(
  row: AttendanceLockRow,
  requestedDate: Date | null
): AttendanceLockDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    unit: {
      courseId: row.courseId,
      courseCode: row.course?.code ?? null,
      courseName: row.course?.name ?? null,
      sectionId: row.sectionId,
      sectionName: row.section?.name ?? null,
      semesterId: row.semesterId,
      semesterName: row.semester?.name ?? null,
    },
    status: row.status,
    fromDate: toCalendarDay(row.fromDate),
    toDate: toCalendarDay(row.toDate),
    reason: row.reason,
    lockedBy: toActorDto(row.lockedBy),
    lockedAt: row.lockedAt.toISOString(),
    unlockedBy: toActorDto(row.unlockedBy),
    unlockedAt: toIso(row.unlockedAt),
    unlockReason: row.unlockReason,
    blocksRequestedDate:
      requestedDate === null
        ? null
        : row.status === "LOCKED" && windowCoversDate(row, requestedDate),
  };
}

/**
 * One audit entry, as GET /api/attendance/audit reports it.
 *
 * `actorId` is a bare id rather than an expanded name. AuditLog.userId carries
 * no foreign key and AuditLog declares no `user` relation — it is an
 * unconstrained identity column (the TD-C / TD-C41 family), so there is nothing
 * to traverse. A caller resolves the name through GET /api/users/[id]; doing it
 * here would be an N+1 over a paginated view.
 */
export interface AttendanceAuditEntryDto {
  readonly id: string;
  readonly action: string;
  readonly resourceId: string | null;
  readonly actorId: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly ipAddress: string | null;
  readonly createdAt: string;
}

/** The AuditLog row shape this module reads. */
export interface AttendanceAuditRow {
  readonly id: string;
  readonly action: string;
  readonly resourceId: string | null;
  readonly userId: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly ipAddress: string | null;
  readonly createdAt: Date;
}

export function toAttendanceAuditEntryDto(row: AttendanceAuditRow): AttendanceAuditEntryDto {
  return {
    id: row.id,
    action: row.action,
    resourceId: row.resourceId,
    actorId: row.userId,
    // The snapshots are stored Json and are reported exactly as stored. Nothing
    // reshapes them: an audit record that was rewritten on the way out would be
    // evidence of what the reader wanted rather than of what happened.
    before: row.before ?? null,
    after: row.after ?? null,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
  };
}
