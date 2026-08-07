// ============================================================================
// OWNER  : Gauransh
// MODULE : Assignment Management Enhancement (Phase 24)
// LAYER  : Domain — Unit Tests
// PURPOSE: Pin the cohort arithmetic, the late-submission boundary, and every
//          case where a figure is NULL rather than zero.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeAssignmentStats,
  isLate,
  rate,
  rollUpAssignmentStats,
  type AssignmentFact,
  type SubmissionFact,
} from "@/lib/domain/assignment-analytics/metrics";

const submission = (overrides: Partial<SubmissionFact> = {}): SubmissionFact => ({
  studentId: "st1",
  status: "SUBMITTED",
  marks: null,
  submittedAt: new Date("2026-03-01T00:00:00.000Z"),
  ...overrides,
});

const assignment = (overrides: Partial<AssignmentFact> = {}): AssignmentFact => ({
  id: "a1",
  maxMarks: 100,
  dueDate: null,
  submissions: [],
  cohortSize: 0,
  ...overrides,
});

describe("rate", () => {
  it("returns NULL for a zero denominator, never 0", () => {
    assert.equal(rate(0, 0), null);
  });

  it("rounds to one decimal", () => {
    assert.equal(rate(1, 3), 33.3);
  });
});

describe("computeAssignmentStats", () => {
  it("derives pending from the COHORT, not from submission rows", () => {
    // A student with no submission row is pending and has no row to count.
    const stats = computeAssignmentStats(
      assignment({
        cohortSize: 30,
        submissions: [submission({ studentId: "a" }), submission({ studentId: "b" })],
      })
    );

    assert.equal(stats.submittedCount, 2);
    assert.equal(stats.pendingCount, 28);
  });

  it("FLOORS pending at zero when more submitted than were registered", () => {
    // An administrator may file for a student who was never registered.
    const stats = computeAssignmentStats(
      assignment({
        cohortSize: 1,
        submissions: [submission({ studentId: "a" }), submission({ studentId: "b" })],
      })
    );

    assert.equal(stats.pendingCount, 0);
  });

  it("does NOT count a PENDING row as submitted", () => {
    // PENDING is the column default and means the opposite.
    const stats = computeAssignmentStats(
      assignment({ cohortSize: 2, submissions: [submission({ status: "PENDING" })] })
    );

    assert.equal(stats.submittedCount, 0);
    assert.equal(stats.pendingCount, 2);
  });

  it("counts LATE and GRADED as submitted", () => {
    const stats = computeAssignmentStats(
      assignment({
        cohortSize: 3,
        submissions: [
          submission({ status: "LATE" }),
          submission({ status: "GRADED", marks: 70 }),
          submission({ status: "SUBMITTED" }),
        ],
      })
    );

    assert.equal(stats.submittedCount, 3);
    assert.equal(stats.lateCount, 1);
    assert.equal(stats.gradedCount, 1);
  });

  it("averages GRADED rows only — an ungraded row is not a zero", () => {
    // Treating a missing mark as zero would drag the mean down by exactly the
    // amount of work the faculty member has not yet done.
    const stats = computeAssignmentStats(
      assignment({
        cohortSize: 2,
        maxMarks: 100,
        submissions: [
          submission({ status: "GRADED", marks: 80 }),
          submission({ status: "SUBMITTED", marks: null }),
        ],
      })
    );

    assert.equal(stats.averagePercentage, 80);
  });

  it("reports NULL rates for an assignment with no cohort", () => {
    const stats = computeAssignmentStats(assignment({ cohortSize: 0 }));

    assert.equal(stats.submissionRate, null);
    assert.equal(stats.gradingProgress, null);
    assert.equal(stats.averagePercentage, null);
    assert.equal(stats.highestMarks, null);
    assert.equal(stats.lowestMarks, null);
  });

  it("expresses the average against maxMarks, not as a raw mark", () => {
    const stats = computeAssignmentStats(
      assignment({
        cohortSize: 1,
        maxMarks: 20,
        submissions: [submission({ status: "GRADED", marks: 15 })],
      })
    );

    assert.equal(stats.averagePercentage, 75);
  });

  it("skips the average when maxMarks is not positive rather than dividing by zero", () => {
    const stats = computeAssignmentStats(
      assignment({
        cohortSize: 1,
        maxMarks: 0,
        submissions: [submission({ status: "GRADED", marks: 15 })],
      })
    );

    assert.equal(stats.averagePercentage, null);
    // The mark itself is still reported.
    assert.equal(stats.highestMarks, 15);
  });

  it("reports the mark extremes over graded rows", () => {
    const stats = computeAssignmentStats(
      assignment({
        cohortSize: 3,
        submissions: [
          submission({ status: "GRADED", marks: 40 }),
          submission({ status: "GRADED", marks: 90 }),
          submission({ status: "GRADED", marks: 65 }),
        ],
      })
    );

    assert.equal(stats.highestMarks, 90);
    assert.equal(stats.lowestMarks, 40);
  });
});

describe("rollUpAssignmentStats", () => {
  it("RECOMPUTES rates from totals rather than averaging percentages", () => {
    // Averaging per-assignment rates would weight a 2-student assignment the
    // same as a 100-student one, so the headline would describe the number of
    // assignments rather than the number of students.
    const small = computeAssignmentStats(
      assignment({ id: "a1", cohortSize: 2, submissions: [submission(), submission()] })
    );
    const large = computeAssignmentStats(
      assignment({ id: "a2", cohortSize: 100, submissions: [] })
    );

    const totals = rollUpAssignmentStats([small, large], false);

    // 2 of 102 submitted, not the (100% + 0%) / 2 = 50% an average would give.
    assert.equal(totals.submittedTotal, 2);
    assert.equal(totals.cohortTotal, 102);
    assert.equal(totals.overallSubmissionRate, 2);
  });

  it("reports nulls for an empty set", () => {
    const totals = rollUpAssignmentStats([], false);

    assert.equal(totals.assignmentCount, 0);
    assert.equal(totals.overallSubmissionRate, null);
    assert.equal(totals.overallGradingProgress, null);
  });

  it("carries the truncation flag through", () => {
    assert.equal(rollUpAssignmentStats([], true).truncated, true);
  });
});

describe("isLate", () => {
  const due = new Date("2026-03-15T23:59:00.000Z");

  it("is never late when the assignment has NO due date", () => {
    // The absence of a deadline is not a deadline of the epoch.
    assert.equal(isLate(null, new Date("2099-01-01T00:00:00.000Z")), false);
  });

  it("is ON TIME at the exact deadline instant", () => {
    assert.equal(isLate(due, new Date(due.getTime())), false);
  });

  it("is late one millisecond after", () => {
    assert.equal(isLate(due, new Date(due.getTime() + 1)), true);
  });

  it("is on time before the deadline", () => {
    assert.equal(isLate(due, new Date(due.getTime() - 1000)), false);
  });
});
