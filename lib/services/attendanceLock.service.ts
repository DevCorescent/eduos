// ============================================================================
// OWNER      : Gauransh
// MODULE     : Attendance Lock & Audit System (Phase 22)
// LAYER      : Service
// PURPOSE    : Own every rule this phase has — what may be locked, who may
//              release it, what an attendance write is refused by, and what the
//              audit trail records.
// ARCHITECTURE:
//   • Service owns ALL orchestration and every decision.
//   • The one calculation — does a window cover a date — is delegated to
//     lib/domain/attendance-lock/lockWindow.ts, so the enforcement path and the
//     reporting path provably ask the same question.
//   • It issues no query of its own beyond its repository and two narrow ports.
//
// THE LOCK AND THE AUDIT ENTRY ARE WRITTEN IN ONE TRANSACTION
//   AuditLogRepository accepts a transaction handle precisely so an audit entry
//   cannot survive a rollback of the change it describes. A lock recorded in the
//   history but absent from the table would tell an investigator that
//   attendance was finalised when it was not — which is worse than no audit at
//   all, because it is confidently wrong.
//
// THE ENFORCEMENT PATH IS THE HOT ONE, AND IS SHAPED FOR IT
//   `assertWritable` is called on every attendance mark and every correction in
//   the system. It costs ONE query regardless of batch size: the distinct
//   (course, section) pairs are gathered, the LOCKED rows for them are read in
//   a single statement, and the window decision is made in memory. A
//   hundred-row register therefore pays one read, not a hundred.
//
// THE GAP THIS PHASE CANNOT CLOSE, STATED PLAINLY
//   Attendance.courseId and Attendance.sectionId are BOTH NULLABLE, and
//   Attendance has no semesterId column at all. A record naming neither a
//   course nor a section belongs to no teaching unit any lock can name, so it
//   cannot be refused by one. This is the same NULL-in-a-key shape already
//   recorded as TD-003 and TD-001, and closing it would mean making those
//   columns required — a change to a Phase 9 table this assignment excludes.
//   Records that DO name a course and a section are fully protected; the
//   semester is resolved from the section, which carries it.
// ============================================================================

import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import {
  ATTENDANCE_LOCK_ACTION,
  ATTENDANCE_LOCK_MESSAGE,
  ATTENDANCE_LOCK_RESOURCE,
} from "@/lib/constants/attendanceLock";
import { findBlockingLock, toUtcDay } from "@/lib/domain/attendance-lock/lockWindow";
import {
  toAttendanceAuditEntryDto,
  toAttendanceLockDto,
  type AttendanceAuditEntryDto,
  type AttendanceLockDto,
} from "@/lib/dto/attendanceLock.dto";
import type {
  AttendanceLockRepositoryPort,
  TeachingUnit,
} from "@/lib/repositories/attendanceLock.repository";
import type { AuditLogRepositoryPort } from "@/lib/repositories/auditLog.repository";
import type {
  AttendanceAuditQuery,
  LockAttendanceInput,
  LockStatusQuery,
  UnlockAttendanceInput,
} from "@/lib/validations/attendanceLock.validation";

/**
 * Confirms the three ids a lock names exist in this tenant.
 *
 * A NARROW PORT rather than a repository: these are three existence checks over
 * Phase 1-20 models this phase does not own, and reaching into their
 * repositories would couple the lock module to three others. The port returns
 * booleans and decides nothing — that a missing course is a 404 is this
 * service's rule.
 */
export interface TeachingUnitPort {
  courseExists(tenantId: string, courseId: string): Promise<boolean>;
  sectionExists(tenantId: string, sectionId: string): Promise<boolean>;
  semesterExists(tenantId: string, semesterId: string): Promise<boolean>;
  /**
   * The semesterId each of the given sections belongs to.
   *
   * The enforcement path's one piece of resolution: Attendance stores no
   * semester, but Section does, so a record's teaching unit is completable from
   * the section it names.
   */
  findSectionSemesters(
    tenantId: string,
    sectionIds: readonly string[]
  ): Promise<readonly { id: string; semesterId: string }[]>;
}

