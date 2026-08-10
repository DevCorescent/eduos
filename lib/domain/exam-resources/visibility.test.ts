// ============================================================================
// OWNER  : Gauransh
// MODULE : Question Paper & Solution Repository (Phase 26)
// LAYER  : Domain — Unit Tests
// PURPOSE: Pin the visibility predicate. Every case below is one where getting
//          it wrong either serves a student an unpublished answer key or hides
//          material a faculty member deliberately released.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ExamResourceStatus } from "@/app/generated/prisma/enums";
import {
  isScheduleElapsed,
  isVisibleToStudent,
  pendingReason,
} from "@/lib/domain/exam-resources/visibility";

const NOW = new Date("2026-05-10T09:00:00.000Z");

const published = (scheduledPublishAt: Date | null = null) => ({
  status: ExamResourceStatus.PUBLISHED,
  scheduledPublishAt,
});

describe("isScheduleElapsed", () => {
  it("treats a NULL schedule as already elapsed", () => {
    // The absence of a schedule is not a schedule at the end of time.
    assert.equal(isScheduleElapsed(published(null), NOW), true);
  });

  it("is elapsed AT the scheduled instant, not one millisecond after", () => {
    // A student refreshing on the hour must see it.
    assert.equal(isScheduleElapsed(published(new Date(NOW)), NOW), true);
  });

  it("is not elapsed one millisecond before", () => {
    assert.equal(
      isScheduleElapsed(published(new Date(NOW.getTime() + 1)), NOW),
      false
    );
  });

  it("is elapsed for a past schedule", () => {
    assert.equal(
      isScheduleElapsed(published(new Date("2020-01-01T00:00:00.000Z")), NOW),
      true
    );
  });
});

describe("isVisibleToStudent", () => {
  it("shows a PUBLISHED resource with no schedule", () => {
    assert.equal(isVisibleToStudent(published(null), NOW), true);
  });

  it("HIDES a DRAFT, however its schedule reads", () => {
    // Draft Mode must never leak an unfinished answer key.
    assert.equal(
      isVisibleToStudent(
        { status: ExamResourceStatus.DRAFT, scheduledPublishAt: null },
        NOW
      ),
      false
    );
  });

  it("HIDES an ARCHIVED resource", () => {
    assert.equal(
      isVisibleToStudent(
        { status: ExamResourceStatus.ARCHIVED, scheduledPublishAt: null },
        NOW
      ),
      false
    );
  });

  it("HIDES a PUBLISHED resource whose schedule has not arrived", () => {
    // The state that only exists because publication is evaluated on read.
    assert.equal(
      isVisibleToStudent(published(new Date("2026-06-01T00:00:00.000Z")), NOW),
      false
    );
  });

  it("shows a PUBLISHED resource once its schedule has passed", () => {
    assert.equal(
      isVisibleToStudent(published(new Date("2026-05-01T00:00:00.000Z")), NOW),
      true
    );
  });
});

describe("pendingReason", () => {
  it("returns null for a visible resource", () => {
    assert.equal(pendingReason(published(null), NOW), null);
  });

  it("names DRAFT", () => {
    assert.equal(
      pendingReason({ status: ExamResourceStatus.DRAFT, scheduledPublishAt: null }, NOW),
      "DRAFT"
    );
  });

  it("names ARCHIVED", () => {
    assert.equal(
      pendingReason({ status: ExamResourceStatus.ARCHIVED, scheduledPublishAt: null }, NOW),
      "ARCHIVED"
    );
  });

  it("names SCHEDULED for a published-but-not-yet-due resource", () => {
    assert.equal(
      pendingReason(published(new Date("2026-06-01T00:00:00.000Z")), NOW),
      "SCHEDULED"
    );
  });

  it("prefers the status reason over the schedule reason", () => {
    // A draft with a future schedule is a draft; reporting SCHEDULED would
    // suggest it is on its way out when it has not been released at all.
    assert.equal(
      pendingReason(
        {
          status: ExamResourceStatus.DRAFT,
          scheduledPublishAt: new Date("2026-06-01T00:00:00.000Z"),
        },
        NOW
      ),
      "DRAFT"
    );
  });
});
