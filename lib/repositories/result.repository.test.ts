// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Reporting
// LAYER  : Repository — Unit Tests
// PURPOSE: Assert the CONTRACTS this repository publishes.
//
// WHAT THESE TESTS CAN AND CANNOT COVER, STATED PLAINLY
//   ResultRepository binds the module-level Prisma client rather than taking an
//   injectable handle, so its query bodies cannot be exercised without a
//   database. What CAN be verified without one is every contract it exports —
//   the projection, the ordering and the status filter — and each of those is a
//   correctness or security property in its own right:
//
//     • the projection carries the tenant-proving columns the service needs
//     • the ordering is the one the transcript's running CGPA depends on
//     • the status filter excludes registrations that were never sat
//
//   The query bodies themselves are covered indirectly by the service tests,
//   which drive the whole pipeline through a fake repository. This split is the
//   same one C6.1 applies for the same reason, and it is stated here rather than
//   left for a reader to infer.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RegistrationStatus } from "@/app/generated/prisma/enums";
import {
  REPORTABLE_REGISTRATION_STATUSES,
  RESULT_REGISTRATION_ORDER_BY,
  RESULT_REGISTRATION_SELECT,
} from "@/lib/repositories/result.repository";

describe("RESULT_REGISTRATION_SELECT", () => {
  it("carries the snapshot columns that make a result reproducible", () => {
    // CourseRegistration snapshots the credits and the governing regulation at
    // registration time. Without BOTH, a historical result could not be
    // recomputed after a scheme was superseded — which is the guarantee the
    // whole phase is built on.
    assert.equal(RESULT_REGISTRATION_SELECT.credits, true);
    assert.equal(RESULT_REGISTRATION_SELECT.evaluationSchemeId, true);
  });

  it("carries the attempt facts a GPA needs to reconcile re-sits", () => {
    assert.equal(RESULT_REGISTRATION_SELECT.attemptNumber, true);
    assert.equal(RESULT_REGISTRATION_SELECT.registrationType, true);
    assert.equal(RESULT_REGISTRATION_SELECT.courseId, true);
  });

  it("carries the semester start date the transcript orders by", () => {
    assert.equal(RESULT_REGISTRATION_SELECT.semester.select.startDate, true);
  });

  it("carries the course identity a transcript prints", () => {
    assert.equal(RESULT_REGISTRATION_SELECT.course.select.code, true);
    assert.equal(RESULT_REGISTRATION_SELECT.course.select.name, true);
  });

  it("does NOT select the whole student record through the relation", () => {
    // A result projection has no business carrying a student's personal
    // details; the endpoints return an enrollment number and nothing more.
    assert.equal("student" in RESULT_REGISTRATION_SELECT, false);
  });
});

describe("REPORTABLE_REGISTRATION_STATUSES", () => {
  it("admits exactly the three states in which a course was actually sat", () => {
    assert.deepEqual(
      [...REPORTABLE_REGISTRATION_STATUSES],
      [
        RegistrationStatus.REGISTERED,
        RegistrationStatus.CONFIRMED,
        RegistrationStatus.COMPLETED,
      ]
    );
  });

  it("EXCLUDES dropped, cancelled and withdrawn registrations", () => {
    // Each would put an unearned zero into a credit total or divide a GPA by a
    // course nobody sat. They are excluded at the query rather than filtered
    // afterwards, so they never reach the engine at all.
    const admitted = new Set<string>(REPORTABLE_REGISTRATION_STATUSES);

    assert.equal(admitted.has(RegistrationStatus.DROPPED), false);
    assert.equal(admitted.has(RegistrationStatus.CANCELLED), false);
    assert.equal(admitted.has(RegistrationStatus.WITHDRAWN), false);
  });
});

describe("RESULT_REGISTRATION_ORDER_BY", () => {
  it("orders by semester start date, then course code", () => {
    // The running CGPA on a transcript is cumulative, so the semester order is
    // load-bearing: reversed, every line but the last would report a figure the
    // student never held.
    assert.deepEqual([...RESULT_REGISTRATION_ORDER_BY], [
      { semester: { startDate: "asc" } },
      { course: { code: "asc" } },
    ]);
  });

  it("is a TOTAL order, so two reads of one student agree", () => {
    // Course code breaks a same-semester tie. Without it the order within a
    // semester would be whatever the planner returned, and a transcript would
    // reprint its courses in a different sequence each time.
    assert.equal(RESULT_REGISTRATION_ORDER_BY.length, 2);
  });
});