/** What the caller is attempting to write, as the enforcement path sees it. */
export interface AttendanceWriteCandidate {
  readonly courseId: string | null;
  readonly sectionId: string | null;
  readonly date: Date;
}

/** Request metadata carried into the audit entry. Never business input. */
export interface AuditContext {
  readonly userId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export class AttendanceLockService {
  constructor(
    private readonly locks: AttendanceLockRepositoryPort,
    private readonly auditLog: AuditLogRepositoryPort,
    private readonly units: TeachingUnitPort
  ) {}

  /**
   * POST /api/attendance/lock
   *
   * RULES   : All three ids must exist in this tenant — checked individually so
   *           the caller learns WHICH is wrong, rather than receiving one
   *           undifferentiated 404. A unit that is already LOCKED is a 409: a
   *           second lock would silently replace the first one's window and
   *           actor, and an administrator narrowing an existing freeze should
   *           unlock and relock deliberately rather than by accident.
   *
   *           The window is validated for ordering by the schema, so nothing is
   *           re-checked here.
   *
   * DATABASE: three existence reads (concurrent), one lookup, then an upsert and
   *           an audit write inside ONE transaction.
   *
   * AUDIT   : action ATTENDANCE_LOCK. The `after` snapshot carries the unit ids
   *           so the audit endpoint can filter by course, section or semester —
   *           AuditLog has no such columns, so the snapshot is the only place
   *           that information can live.
   */
  async lock(
    tenantId: string,
    input: LockAttendanceInput,
    context: AuditContext,
    now: Date
  ): Promise<AttendanceLockDto> {
    const unit: TeachingUnit = {
      courseId: input.courseId,
      sectionId: input.sectionId,
      semesterId: input.semesterId,
    };

    await this.assertUnitExists(tenantId, unit);

    const existing = await this.locks.findByUnit(tenantId, unit);

    if (existing && existing.status === "LOCKED") {
      throw new AppError(
        ATTENDANCE_LOCK_MESSAGE.ALREADY_LOCKED,
        HTTP_STATUS.CONFLICT,
        ERROR_CODE.CONFLICT
      );
    }

    const fromDate = input.fromDate ?? null;
    const toDate = input.toDate ?? null;

    const locked = await this.locks.transaction(async (client) => {
      const row = await this.locks.lock(
        {
          tenantId,
          unit,
          fromDate,
          toDate,
          reason: input.reason ?? null,
          lockedById: context.userId,
          lockedAt: now,
        },
        client
      );

      await this.auditLog.record(
        {
          tenantId,
          userId: context.userId,
          action: ATTENDANCE_LOCK_ACTION.LOCK,
          resource: ATTENDANCE_LOCK_RESOURCE,
          resourceId: row.id,
          // No `before` on a fresh lock; a re-lock carries the released state it
          // replaced, so the history explains what changed rather than only what
          // resulted.
          ...(existing ? { before: snapshotOf(existing) } : {}),
          after: {
            courseId: unit.courseId,
            sectionId: unit.sectionId,
            semesterId: unit.semesterId,
            status: row.status,
            fromDate: fromDate?.toISOString() ?? null,
            toDate: toDate?.toISOString() ?? null,
            reason: input.reason ?? null,
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        client
      );

      return row;
    });

    return toAttendanceLockDto(locked, null);
  }

  /**
   * POST /api/attendance/unlock
   *
   * RULES   : The unit must have a lock, and that lock must currently be LOCKED.
   *           A never-locked unit is 404 and an already-released one is 409:
   *           they are genuinely different situations, and telling an HOD
   *           "already unlocked" is actionable where "not found" would send them
   *           looking for a typo.
   *
   *           A reason is REQUIRED by the schema. Releasing a finalised academic
   *           record unexplained is exactly the unattributable-reversal shape
   *           TD-008 and TD-C39 record elsewhere in this project.
   *
   *           The repository's update carries `status: LOCKED` in its predicate,
   *           so a concurrent unlock that wins the race leaves this one matching
   *           nothing — surfaced as 404 by the shared error mapper rather than
   *           reported as a release that did not happen.
   *
   * DATABASE: one lookup, then an update and an audit write inside ONE
   *           transaction.
   */
  async unlock(
    tenantId: string,
    input: UnlockAttendanceInput,
    context: AuditContext,
    now: Date
  ): Promise<AttendanceLockDto> {
    const unit: TeachingUnit = {
      courseId: input.courseId,
      sectionId: input.sectionId,
      semesterId: input.semesterId,
    };

    const existing = await this.locks.findByUnit(tenantId, unit);

    if (!existing) {
      throw new AppError(
        ATTENDANCE_LOCK_MESSAGE.LOCK_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }

    if (existing.status !== "LOCKED") {
      throw new AppError(
        ATTENDANCE_LOCK_MESSAGE.NOT_LOCKED,
        HTTP_STATUS.CONFLICT,
        ERROR_CODE.CONFLICT
      );
    }

    const released = await this.locks.transaction(async (client) => {
      const row = await this.locks.unlock(
        {
          lockId: existing.id,
          tenantId,
          unlockedById: context.userId,
          unlockedAt: now,
          unlockReason: input.reason,
        },
        client
      );

      await this.auditLog.record(
        {
          tenantId,
          userId: context.userId,
          action: ATTENDANCE_LOCK_ACTION.UNLOCK,
          resource: ATTENDANCE_LOCK_RESOURCE,
          resourceId: row.id,
          before: snapshotOf(existing),
          after: {
            courseId: unit.courseId,
            sectionId: unit.sectionId,
            semesterId: unit.semesterId,
            status: row.status,
            fromDate: row.fromDate?.toISOString() ?? null,
            toDate: row.toDate?.toISOString() ?? null,
            unlockReason: input.reason,
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        client
      );

      return row;
    });

    return toAttendanceLockDto(released, null);
  }

  /**
   * GET /api/attendance/lock-status
   *
   * REPORTS : Every lock matching the filter, held and released alike. A
   *           released lock is not noise — "this was locked and an HOD opened
   *           it on the 4th" is the answer to the question a faculty member
   *           usually has.
   *
   *           When `?date` is supplied, each lock also reports whether it would
   *           refuse a write on that day, decided by the SAME predicate the
   *           enforcement path uses. When it is not, that field is null rather
   *           than false — see the DTO.
   *
   * DATABASE: one statement.
   */
  async getStatus(tenantId: string, query: LockStatusQuery): Promise<readonly AttendanceLockDto[]> {
    const rows = await this.locks.findMany(tenantId, {
      courseId: query.courseId,
      sectionId: query.sectionId,
      semesterId: query.semesterId,
    });

    const requestedDate = query.date ? toUtcDay(query.date) : null;

    return rows.map((row) => toAttendanceLockDto(row, requestedDate));
  }

  /**
   * GET /api/attendance/audit
   *
   * REPORTS : This module's AuditLog entries, newest first, exactly as stored.
   *           Nothing is derived and no entry is reshaped — an audit record
   *           rewritten on the way out is evidence of what the reader wanted
   *           rather than of what happened.
   *
   * DATABASE: two statements in one transaction (a page and its total).
   */
  async getAudit(
    tenantId: string,
    query: AttendanceAuditQuery
  ): Promise<{
    readonly entries: readonly AttendanceAuditEntryDto[];
    readonly pagination: {
      readonly page: number;
      readonly limit: number;
      readonly total: number;
      readonly totalPages: number;
    };
  }> {
    const { rows, total } = await this.locks.findAudit(tenantId, query);

    return {
      entries: rows.map(toAttendanceAuditEntryDto),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  /**
   * THE ENFORCEMENT ENTRY POINT.
   *
   * Refuse the whole batch if ANY candidate falls inside a held lock.
   *
   * ALL-OR-NOTHING, DELIBERATELY. A partial write would leave the caller
   * unable to say which of their hundred marks landed, and the Phase 9 POST
   * route writes its batch in a single `createMany` — so a per-record decision
   * could not be honoured by the statement that follows it anyway.
   *
   * RULES   : A candidate is matched to a lock only when it names BOTH a course
   *           and a section. See the module header for why records naming
   *           neither cannot be protected, and why that is a Phase 9 schema
   *           limitation rather than an omission here.
   *
   *           The semester is resolved from the section, because Attendance has
   *           no semester column. A section whose semester cannot be resolved
   *           matches no lock and is allowed through — the alternative, refusing
   *           on a failed lookup, would make an unrelated data problem present
   *           itself as a lock nobody took.
   *
   * THROWS  : 409 CONFLICT naming the course that refused, so a faculty member
   *           can act on it. Not 403: the caller's role is not the problem.
   *
   * DATABASE: at most two statements (section semesters, then locks), and none
   *           at all when no candidate names both a course and a section.
   *
   * COMPLEXITY: O(candidates x locks) in memory, where locks is bounded by the
   *           distinct pairs in this request rather than by the tenant's total.
   */
  async assertWritable(
    tenantId: string,
    candidates: readonly AttendanceWriteCandidate[]
  ): Promise<void> {
    const scoped = candidates.filter(
      (candidate): candidate is AttendanceWriteCandidate & { courseId: string; sectionId: string } =>
        candidate.courseId !== null && candidate.sectionId !== null
    );

    if (scoped.length === 0) return;

    const sectionIds = [...new Set(scoped.map((candidate) => candidate.sectionId))];
    const semesterBySection = new Map(
      (await this.units.findSectionSemesters(tenantId, sectionIds)).map((row) => [
        row.id,
        row.semesterId,
      ])
    );

    const pairs = [
      ...new Map(
        scoped.map((candidate) => [
          `${candidate.courseId} ${candidate.sectionId}`,
          { courseId: candidate.courseId, sectionId: candidate.sectionId },
        ])
      ).values(),
    ];

    const locks = await this.locks.findActiveLocksForUnits(tenantId, pairs);

    if (locks.length === 0) return;

    for (const candidate of scoped) {
      const semesterId = semesterBySection.get(candidate.sectionId);
      if (semesterId === undefined) continue;

      const relevant = locks.filter(
        (lock) =>
          lock.courseId === candidate.courseId &&
          lock.sectionId === candidate.sectionId &&
          lock.semesterId === semesterId
      );

      const blocking = findBlockingLock(relevant, candidate.date);

      if (blocking) {
        throw new AppError(
          `${ATTENDANCE_LOCK_MESSAGE.LOCKED} (${blocking.course?.code ?? blocking.courseId})`,
          HTTP_STATUS.CONFLICT,
          ERROR_CODE.CONFLICT
        );
      }
    }
  }

  /**
   * Confirm all three ids exist in this tenant.
   *
   * Issued concurrently — they are independent, and three sequential round
   * trips on the lock path would be three where one wait suffices. Precedence
   * on failure is fixed (course, then section, then semester) so a request with
   * two bad ids always reports the same one, rather than whichever query
   * happened to resolve first.
   */
  private async assertUnitExists(tenantId: string, unit: TeachingUnit): Promise<void> {
    const [course, section, semester] = await Promise.all([
      this.units.courseExists(tenantId, unit.courseId),
      this.units.sectionExists(tenantId, unit.sectionId),
      this.units.semesterExists(tenantId, unit.semesterId),
    ]);

    if (!course) {
      throw new AppError(
        ATTENDANCE_LOCK_MESSAGE.COURSE_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }

    if (!section) {
      throw new AppError(
        ATTENDANCE_LOCK_MESSAGE.SECTION_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }

    if (!semester) {
      throw new AppError(
        ATTENDANCE_LOCK_MESSAGE.SEMESTER_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }
  }
}

/**
 * The prior state an audit entry records as `before`.
 *
 * A named helper rather than an inline object literal in two places, so the
 * lock and unlock paths cannot drift into recording different shapes for the
 * same thing.
 */
function snapshotOf(row: {
  status: string;
  fromDate: Date | null;
  toDate: Date | null;
  reason: string | null;
}) {
  return {
    status: row.status,
    fromDate: row.fromDate?.toISOString() ?? null,
    toDate: row.toDate?.toISOString() ?? null,
    reason: row.reason,
  };
}
