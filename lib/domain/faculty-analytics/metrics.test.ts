// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Profile & Performance Analytics (Phase 23)
// LAYER  : Domain — Unit Tests
// PURPOSE: Pin every figure this phase reports, and pin the cases where it
//          reports NULL rather than a number. The null cases matter most: a
//          fabricated 0% attaches a failure to a faculty member who simply has
//          no data, and a dashboard sorted ascending puts them at the bottom of
//          a list they do not belong on.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  average,
  rate,
  summariseAttendance,
  summariseResults,
  summariseWorkload,
} from "@/lib/domain/faculty-analytics/metrics";

describe("rate", () => {
  it("returns a percentage rounded to one decimal", () => {
    assert.equal(rate(1, 3), 33.3);
    assert.equal(rate(2, 3), 66.7);
  });

  it("returns NULL for a zero denominator, never 0", () => {
    assert.equal(rate(0, 0), null);
    assert.equal(rate(5, 0), null);
  });

  it("returns null for a negative denominator", () => {
    assert.equal(rate(1, -1), null);
  });

  it("handles the exact ends of the scale", () => {
    assert.equal(rate(0, 10), 0);
    assert.equal(rate(10, 10), 100);
  });
});

describe("average", () => {
  it("returns NULL for an empty list, never 0", () => {
    assert.equal(average([]), null);
  });

  it("rounds to two decimals, matching the Decimal(6,2) marks columns", () => {
    assert.equal(average([1, 2, 2]), 1.67);
  });

  it("averages a single value to itself", () => {
    assert.equal(average([42.5]), 42.5);
  });
});

describe("summariseWorkload", () => {
  const assignment = (overrides = {}) => ({
    courseId: "c1",
    sectionId: "s1",
    semesterId: "sem1",
    isActive: true,
    ...overrides,
  });

  const slot = (overrides = {}) => ({
    courseId: "c1",
    sectionId: "s1",
    sessionType: "LECTURE",
    isActive: true,
    ...overrides,
  });

  it("counts courses and sections DISTINCTLY", () => {
    // One course taught to three sections is one course and three sections.
    const result = summariseWorkload(
      [
        assignment({ sectionId: "s1" }),
        assignment({ sectionId: "s2" }),
        assignment({ sectionId: "s3" }),
      ],
      []
    );

    assert.equal(result.courseCount, 1);
    assert.equal(result.sectionCount, 3);
  });

  it("EXCLUDES withdrawn assignments and inactive slots", () => {
    const result = summariseWorkload(
      [assignment(), assignment({ courseId: "c2", isActive: false })],
      [slot(), slot({ isActive: false })]
    );

    assert.equal(result.courseCount, 1);
    assert.equal(result.weeklySlotCount, 1);
  });

  it("does not count a null sectionId as a section", () => {
    const result = summariseWorkload([assignment({ sectionId: null })], []);
    assert.equal(result.sectionCount, 0);
  });

  it("breaks slots down by session type", () => {
    const result = summariseWorkload(
      [],
      [
        slot({ sessionType: "LECTURE" }),
        slot({ sessionType: "LECTURE" }),
        slot({ sessionType: "LAB" }),
      ]
    );

    assert.deepEqual(result.slotsBySessionType, { LECTURE: 2, LAB: 1 });
  });

  it("reports zeroes for a member with no load at all", () => {
    const result = summariseWorkload([], []);

    assert.equal(result.courseCount, 0);
    assert.equal(result.sectionCount, 0);
    assert.equal(result.weeklySlotCount, 0);
    assert.deepEqual(result.slotsBySessionType, {});
  });
});

describe("summariseAttendance", () => {
  const record = (status: string, studentId = "st1") => ({ status, studentId });

  it("counts LATE as present — a student who arrived late attended", () => {
    const result = summariseAttendance([record("PRESENT"), record("LATE")], false);

    assert.equal(result.presentCount, 2);
    assert.equal(result.presentRate, 100);
  });

  it("does NOT count EXCUSED as present", () => {
    // An authorised absence is still an absence; folding it in would make an
    // excused cohort indistinguishable from an attending one.
    const result = summariseAttendance([record("PRESENT"), record("EXCUSED")], false);

    assert.equal(result.presentCount, 1);
    assert.equal(result.presentRate, 50);
  });

  it("counts distinct students, not rows", () => {
    const result = summariseAttendance(
      [record("PRESENT", "a"), record("ABSENT", "a"), record("PRESENT", "b")],
      false
    );

    assert.equal(result.recordsMarked, 3);
    assert.equal(result.distinctStudents, 2);
  });

  it("reports a NULL rate for a member who has marked nothing", () => {
    const result = summariseAttendance([], false);

    assert.equal(result.recordsMarked, 0);
    assert.equal(result.presentRate, null);
  });

  it("carries the truncation flag through untouched", () => {
    assert.equal(summariseAttendance([record("PRESENT")], true).truncated, true);
  });
});

describe("summariseResults", () => {
  const result = (overrides = {}) => ({
    marksObtained: 60,
    maxMarks: 100,
    passMark: 40,
    ...overrides,
  });

  it("excludes unmarked results from the marked count", () => {
    const summary = summariseResults([result(), result({ marksObtained: null })], false);

    assert.equal(summary.resultsRecorded, 2);
    assert.equal(summary.resultsMarked, 1);
  });

  it("treats a mark EQUAL to the pass mark as a pass", () => {
    const summary = summariseResults([result({ marksObtained: 40, passMark: 40 })], false);

    assert.equal(summary.passCount, 1);
    assert.equal(summary.failCount, 0);
  });

  it("NORMALISES to a percentage before averaging across different scales", () => {
    // 18/20 and 90/100 are both 90%. Averaging the raw marks would give 54,
    // which describes the marking scales rather than the students.
    const summary = summariseResults(
      [
        result({ marksObtained: 18, maxMarks: 20 }),
        result({ marksObtained: 90, maxMarks: 100 }),
      ],
      false
    );

    assert.equal(summary.averagePercentage, 90);
  });

  it("reports a NULL pass rate when no examination defines a pass mark", () => {
    // Examination.passMark is nullable. A pass rate against an undefined
    // threshold is not computable and must not be invented.
    const summary = summariseResults([result({ passMark: null })], false);

    assert.equal(summary.passRate, null);
    assert.equal(summary.passCount, 0);
  });

  it("skips an examination with a non-positive maxMarks rather than dividing by zero", () => {
    // maxMarks is a plain Int with no positive constraint (the TD-005 family).
    const summary = summariseResults(
      [result({ marksObtained: 10, maxMarks: 0 }), result({ marksObtained: 50, maxMarks: 100 })],
      false
    );

    assert.equal(summary.averagePercentage, 50);
  });

  it("reports nulls throughout for a member with no results", () => {
    const summary = summariseResults([], false);

    assert.equal(summary.passRate, null);
    assert.equal(summary.averagePercentage, null);
    assert.equal(summary.resultsMarked, 0);
  });
});
