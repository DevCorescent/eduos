// ============================================================================
// TESTS: Examination eligibility.
//
// This is the gate on hall-ticket issue, so it is a security-relevant branch:
// if it ever returns eligible for a student who is not enrolled, the
// examination office hands that student a ticket. It runs the real function —
// no mocks, no source-text matching — because the decision was deliberately
// separated from its database read so that it could.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attendancePercentage,
  decideEligibility,
  INELIGIBILITY_REASON,
  MINIMUM_ATTENDANCE_PERCENTAGE,
} from "./eligibility";

describe("attendancePercentage", () => {
  it("returns a whole-number percentage", () => {
    assert.equal(attendancePercentage(10, 9), 90);
    assert.equal(attendancePercentage(7, 6), 86);
  });

  it("treats a register with NO sessions held as 100, not 0", () => {
    // Nobody has missed a class that never happened. Returning 0 would make
    // every student in a freshly created course ineligible, which is how an
    // eligibility rule ends up switched off in production rather than fixed.
    assert.equal(attendancePercentage(0, 0), 100);
    assert.equal(attendancePercentage(-1, 0), 100);
  });
});

describe("decideEligibility — who may sit", () => {
  it("admits an enrolled student with sufficient attendance", () => {
    const decision = decideEligibility({
      registrationStatus: "CONFIRMED",
      sessionsHeld: 10,
      sessionsAttended: 9,
    });

    assert.deepEqual(decision, { eligible: true, attendancePercentage: 90 });
  });

  it("admits REGISTERED as well as CONFIRMED", () => {
    assert.equal(
      decideEligibility({
        registrationStatus: "REGISTERED",
        sessionsHeld: 4,
        sessionsAttended: 4,
      }).eligible,
      true
    );
  });

  it("REFUSES a student with no enrolment at all", () => {
    const decision = decideEligibility({
      registrationStatus: null,
      sessionsHeld: 10,
      sessionsAttended: 10,
    });

    assert.equal(decision.eligible, false);
    assert.equal(
      !decision.eligible && decision.reason,
      INELIGIBILITY_REASON.NOT_REGISTERED
    );
  });

  it("REFUSES a withdrawn, dropped or cancelled enrolment", () => {
    for (const status of ["WITHDRAWN", "DROPPED", "CANCELLED", "COMPLETED"]) {
      const decision = decideEligibility({
        registrationStatus: status,
        sessionsHeld: 10,
        sessionsAttended: 10,
      });

      assert.equal(decision.eligible, false, `${status} must not sit`);
      assert.equal(
        !decision.eligible && decision.reason,
        INELIGIBILITY_REASON.REGISTRATION_NOT_ACTIVE,
        `${status} is an enrolment problem, not an attendance one`
      );
    }
  });

  it("REFUSES a student below the attendance floor", () => {
    const decision = decideEligibility({
      registrationStatus: "CONFIRMED",
      sessionsHeld: 10,
      sessionsAttended: 7,
    });

    assert.equal(decision.eligible, false);
    assert.equal(
      !decision.eligible && decision.reason,
      INELIGIBILITY_REASON.ATTENDANCE_SHORTAGE
    );
  });

  it("admits a student exactly ON the floor", () => {
    // The rule is "below the minimum fails", so the boundary itself passes.
    // Off-by-one here detains a whole cohort that met the requirement.
    const decision = decideEligibility({
      registrationStatus: "CONFIRMED",
      sessionsHeld: 100,
      sessionsAttended: MINIMUM_ATTENDANCE_PERCENTAGE,
    });

    assert.deepEqual(decision, {
      eligible: true,
      attendancePercentage: MINIMUM_ATTENDANCE_PERCENTAGE,
    });
  });

  it("reports enrolment BEFORE attendance when both fail", () => {
    // Precedence matters for the message: a student who is not enrolled is not
    // "short of attendance", and telling them so sends them to the wrong office.
    const decision = decideEligibility({
      registrationStatus: null,
      sessionsHeld: 10,
      sessionsAttended: 0,
    });

    assert.equal(
      !decision.eligible && decision.reason,
      INELIGIBILITY_REASON.NOT_REGISTERED
    );
  });

  it("carries the percentage on a refusal as well as an admission", () => {
    // The eligibility roll shows the figure beside every student, including the
    // ones it refuses — that is what makes a shortage actionable.
    const decision = decideEligibility({
      registrationStatus: "CONFIRMED",
      sessionsHeld: 8,
      sessionsAttended: 2,
    });

    assert.equal(decision.attendancePercentage, 25);
  });
});
