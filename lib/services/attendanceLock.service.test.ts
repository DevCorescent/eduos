// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Lock & Audit System (Phase 22)
// LAYER  : Service — Unit Tests
// PURPOSE: Prove the rules that make this phase a security property rather than
//          a flag: that a held lock refuses an attendance write, that a released
//          one does not, that every transition is audited inside the same
//          transaction as the change, and that the enforcement path costs one
//          read for a batch of any size.
//
//          The service depends on a repository TYPE and two narrow PORTS, so
//          all of this runs with no database and no environment. The fakes
//          record what they were asked, which is how the query budget is TESTED
//          rather than asserted in a comment.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AppError } from "@/lib/errors/AppError";
import { AttendanceLockStatus } from "@/app/generated/prisma/enums";
import { ATTENDANCE_LOCK_ACTION } from "@/lib/constants/attendanceLock";
import {
  AttendanceLockService,
  type TeachingUnitPort,
} from "@/lib/services/attendanceLock.service";
import type { AttendanceLockRepositoryPort } from "@/lib/repositories/attendanceLock.repository";
import type { AuditLogRepositoryPort } from "@/lib/repositories/auditLog.repository";

const TENANT_ID = "tenant_1";
const USER_ID = "user_1";
const COURSE_ID = "course_1";
const SECTION_ID = "section_1";
const SEMESTER_ID = "semester_1";
const NOW = new Date("2026-08-07T10:00:00.000Z");

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const CONTEXT = { userId: USER_ID, ipAddress: "203.0.113.7", userAgent: "test" };

const UNIT = { courseId: COURSE_ID, sectionId: SECTION_ID, semesterId: SEMESTER_ID };

// --- Fakes ------------------------------------------------------------------

function lockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "lock_1",
    tenantId: TENANT_ID,
    courseId: COURSE_ID,
    sectionId: SECTION_ID,
    semesterId: SEMESTER_ID,
    status: AttendanceLockStatus.LOCKED,
    fromDate: null,
    toDate: null,
    reason: null,
    lockedAt: NOW,
    unlockedAt: null,
    unlockReason: null,
    course: { code: "CS301", name: "Algorithms" },
    section: { name: "A" },
    semester: { name: "Sem 5" },
    lockedBy: null,
    unlockedBy: null,
    ...overrides,
  };
}

interface FakeState {
  existing: ReturnType<typeof lockRow> | null;
  activeLocks: Array<Record<string, unknown>>;
  /** Which of the three existence checks should answer false. */
  units: Partial<Record<"courseExists" | "sectionExists" | "semesterExists", boolean>>;
}

function makeHarness(state: Partial<FakeState> = {}) {
  const resolved: FakeState = {
    existing: state.existing ?? null,
    activeLocks: state.activeLocks ?? [],
    units: state.units ?? {},
  };

  const calls = {
    findActiveLocksForUnits: 0,
    findSectionSemesters: 0,
    lock: 0,
    unlock: 0,
    audit: [] as Array<{ action: string; after: unknown; before: unknown }>,
    transactions: 0,
    auditInsideTransaction: 0,
  };

  let insideTransaction = false;

  const locks = {
    async findByUnit() {
      return resolved.existing;
    },
    async findActiveLocksForUnits(_tenantId: string, pairs: readonly unknown[]) {
      calls.findActiveLocksForUnits += 1;
      if (pairs.length === 0) return [];
      return resolved.activeLocks;
    },
    async findMany() {
      return resolved.existing ? [resolved.existing] : [];
    },
    async lock(input: { lockedAt: Date; fromDate: Date | null; toDate: Date | null }) {
      calls.lock += 1;
      return lockRow({
        status: AttendanceLockStatus.LOCKED,
        fromDate: input.fromDate,
        toDate: input.toDate,
        lockedAt: input.lockedAt,
      });
    },
    async unlock(input: { unlockedAt: Date; unlockReason: string }) {
      calls.unlock += 1;
      return lockRow({
        status: AttendanceLockStatus.UNLOCKED,
        unlockedAt: input.unlockedAt,
        unlockReason: input.unlockReason,
      });
    },
    async findAudit() {
      return { rows: [], total: 0 };
    },
    async transaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      calls.transactions += 1;
      insideTransaction = true;
      try {
        return await fn(undefined as never);
      } finally {
        insideTransaction = false;
      }
    },
  } as unknown as AttendanceLockRepositoryPort;

  const auditLog: AuditLogRepositoryPort = {
    async record(entry) {
      calls.audit.push({ action: entry.action, after: entry.after, before: entry.before });
      if (insideTransaction) calls.auditInsideTransaction += 1;
    },
  };

  const units: TeachingUnitPort = {
    async courseExists() {
      return resolved.units.courseExists ?? true;
    },
    async sectionExists() {
      return resolved.units.sectionExists ?? true;
    },
    async semesterExists() {
      return resolved.units.semesterExists ?? true;
    },
    async findSectionSemesters(_tenantId, sectionIds) {
      calls.findSectionSemesters += 1;
      return sectionIds.map((id) => ({ id, semesterId: SEMESTER_ID }));
    },
  };

  return {
    service: new AttendanceLockService(locks, auditLog, units),
    calls,
    resolved,
  };
}

