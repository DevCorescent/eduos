// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Lock & Audit System (Phase 22)
// LAYER  : Domain — Unit Tests
// PURPOSE: Pin the boundary semantics of a lock window, because every one of
//          them is a case where a legal academic record is either protected or
//          silently editable.
//
//          Pure functions over plain values — no database, no environment.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AttendanceLockStatus } from "@/app/generated/prisma/enums";
import {
  findBlockingLock,
  isWindowOrdered,
  isWriteBlocked,
  toUtcDay,
  windowCoversDate,
} from "@/lib/domain/attendance-lock/lockWindow";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("windowCoversDate", () => {
  it("covers everything when both bounds are null (the Semester Lock case)", () => {
    const window = { fromDate: null, toDate: null };

    assert.equal(windowCoversDate(window, day("1999-01-01")), true);
    assert.equal(windowCoversDate(window, day("2026-08-07")), true);
    assert.equal(windowCoversDate(window, day("2099-12-31")), true);
  });

  it("INCLUDES both endpoints", () => {
    // A lock stated as 1st-31st must cover the 31st. A half-open interval would
    // leave the final day of a "locked" month editable.
    const window = { fromDate: day("2026-03-01"), toDate: day("2026-03-31") };

    assert.equal(windowCoversDate(window, day("2026-03-01")), true);
    assert.equal(windowCoversDate(window, day("2026-03-31")), true);
  });

  it("excludes the days either side of the window", () => {
    const window = { fromDate: day("2026-03-01"), toDate: day("2026-03-31") };

    assert.equal(windowCoversDate(window, day("2026-02-28")), false);
    assert.equal(windowCoversDate(window, day("2026-04-01")), false);
  });

  it("treats a null fromDate as unbounded below", () => {
    const window = { fromDate: null, toDate: day("2026-03-31") };

    assert.equal(windowCoversDate(window, day("1999-01-01")), true);
    assert.equal(windowCoversDate(window, day("2026-04-01")), false);
  });

  it("treats a null toDate as unbounded above", () => {
    const window = { fromDate: day("2026-03-01"), toDate: null };

    assert.equal(windowCoversDate(window, day("2026-02-28")), false);
    assert.equal(windowCoversDate(window, day("2099-12-31")), true);
  });

  it("compares whole days, so a time component cannot cross a boundary", () => {
    // Attendance.date is @db.Date, but a caller may pass a timestamped clock
    // read. Late on the last covered day must still be covered.
    const window = { fromDate: day("2026-03-01"), toDate: day("2026-03-31") };

    assert.equal(
      windowCoversDate(window, new Date("2026-03-31T23:59:59.999Z")),
      true
    );
    assert.equal(
      windowCoversDate(window, new Date("2026-04-01T00:00:00.001Z")),
      false
    );
  });

  it("covers a single-day window", () => {
    const window = { fromDate: day("2026-03-15"), toDate: day("2026-03-15") };

    assert.equal(windowCoversDate(window, day("2026-03-15")), true);
    assert.equal(windowCoversDate(window, day("2026-03-14")), false);
    assert.equal(windowCoversDate(window, day("2026-03-16")), false);
  });
});

describe("toUtcDay", () => {
  it("strips the time component without shifting the date", () => {
    assert.equal(
      toUtcDay(new Date("2026-03-15T18:45:12.345Z")).toISOString(),
      "2026-03-15T00:00:00.000Z"
    );
  });

  it("is idempotent", () => {
    const once = toUtcDay(day("2026-03-15"));
    assert.equal(toUtcDay(once).getTime(), once.getTime());
  });
});

describe("isWriteBlocked", () => {
  it("blocks when LOCKED and the window covers the date", () => {
    const lock = {
      status: AttendanceLockStatus.LOCKED,
      fromDate: null,
      toDate: null,
    };

    assert.equal(isWriteBlocked(lock, day("2026-03-15")), true);
  });

  it("does NOT block an UNLOCKED row, however wide its window", () => {
    // A released lock is retained for its history and must refuse nothing.
    const lock = {
      status: AttendanceLockStatus.UNLOCKED,
      fromDate: null,
      toDate: null,
    };

    assert.equal(isWriteBlocked(lock, day("2026-03-15")), false);
  });

  it("does not block a LOCKED row whose window misses the date", () => {
    const lock = {
      status: AttendanceLockStatus.LOCKED,
      fromDate: day("2026-03-01"),
      toDate: day("2026-03-31"),
    };

    assert.equal(isWriteBlocked(lock, day("2026-04-01")), false);
  });
});

describe("findBlockingLock", () => {
  const covering = {
    id: "lock_covering",
    status: AttendanceLockStatus.LOCKED,
    fromDate: null,
    toDate: null,
  };
  const released = {
    id: "lock_released",
    status: AttendanceLockStatus.UNLOCKED,
    fromDate: null,
    toDate: null,
  };
  const elsewhere = {
    id: "lock_elsewhere",
    status: AttendanceLockStatus.LOCKED,
    fromDate: day("2020-01-01"),
    toDate: day("2020-12-31"),
  };

  it("returns null when nothing blocks", () => {
    assert.equal(findBlockingLock([released, elsewhere], day("2026-03-15")), null);
  });

  it("returns the lock itself, so a caller can name what refused", () => {
    const found = findBlockingLock([released, covering], day("2026-03-15"));
    assert.equal(found?.id, "lock_covering");
  });

  it("returns null for an empty list", () => {
    assert.equal(findBlockingLock([], day("2026-03-15")), null);
  });
});

describe("isWindowOrdered", () => {
  it("accepts an ordered window", () => {
    assert.equal(
      isWindowOrdered({ fromDate: day("2026-03-01"), toDate: day("2026-03-31") }),
      true
    );
  });

  it("accepts an equal pair — a single-day freeze", () => {
    assert.equal(
      isWindowOrdered({ fromDate: day("2026-03-15"), toDate: day("2026-03-15") }),
      true
    );
  });

  it("rejects a reversed window", () => {
    assert.equal(
      isWindowOrdered({ fromDate: day("2026-03-31"), toDate: day("2026-03-01") }),
      false
    );
  });

  it("accepts any half-open window, since one side asserts nothing", () => {
    assert.equal(isWindowOrdered({ fromDate: day("2026-03-01"), toDate: null }), true);
    assert.equal(isWindowOrdered({ fromDate: null, toDate: day("2026-03-01") }), true);
    assert.equal(isWindowOrdered({ fromDate: null, toDate: null }), true);
  });
});
