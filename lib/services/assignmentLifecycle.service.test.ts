// ============================================================================
// OWNER  : Gauransh
// MODULE : Assignment Management Enhancement (Phase 24)
// LAYER  : Service — Unit Tests
// PURPOSE: Prove the submission gate, prove that a resubmission preserves the
//          grade it supersedes rather than erasing it, and prove that deleting
//          an assignment cannot destroy student work.
//
//          The service depends on a repository TYPE and one narrow PORT, so all
//          of this runs with no database and no environment. The fakes record
//          what they were asked, which is how the cohort query budget is TESTED
//          rather than asserted in a comment.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AppError } from "@/lib/errors/AppError";
import { AssignmentStatus, SubmissionStatus } from "@/app/generated/prisma/enums";
import {
  AssignmentLifecycleService,
  type AssignmentStudentPort,
} from "@/lib/services/assignmentLifecycle.service";
import type { AssignmentLifecycleRepositoryPort } from "@/lib/repositories/assignmentLifecycle.repository";

const TENANT_ID = "tenant_1";
const USER_ID = "user_1";
const STUDENT_ID = "student_1";
const ASSIGNMENT_ID = "assignment_1";
const NOW = new Date("2026-03-20T10:00:00.000Z");

function assignmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSIGNMENT_ID,
    tenantId: TENANT_ID,
    courseId: "course_1",
    sectionId: "section_1",
    title: "Problem set 3",
    status: AssignmentStatus.PUBLISHED,
    maxMarks: 100,
    dueDate: null as Date | null,
    publishedAt: NOW,
    createdBy: "faculty_user",
    ...overrides,
  };
}

interface HarnessOptions {
  assignment?: ReturnType<typeof assignmentRow> | null;
  existingSubmission?: Record<string, unknown> | null;
  submissionCount?: number;
  student?: { id: string } | null;
  registered?: boolean;
  gradeCount?: number;
  analyticsRows?: Array<Record<string, unknown>>;
}

function makeHarness(options: HarnessOptions = {}) {
  const calls = {
    createSubmission: [] as Array<Record<string, unknown>>,
    recordVersionAndReplace: [] as Array<Record<string, unknown>>,
    deleteAssignment: 0,
    countCohort: 0,
    transactions: 0,
  };

  const repository = {
    async findAssignment() {
      return options.assignment === undefined ? assignmentRow() : options.assignment;
    },
    async countCohort() {
      calls.countCohort += 1;
      return 30;
    },
    async findSubmittedPage() {
      return { rows: [], total: 0 };
    },
    async findPendingPage() {
      return { rows: [], total: 0 };
    },
    async findAssignmentsForAnalytics() {
      return { rows: options.analyticsRows ?? [], truncated: false };
    },
    async findOwnSubmission() {
      return options.existingSubmission ?? null;
    },
    async countVersions() {
      return 1;
    },
    async recordVersionAndReplace(input: Record<string, unknown>) {
      calls.recordVersionAndReplace.push(input);
      return {
        id: "sub_1",
        status: (input.next as { status: SubmissionStatus }).status,
        attachments: null,
        submittedAt: NOW,
        marks: null,
        feedback: null,
        gradedAt: null,
      };
    },
    async createSubmission(input: Record<string, unknown>) {
      calls.createSubmission.push(input);
      return {
        id: "sub_1",
        status: input.status as SubmissionStatus,
        attachments: null,
        submittedAt: NOW,
        marks: null,
        feedback: null,
        gradedAt: null,
      };
    },
    async gradeSubmission() {
      return options.gradeCount ?? 1;
    },
    async findSubmissionById() {
      return {
        id: "sub_1",
        assignmentId: ASSIGNMENT_ID,
        status: SubmissionStatus.GRADED,
        submittedAt: NOW,
        marks: 80,
        feedback: "Good",
        gradedAt: NOW,
        attachments: null,
        student: {
          id: STUDENT_ID,
          enrollmentNo: "2024CS001",
          user: {
            firstName: "Asha",
            lastName: "Rao",
            displayName: null,
            email: "asha@example.edu",
          },
        },
      };
    },
    async countSubmissions() {
      return options.submissionCount ?? 0;
    },
    async deleteAssignment() {
      calls.deleteAssignment += 1;
      return 1;
    },
    async findVersions() {
      return [
        {
          id: "ver_1",
          attempt: 1,
          status: SubmissionStatus.GRADED,
          attachments: null,
          submittedAt: NOW,
          marks: 55,
          feedback: "Needs work",
          recordedAt: NOW,
        },
      ];
    },
    async transaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      calls.transactions += 1;
      return fn(undefined as never);
    },
  } as unknown as AssignmentLifecycleRepositoryPort;

  const students: AssignmentStudentPort = {
    async findStudentByUserId() {
      return options.student === undefined ? { id: STUDENT_ID } : options.student;
    },
    async isRegistered() {
      return options.registered ?? true;
    },
  };

  return { service: new AssignmentLifecycleService(repository, students), calls };
}

