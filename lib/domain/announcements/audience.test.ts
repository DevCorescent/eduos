// ============================================================================
// OWNER  : Gauransh
// MODULE : Notification Center & Announcement System (Phase 27)
// LAYER  : Domain — Unit Tests
// PURPOSE: Pin the audience invariant the schema cannot express, and the
//          scheduling boundaries.
//
//          The dangerous case is an INSTITUTION announcement carrying a
//          batchId: the target is silently ignored, so an author believes they
//          narrowed the audience when they broadcast to the whole university.
//          A check that only looked for MISSING targets would miss it.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AnnouncementAudience,
  AnnouncementStatus,
} from "@/app/generated/prisma/enums";
import {
  isAudienceConsistent,
  isLive,
  reaches,
  requiredTargetFor,
} from "@/lib/domain/announcements/audience";

const NOW = new Date("2026-06-01T12:00:00.000Z");

const target = (overrides = {}) => ({
  audience: AnnouncementAudience.INSTITUTION,
  departmentId: null,
  batchId: null,
  sectionId: null,
  ...overrides,
});

describe("isAudienceConsistent", () => {
  it("accepts INSTITUTION with no target", () => {
    assert.equal(isAudienceConsistent(target()), true);
  });

  it("REJECTS INSTITUTION carrying a target that would be silently ignored", () => {
    // The dangerous case: the author thinks they narrowed the audience.
    assert.equal(
      isAudienceConsistent(
        target({ audience: AnnouncementAudience.INSTITUTION, batchId: "batch_1" })
      ),
      false
    );
  });

  it("accepts DEPARTMENT with a departmentId", () => {
    assert.equal(
      isAudienceConsistent(
        target({ audience: AnnouncementAudience.DEPARTMENT, departmentId: "dept_1" })
      ),
      true
    );
  });

  it("REJECTS DEPARTMENT with no departmentId — addressed to nobody", () => {
    assert.equal(
      isAudienceConsistent(target({ audience: AnnouncementAudience.DEPARTMENT })),
      false
    );
  });

  it("REJECTS DEPARTMENT carrying the WRONG target", () => {
    assert.equal(
      isAudienceConsistent(
        target({ audience: AnnouncementAudience.DEPARTMENT, batchId: "batch_1" })
      ),
      false
    );
  });

  it("REJECTS two targets at once", () => {
    assert.equal(
      isAudienceConsistent(
        target({
          audience: AnnouncementAudience.DEPARTMENT,
          departmentId: "dept_1",
          batchId: "batch_1",
        })
      ),
      false
    );
  });

  it("accepts BATCH and SECTION with their own targets", () => {
    assert.equal(
      isAudienceConsistent(
        target({ audience: AnnouncementAudience.BATCH, batchId: "batch_1" })
      ),
      true
    );
    assert.equal(
      isAudienceConsistent(
        target({ audience: AnnouncementAudience.SECTION, sectionId: "sec_1" })
      ),
      true
    );
  });
});

describe("requiredTargetFor", () => {
  it("names the column each audience needs", () => {
    assert.equal(requiredTargetFor(AnnouncementAudience.INSTITUTION), null);
    assert.equal(requiredTargetFor(AnnouncementAudience.DEPARTMENT), "departmentId");
    assert.equal(requiredTargetFor(AnnouncementAudience.BATCH), "batchId");
    assert.equal(requiredTargetFor(AnnouncementAudience.SECTION), "sectionId");
  });
});

describe("isLive", () => {
  const live = {
    status: AnnouncementStatus.PUBLISHED,
    publishAt: null as Date | null,
    expiresAt: null as Date | null,
  };

  it("is live when PUBLISHED with no schedule and no expiry", () => {
    assert.equal(isLive(live, NOW), true);
  });

  it("is NOT live while a DRAFT", () => {
    assert.equal(isLive({ ...live, status: AnnouncementStatus.DRAFT }, NOW), false);
  });

  it("is NOT live once ARCHIVED", () => {
    assert.equal(isLive({ ...live, status: AnnouncementStatus.ARCHIVED }, NOW), false);
  });

  it("is live AT the scheduled instant — the boundary is inclusive", () => {
    assert.equal(isLive({ ...live, publishAt: new Date(NOW) }, NOW), true);
  });

  it("is not live one millisecond before the scheduled instant", () => {
    assert.equal(
      isLive({ ...live, publishAt: new Date(NOW.getTime() + 1) }, NOW),
      false
    );
  });

  it("is NOT live at the expiry instant — the boundary is exclusive", () => {
    // "from 9 until 5" means not at 5.
    assert.equal(isLive({ ...live, expiresAt: new Date(NOW) }, NOW), false);
  });

  it("is live one millisecond before expiry", () => {
    assert.equal(
      isLive({ ...live, expiresAt: new Date(NOW.getTime() + 1) }, NOW),
      true
    );
  });

  it("respects both bounds together", () => {
    const window = {
      ...live,
      publishAt: new Date("2026-06-01T09:00:00.000Z"),
      expiresAt: new Date("2026-06-01T17:00:00.000Z"),
    };

    assert.equal(isLive(window, new Date("2026-06-01T08:59:59.999Z")), false);
    assert.equal(isLive(window, new Date("2026-06-01T09:00:00.000Z")), true);
    assert.equal(isLive(window, new Date("2026-06-01T16:59:59.999Z")), true);
    assert.equal(isLive(window, new Date("2026-06-01T17:00:00.000Z")), false);
  });
});

describe("reaches", () => {
  const reader = { departmentId: "dept_1", batchId: "batch_1", sectionId: "sec_1" };

  it("reaches everyone for an INSTITUTION announcement", () => {
    assert.equal(
      reaches(target(), { departmentId: null, batchId: null, sectionId: null }),
      true
    );
  });

  it("reaches a matching department", () => {
    assert.equal(
      reaches(
        target({ audience: AnnouncementAudience.DEPARTMENT, departmentId: "dept_1" }),
        reader
      ),
      true
    );
  });

  it("does not reach a different department", () => {
    assert.equal(
      reaches(
        target({ audience: AnnouncementAudience.DEPARTMENT, departmentId: "dept_9" }),
        reader
      ),
      false
    );
  });

  it("does NOT reach a reader whose scope is null for that dimension", () => {
    // Treating "unknown" as "all" is how a section-scoped message reaches the
    // whole university.
    assert.equal(
      reaches(
        target({ audience: AnnouncementAudience.SECTION, sectionId: "sec_1" }),
        { departmentId: null, batchId: null, sectionId: null }
      ),
      false
    );
  });

  it("matches batch and section independently", () => {
    assert.equal(
      reaches(target({ audience: AnnouncementAudience.BATCH, batchId: "batch_1" }), reader),
      true
    );
    assert.equal(
      reaches(target({ audience: AnnouncementAudience.SECTION, sectionId: "sec_9" }), reader),
      false
    );
  });
});
