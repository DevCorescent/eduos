// ============================================================================
// TESTS: what counts as "attended".
//
// These pin a PRODUCT decision, not an implementation detail. The codebase
// previously held both answers at once and issued contradictory statements
// about the same student, so the point of these tests is that the next person
// to change the rule has to change it here, deliberately, in one place.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAttended, tallyAttendance } from "./attended";

describe("isAttended", () => {
  it("counts a student who was in the room", () => {
    assert.equal(isAttended("PRESENT"), true);
  });

  it("counts a late arrival — they attended", () => {
    assert.equal(isAttended("LATE"), true);
  });

  it("does NOT count an unauthorised absence", () => {
    assert.equal(isAttended("ABSENT"), false);
  });

  it("COUNTS an excused absence", () => {
    // The decision this module exists to settle. EXCUSED is how the schema
    // records an authorised absence; holding it against the student at the
    // attendance floor detains exactly the people the exemption protects.
    assert.equal(isAttended("EXCUSED"), true);
  });

  it("a status nobody has defined yet counts, rather than silently detaining", () => {
    // Written as `!== ABSENT` on purpose: if a fifth status is added to the
    // enum, students do not drop below the floor the day it ships. Excluding a
    // new status has to be a decision somebody makes here.
    assert.equal(isAttended("ON_DUTY"), true);
  });
});

describe("tallyAttendance", () => {
  it("counts every session as held, EXCUSED included", () => {
    // Forgiving an absence and erasing the class are different things. Dropping
    // EXCUSED from the denominator would improve the rate rather than forgive.
    const { held, attended } = tallyAttendance([
      { status: "PRESENT" },
      { status: "EXCUSED" },
      { status: "ABSENT" },
    ]);

    assert.equal(held, 3);
    assert.equal(attended, 2);
  });

  it("honours grouped counts", () => {
    const { held, attended } = tallyAttendance([
      { status: "PRESENT", count: 7 },
      { status: "EXCUSED", count: 2 },
      { status: "ABSENT", count: 1 },
    ]);

    assert.equal(held, 10);
    assert.equal(attended, 9);
  });

  it("an empty register is zero held, not a division by zero", () => {
    assert.deepEqual(tallyAttendance([]), { held: 0, attended: 0 });
  });

  it("the excused student clears the 75% floor the old rule detained them at", () => {
    // The exact regression. Eight sessions: six present, two excused.
    //   old rule: 6/8 = 75%... 6/8 is 75, so take three excused of nine.
    const rows = [
      { status: "PRESENT", count: 6 },
      { status: "EXCUSED", count: 3 },
    ];
    const { held, attended } = tallyAttendance(rows);

    assert.equal(held, 9);
    assert.equal(attended, 9);

    // Under the rule this replaces, attended would have been 6 → 66.7%, below
    // the floor, and the student would have been warned and flagged short while
    // hall-ticket eligibility issued them a ticket at 100%.
    const oldAttended = rows
      .filter((r) => r.status === "PRESENT" || r.status === "LATE")
      .reduce((n, r) => n + (r.count ?? 1), 0);
    assert.equal(oldAttended, 6);
    assert.ok((oldAttended / held) * 100 < 75);
    assert.ok((attended / held) * 100 >= 75);
  });
});