// --- lock -------------------------------------------------------------------

describe("AttendanceLockService.lock", () => {
  it("locks a unit that has never been locked", async () => {
    const { service, calls } = makeHarness();

    const result = await service.lock(TENANT_ID, UNIT, CONTEXT, NOW);

    assert.equal(result.status, AttendanceLockStatus.LOCKED);
    assert.equal(calls.lock, 1);
  });

  it("REFUSES a unit that is already locked", async () => {
    // A second lock would silently replace the first one's window and actor.
    const { service } = makeHarness({ existing: lockRow() });

    await assert.rejects(
      () => service.lock(TENANT_ID, UNIT, CONTEXT, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, "CONFLICT");
        return true;
      }
    );
  });

  it("allows re-locking a unit that was released", async () => {
    const { service, calls } = makeHarness({
      existing: lockRow({ status: AttendanceLockStatus.UNLOCKED }),
    });

    await service.lock(TENANT_ID, UNIT, CONTEXT, NOW);

    assert.equal(calls.lock, 1);
    // The prior released state travels as `before`, so the history explains
    // what changed rather than only what resulted.
    assert.notEqual(calls.audit[0]?.before, undefined);
  });

  it("writes the audit entry INSIDE the same transaction as the lock", async () => {
    // An audit entry that survives a rollback reports a finalisation that never
    // happened — worse than no audit, because it is confidently wrong.
    const { service, calls } = makeHarness();

    await service.lock(TENANT_ID, UNIT, CONTEXT, NOW);

    assert.equal(calls.transactions, 1);
    assert.equal(calls.audit.length, 1);
    assert.equal(calls.auditInsideTransaction, 1);
    assert.equal(calls.audit[0]?.action, ATTENDANCE_LOCK_ACTION.LOCK);
  });

  it("records the unit ids in the audit snapshot, so the audit view can filter", async () => {
    // AuditLog has no course/section/semester column. The snapshot is the only
    // place that information can live.
    const { service, calls } = makeHarness();

    await service.lock(TENANT_ID, UNIT, CONTEXT, NOW);

    const after = calls.audit[0]?.after as Record<string, unknown>;
    assert.equal(after.courseId, COURSE_ID);
    assert.equal(after.sectionId, SECTION_ID);
    assert.equal(after.semesterId, SEMESTER_ID);
  });

  it("404s on an unknown course, naming which reference was wrong", async () => {
    // A caller with two bad ids must learn WHICH is wrong, not receive one
    // undifferentiated 404, so precedence is fixed at course-then-section-then-
    // semester rather than left to whichever concurrent query resolved first.
    const { service } = makeHarness({ units: { courseExists: false } });

    await assert.rejects(
      () => service.lock(TENANT_ID, UNIT, CONTEXT, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        assert.match(err.message, /Course/);
        return true;
      }
    );
  });

  it("404s on an unknown section", async () => {
    const { service } = makeHarness({ units: { sectionExists: false } });

    await assert.rejects(
      () => service.lock(TENANT_ID, UNIT, CONTEXT, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.match(err.message, /Section/);
        return true;
      }
    );
  });

  it("404s on an unknown semester", async () => {
    const { service } = makeHarness({ units: { semesterExists: false } });

    await assert.rejects(
      () => service.lock(TENANT_ID, UNIT, CONTEXT, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.match(err.message, /Semester/);
        return true;
      }
    );
  });
});

// --- unlock -----------------------------------------------------------------