// --- submit -----------------------------------------------------------------

describe("AssignmentLifecycleService.submit", () => {
  it("records a first submission as SUBMITTED", async () => {
    const { service, calls } = makeHarness();

    const result = await service.submit(TENANT_ID, USER_ID, ASSIGNMENT_ID, {}, NOW);

    assert.equal(result.status, SubmissionStatus.SUBMITTED);
    assert.equal(result.attempt, 1);
    assert.equal(result.isResubmission, false);
    assert.equal(calls.createSubmission.length, 1);
  });

  it("marks a submission after the due date as LATE", async () => {
    const { service } = makeHarness({
      assignment: assignmentRow({ dueDate: new Date("2026-03-19T23:59:00.000Z") }),
    });

    const result = await service.submit(TENANT_ID, USER_ID, ASSIGNMENT_ID, {}, NOW);

    assert.equal(result.status, SubmissionStatus.LATE);
  });

  it("is ON TIME at the exact deadline instant", async () => {
    const { service } = makeHarness({ assignment: assignmentRow({ dueDate: NOW }) });

    const result = await service.submit(TENANT_ID, USER_ID, ASSIGNMENT_ID, {}, NOW);

    assert.equal(result.status, SubmissionStatus.SUBMITTED);
  });

  it("REFUSES an assignment that is still a DRAFT", async () => {
    const { service } = makeHarness({
      assignment: assignmentRow({ status: AssignmentStatus.DRAFT }),
    });

    await assert.rejects(
      () => service.submit(TENANT_ID, USER_ID, ASSIGNMENT_ID, {}, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 409);
        return true;
      }
    );
  });

  it("REFUSES a CLOSED assignment, which would invalidate awarded marks", async () => {
    const { service } = makeHarness({
      assignment: assignmentRow({ status: AssignmentStatus.CLOSED }),
    });

    await assert.rejects(() => service.submit(TENANT_ID, USER_ID, ASSIGNMENT_ID, {}, NOW));
  });

  it("REFUSES a caller who owns no Student row", async () => {
    const { service } = makeHarness({ student: null });

    await assert.rejects(
      () => service.submit(TENANT_ID, USER_ID, ASSIGNMENT_ID, {}, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  it("REFUSES a student not registered for the course", async () => {
    const { service } = makeHarness({ registered: false });

    await assert.rejects(
      () => service.submit(TENANT_ID, USER_ID, ASSIGNMENT_ID, {}, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  it("404s on an unknown assignment", async () => {
    const { service } = makeHarness({ assignment: null });

    await assert.rejects(
      () => service.submit(TENANT_ID, USER_ID, ASSIGNMENT_ID, {}, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });
});

// --- resubmission -----------------------------------------------------------

describe("AssignmentLifecycleService resubmission", () => {
  const graded = {
    id: "sub_1",
    status: SubmissionStatus.GRADED,
    attachments: null,
    submittedAt: new Date("2026-03-10T09:00:00.000Z"),
    marks: 55,
    feedback: "Needs work",
    gradedAt: new Date("2026-03-12T09:00:00.000Z"),
    gradedBy: "faculty_user",
  };

  it("PRESERVES the superseded grade on the version row", async () => {
    // The point of the version table: a resubmission must not erase the mark a
    // faculty member already awarded.
    const { service, calls } = makeHarness({ existingSubmission: graded });

    await service.submit(TENANT_ID, USER_ID, ASSIGNMENT_ID, {}, NOW);

    const previous = calls.recordVersionAndReplace[0].previous as Record<string, unknown>;
    assert.equal(previous.marks, 55);
    assert.equal(previous.feedback, "Needs work");
    assert.equal(previous.status, SubmissionStatus.GRADED);
  });

  it("reports the write as a resubmission, with the history", async () => {
    const { service } = makeHarness({ existingSubmission: graded });

    const result = await service.submit(TENANT_ID, USER_ID, ASSIGNMENT_ID, {}, NOW);

    assert.equal(result.isResubmission, true);
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].marks, 55);
  });

  it("numbers the new version one beyond the existing count", async () => {
    const { service, calls } = makeHarness({ existingSubmission: graded });

    await service.submit(TENANT_ID, USER_ID, ASSIGNMENT_ID, {}, NOW);

    // countVersions returns 1, so the outgoing attempt is version 2.
    assert.equal(calls.recordVersionAndReplace[0].attempt, 2);
  });

  it("snapshots and overwrites inside ONE transaction", async () => {
    // Reversed or split, a crash between them loses the previous attempt —
    // which is the one thing the version table exists to prevent.
    const { service, calls } = makeHarness({ existingSubmission: graded });

    await service.submit(TENANT_ID, USER_ID, ASSIGNMENT_ID, {}, NOW);

    assert.equal(calls.transactions, 1);
  });
});

// --- grade ------------------------------------------------------------------

describe("AssignmentLifecycleService.grade", () => {
  it("applies a mark within the assignment maximum", async () => {
    const { service } = makeHarness();

    const result = await service.grade(
      TENANT_ID,
      ASSIGNMENT_ID,
      { submissionId: "sub_1", marks: 80 },
      "faculty_user",
      NOW
    );

    assert.equal(result.marks, 80);
    assert.equal(result.status, SubmissionStatus.GRADED);
  });

  it("REFUSES a mark above the assignment maximum, naming it", async () => {
    // The bound depends on a stored value the validation layer cannot read.
    const { service } = makeHarness({ assignment: assignmentRow({ maxMarks: 50 }) });

    await assert.rejects(
      () =>
        service.grade(
          TENANT_ID,
          ASSIGNMENT_ID,
          { submissionId: "sub_1", marks: 51 },
          "faculty_user",
          NOW
        ),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /50/);
        return true;
      }
    );
  });

  it("ACCEPTS a mark of zero", async () => {
    // A student who submitted nothing of merit scores zero; refusing to record
    // it forces a faculty member to invent a mark or never grade at all.
    const { service } = makeHarness();

    const result = await service.grade(
      TENANT_ID,
      ASSIGNMENT_ID,
      { submissionId: "sub_1", marks: 0 },
      "faculty_user",
      NOW
    );

    assert.equal(result.status, SubmissionStatus.GRADED);
  });

  it("404s when the update matches no row", async () => {
    // A submission belonging to another tenant's assignment, or moved between
    // the check and the write.
    const { service } = makeHarness({ gradeCount: 0 });

    await assert.rejects(
      () =>
        service.grade(
          TENANT_ID,
          ASSIGNMENT_ID,
          { submissionId: "sub_1", marks: 10 },
          "faculty_user",
          NOW
        ),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });
});

// --- delete -----------------------------------------------------------------

describe("AssignmentLifecycleService.deleteAssignment", () => {
  it("removes an assignment with no submissions", async () => {
    const { service, calls } = makeHarness({ submissionCount: 0 });

    await service.deleteAssignment(TENANT_ID, ASSIGNMENT_ID);

    assert.equal(calls.deleteAssignment, 1);
  });

  it("REFUSES to delete an assignment holding student work", async () => {
    const { service, calls } = makeHarness({ submissionCount: 3 });

    await assert.rejects(
      () => service.deleteAssignment(TENANT_ID, ASSIGNMENT_ID),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        // 409, not 403 — the role is fine, the resource state is not.
        assert.equal(err.statusCode, 409);
        return true;
      }
    );

    // Nothing was removed.
    assert.equal(calls.deleteAssignment, 0);
  });

  it("404s on an unknown assignment without attempting a delete", async () => {
    const { service, calls } = makeHarness({ assignment: null });

    await assert.rejects(() => service.deleteAssignment(TENANT_ID, ASSIGNMENT_ID));
    assert.equal(calls.deleteAssignment, 0);
  });
});

// --- analytics --------------------------------------------------------------

describe("AssignmentLifecycleService.getAnalytics", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: "a1",
    title: "PS1",
    courseId: "course_1",
    sectionId: "section_1",
    status: AssignmentStatus.PUBLISHED,
    maxMarks: 100,
    dueDate: null,
    submissions: [],
    ...overrides,
  });

  it("reads the cohort ONCE per distinct (course, section) pair", async () => {
    // Twelve assignments for one section share one cohort; twelve identical
    // counts would be eleven wasted round trips.
    const { service, calls } = makeHarness({
      analyticsRows: [row({ id: "a1" }), row({ id: "a2" }), row({ id: "a3" })],
    });

    await service.getAnalytics(TENANT_ID, {});

    assert.equal(calls.countCohort, 1);
  });

  it("reads a cohort per pair when the pairs differ", async () => {
    const { service, calls } = makeHarness({
      analyticsRows: [
        row({ id: "a1", sectionId: "section_1" }),
        row({ id: "a2", sectionId: "section_2" }),
      ],
    });

    await service.getAnalytics(TENANT_ID, {});

    assert.equal(calls.countCohort, 2);
  });

  it("rolls totals up from the per-assignment figures", async () => {
    const { service } = makeHarness({
      analyticsRows: [
        row({
          id: "a1",
          submissions: [
            { studentId: "s1", status: "SUBMITTED", marks: null, submittedAt: NOW },
            { studentId: "s2", status: "GRADED", marks: 70, submittedAt: NOW },
          ],
        }),
      ],
    });

    const analytics = await service.getAnalytics(TENANT_ID, {});

    assert.equal(analytics.totals.assignmentCount, 1);
    assert.equal(analytics.totals.submittedTotal, 2);
    assert.equal(analytics.totals.cohortTotal, 30);
    assert.equal(analytics.totals.pendingTotal, 28);
  });

  it("returns empty totals for a tenant with no assignments", async () => {
    const { service } = makeHarness({ analyticsRows: [] });

    const analytics = await service.getAnalytics(TENANT_ID, {});

    assert.equal(analytics.assignments.length, 0);
    assert.equal(analytics.totals.overallSubmissionRate, null);
  });
});