describe("AttendanceLockService.unlock", () => {
  const input = { ...UNIT, reason: "Correction approved by HOD" };

  it("releases a held lock and records the reason", async () => {
    const { service, calls } = makeHarness({ existing: lockRow() });

    const result = await service.unlock(TENANT_ID, input, CONTEXT, NOW);

    assert.equal(result.status, AttendanceLockStatus.UNLOCKED);
    assert.equal(result.unlockReason, "Correction approved by HOD");
    assert.equal(calls.unlock, 1);
  });

  it("404s when the unit was never locked", async () => {
    const { service } = makeHarness({ existing: null });

    await assert.rejects(
      () => service.unlock(TENANT_ID, input, CONTEXT, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  it("409s when the lock is already released — a DIFFERENT answer from 404", async () => {
    // "Already unlocked" is actionable; "not found" would send an HOD looking
    // for a typo that is not there.
    const { service } = makeHarness({
      existing: lockRow({ status: AttendanceLockStatus.UNLOCKED }),
    });

    await assert.rejects(
      () => service.unlock(TENANT_ID, input, CONTEXT, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 409);
        return true;
      }
    );
  });

  it("writes the audit entry INSIDE the transaction, carrying the prior state", async () => {
    const { service, calls } = makeHarness({ existing: lockRow() });

    await service.unlock(TENANT_ID, input, CONTEXT, NOW);

    assert.equal(calls.transactions, 1);
    assert.equal(calls.auditInsideTransaction, 1);
    assert.equal(calls.audit[0]?.action, ATTENDANCE_LOCK_ACTION.UNLOCK);
    assert.notEqual(calls.audit[0]?.before, undefined);
  });
});

// --- assertWritable: the enforcement path -----------------------------------

describe("AttendanceLockService.assertWritable", () => {
  const activeLock = {
    id: "lock_1",
    courseId: COURSE_ID,
    sectionId: SECTION_ID,
    semesterId: SEMESTER_ID,
    status: AttendanceLockStatus.LOCKED,
    fromDate: null,
    toDate: null,
    course: { code: "CS301" },
  };

  it("REFUSES a write covered by a held lock", async () => {
    const { service } = makeHarness({ activeLocks: [activeLock] });

    await assert.rejects(
      () =>
        service.assertWritable(TENANT_ID, [
          { courseId: COURSE_ID, sectionId: SECTION_ID, date: day("2026-03-15") },
        ]),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        // 409, not 403: the caller's role is not the problem. The same faculty
        // member could write this yesterday and will again after an unlock.
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, "CONFLICT");
        // The course is named, so the refusal is actionable.
        assert.match(err.message, /CS301/);
        return true;
      }
    );
  });

  it("allows a write when the lock has been RELEASED", async () => {
    const { service } = makeHarness({
      activeLocks: [{ ...activeLock, status: AttendanceLockStatus.UNLOCKED }],
    });

    await service.assertWritable(TENANT_ID, [
      { courseId: COURSE_ID, sectionId: SECTION_ID, date: day("2026-03-15") },
    ]);
  });

  it("allows a write outside the frozen window", async () => {
    const { service } = makeHarness({
      activeLocks: [{ ...activeLock, fromDate: day("2026-03-01"), toDate: day("2026-03-31") }],
    });

    await service.assertWritable(TENANT_ID, [
      { courseId: COURSE_ID, sectionId: SECTION_ID, date: day("2026-04-01") },
    ]);
  });

  it("refuses on the LAST day of the window — the boundary is inclusive", async () => {
    const { service } = makeHarness({
      activeLocks: [{ ...activeLock, fromDate: day("2026-03-01"), toDate: day("2026-03-31") }],
    });

    await assert.rejects(() =>
      service.assertWritable(TENANT_ID, [
        { courseId: COURSE_ID, sectionId: SECTION_ID, date: day("2026-03-31") },
      ])
    );
  });

  it("does not match a lock belonging to a DIFFERENT section", async () => {
    const { service } = makeHarness({
      activeLocks: [{ ...activeLock, sectionId: "section_other" }],
    });

    await service.assertWritable(TENANT_ID, [
      { courseId: COURSE_ID, sectionId: SECTION_ID, date: day("2026-03-15") },
    ]);
  });

  it("performs NO query when no record names both a course and a section", async () => {
    // The documented gap: such a record belongs to no teaching unit a lock can
    // name. It must pass through, and it must not cost a read to do so.
    const { service, calls } = makeHarness({ activeLocks: [activeLock] });

    await service.assertWritable(TENANT_ID, [
      { courseId: null, sectionId: SECTION_ID, date: day("2026-03-15") },
      { courseId: COURSE_ID, sectionId: null, date: day("2026-03-15") },
      { courseId: null, sectionId: null, date: day("2026-03-15") },
    ]);

    assert.equal(calls.findActiveLocksForUnits, 0);
    assert.equal(calls.findSectionSemesters, 0);
  });

  it("costs ONE lock read for a batch of any size", async () => {
    // This sits on the attendance write path. An N+1 here would make a
    // hundred-row register a hundred round trips.
    const { service, calls } = makeHarness({ activeLocks: [] });

    const batch = Array.from({ length: 100 }, (_, index) => ({
      courseId: COURSE_ID,
      sectionId: SECTION_ID,
      date: day(`2026-03-${String((index % 28) + 1).padStart(2, "0")}`),
    }));

    await service.assertWritable(TENANT_ID, batch);

    assert.equal(calls.findActiveLocksForUnits, 1);
    assert.equal(calls.findSectionSemesters, 1);
  });

  it("returns silently for an empty batch, querying nothing", async () => {
    const { service, calls } = makeHarness({ activeLocks: [activeLock] });

    await service.assertWritable(TENANT_ID, []);

    assert.equal(calls.findActiveLocksForUnits, 0);
  });

  it("refuses the WHOLE batch when any one record is locked", async () => {
    // The Phase 9 route writes its batch in a single createMany, so a per-record
    // decision could not be honoured by the statement that follows it.
    const { service } = makeHarness({
      activeLocks: [{ ...activeLock, fromDate: day("2026-03-01"), toDate: day("2026-03-31") }],
    });

    await assert.rejects(() =>
      service.assertWritable(TENANT_ID, [
        { courseId: COURSE_ID, sectionId: SECTION_ID, date: day("2026-04-10") },
        { courseId: COURSE_ID, sectionId: SECTION_ID, date: day("2026-03-15") },
      ])
    );
  });
});
