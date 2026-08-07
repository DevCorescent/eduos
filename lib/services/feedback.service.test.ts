// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Feedback System
// LAYER  : Service — Unit Tests
// PURPOSE: Prove the authorisation gates, and that the service DELEGATES every
//          decision rather than making one.
//
//          The test that matters most asserts the COUNT-BEFORE-READ guarantee:
//          a faculty member below the threshold must never have their cohort's
//          answers in memory, which is a stronger property than computing an
//          aggregate and declining to return it. The fake repository records
//          every call, so that is verifiable rather than merely claimed.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AppError } from "@/lib/errors/AppError";
import {
  FeedbackCategory,
  FeedbackFormStatus,
  FeedbackSubmissionStatus,
  SessionType,
} from "@/app/generated/prisma/enums";
import { MIN_SUBMISSIONS_FOR_FACULTY_VIEW } from "@/lib/constants/feedback";
import { FeedbackService, type FeedbackAccess } from "@/lib/services/feedback.service";
import type { FeedbackRepository } from "@/lib/repositories/feedback.repository";
import { formatRating } from "@/lib/domain/feedback/statistics";

const TENANT_ID = "tenant_1";
const USER_ID = "user_1";
const STUDENT_ID = "student_1";
const FACULTY_ID = "faculty_1";
const COURSE_ID = "course_1";
const SEMESTER_ID = "sem_1";
const FORM_ID = "form_1";
const NOW = new Date("2026-08-09T12:00:00.000Z");

const ADMIN: FeedbackAccess = { scope: "ADMIN" };
const HOD: FeedbackAccess = { scope: "HOD" };
const OWN_FACULTY: FeedbackAccess = { scope: "FACULTY", facultyId: FACULTY_ID };

function questionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "q1",
    formId: FORM_ID,
    code: "TEACH_1",
    text: "Explains clearly",
    category: FeedbackCategory.TEACHING,
    weight: { toFixed: () => "1.00" },
    sequence: 1,
    isRequired: true,
    allowsComment: false,
    ...overrides,
  };
}

function formRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FORM_ID,
    tenantId: TENANT_ID,
    code: "FB2026",
    name: "Faculty Feedback",
    description: null,
    version: 1,
    status: FeedbackFormStatus.OPEN,
    sessionType: SessionType.LECTURE,
    statusChangedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    questions: [questionRow()],
    ...overrides,
  };
}

interface FakeData {
  form?: unknown;
  questions?: unknown[];
  existing?: unknown;
  submissions?: unknown[];
  answers?: unknown[];
  count?: number;
  own?: { id: string } | null;
  registrations?: unknown[];
  assignments?: unknown[];
  sessions?: unknown[];
  facultyExists?: boolean;
}

function build(data: FakeData = {}) {
  const calls: string[] = [];

  const repository = {
    async findFormById() {
      calls.push("findFormById");
      return data.form === undefined ? formRow() : data.form;
    },
    async findQuestions() {
      calls.push("findQuestions");
      return data.questions ?? [questionRow()];
    },
    async findSubmission() {
      calls.push("findSubmission");
      return data.existing ?? null;
    },
    async findSubmissionsForFaculty() {
      calls.push("findSubmissionsForFaculty");
      return data.submissions ?? [];
    },
    async findAttributedSubmissionsForFaculty() {
      calls.push("findAttributedSubmissionsForFaculty");
      return data.submissions ?? [];
    },
    async findSubmissionsForReport() {
      calls.push("findSubmissionsForReport");
      return data.submissions ?? [];
    },
    async findAnswersForSubmissions() {
      calls.push("findAnswersForSubmissions");
      return data.answers ?? [];
    },
    async countSubmissionsForFaculty() {
      calls.push("countSubmissionsForFaculty");
      return data.count ?? 0;
    },
    async createSubmission(input: Record<string, unknown>) {
      calls.push("createSubmission");
      return { id: "sub_new", ...input, submittedAt: input.submittedAt ?? null };
    },
    async updateSubmissionStatus(
      _t: string,
      id: string,
      status: string,
      submittedAt: Date | null
    ) {
      calls.push("updateSubmissionStatus");
      return { id, status, submittedAt };
    },
    async replaceAnswers(_t: string, _s: string, rows: readonly unknown[]) {
      calls.push("replaceAnswers");
      return rows.length;
    },
    async transaction<T>(fn: (client: unknown) => Promise<T>) {
      calls.push("transaction");
      return fn({});
    },
  } as unknown as FeedbackRepository;

  const students = {
    async findStudentByUserId() {
      calls.push("findStudentByUserId");
      return data.own === undefined ? { id: STUDENT_ID } : data.own;
    },
    async findRegistrations() {
      calls.push("findRegistrations");
      return data.registrations ?? [
        { courseId: COURSE_ID, semesterId: SEMESTER_ID, sectionId: "sec1" },
      ];
    },
  };

  const evidence = {
    async findAssignments() {
      calls.push("findAssignments");
      return (
        data.assignments ?? [
          {
            facultyId: FACULTY_ID,
            courseId: COURSE_ID,
            sectionId: null,
            semesterId: SEMESTER_ID,
            isActive: true,
          },
        ]
      );
    },
    async findSessions() {
      calls.push("findSessions");
      return data.sessions ?? [];
    },
  };

  const faculty = {
    async facultyExists() {
      calls.push("facultyExists");
      return data.facultyExists ?? true;
    },
  };

  const service = new FeedbackService(
    repository,
    students as never,
    evidence as never,
    faculty as never
  );

  return { service, calls };
}

async function expectAppError(run: () => Promise<unknown>, status: number): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof AppError, `expected AppError, got ${String(error)}`);
    assert.equal(error.statusCode, status);
    return error;
  }

  throw new Error(`expected a ${status}`);
}

const BODY = {
  formId: FORM_ID,
  facultyId: FACULTY_ID,
  courseId: COURSE_ID,
  semesterId: SEMESTER_ID,
  answers: [{ questionId: "q1", rating: 4 }],
  isFinal: true,
};

// --- Count before read ------------------------------------------------------

describe("FeedbackService — the disclosure decision precedes the read", () => {
  it("does NOT read submissions when the caller is below the threshold", () => {
    // The guarantee: a faculty member below the threshold never has their
    // cohort's answers in memory at all.
    return build({ count: 3 })
      .service.getFacultyFeedback(TENANT_ID, FACULTY_ID, {}, OWN_FACULTY)
      .then(() => {
        const { service, calls } = build({ count: 3 });

        return service
          .getFacultyFeedback(TENANT_ID, FACULTY_ID, {}, OWN_FACULTY)
          .then((summary) => {
            assert.equal(summary.analytics, null);
            assert.equal(
              calls.includes("findSubmissionsForFaculty"),
              false,
              "the answers were read despite being withheld"
            );
            assert.equal(calls.includes("findAnswersForSubmissions"), false);
          });
      });
  });

  it("reports the COUNT even when the scores are withheld", async () => {
    const { service } = build({ count: 3 });
    const summary = await service.getFacultyFeedback(TENANT_ID, FACULTY_ID, {}, OWN_FACULTY);

    assert.equal(summary.submissionCount, 3);
    assert.equal(summary.disclosure.isVisible, false);
    assert.equal(summary.disclosure.shortfall, MIN_SUBMISSIONS_FOR_FACULTY_VIEW - 3);
  });

  it("DOES read them once the threshold is cleared", async () => {
    const { service, calls } = build({
      count: MIN_SUBMISSIONS_FOR_FACULTY_VIEW,
      submissions: [
        { id: "s1", formId: FORM_ID, facultyId: FACULTY_ID, courseId: COURSE_ID, semesterId: SEMESTER_ID },
      ],
      answers: [{ submissionId: "s1", questionId: "q1", rating: 4 }],
    });

    const summary = await service.getFacultyFeedback(TENANT_ID, FACULTY_ID, {}, OWN_FACULTY);

    assert.equal(summary.disclosure.isVisible, true);
    assert.ok(calls.includes("findSubmissionsForFaculty"));
    assert.equal(formatRating(summary.analytics?.overallAverage ?? null), "4.00");
  });

  it("never withholds from an ADMIN, however small the cohort", async () => {
    const { service } = build({
      count: 1,
      submissions: [
        { id: "s1", formId: FORM_ID, facultyId: FACULTY_ID, courseId: COURSE_ID, semesterId: SEMESTER_ID },
      ],
      answers: [{ submissionId: "s1", questionId: "q1", rating: 5 }],
    });

    const summary = await service.getFacultyFeedback(TENANT_ID, FACULTY_ID, {}, ADMIN);

    assert.equal(summary.disclosure.isVisible, true);
  });

  it("gates a DEPARTMENT HEAD like a faculty member", async () => {
    const { service } = build({ count: 2 });
    const summary = await service.getFacultyFeedback(TENANT_ID, FACULTY_ID, {}, HOD);

    assert.equal(summary.disclosure.isVisible, false);
  });

  it("refuses a faculty member reading a COLLEAGUE, without leaking a count", async () => {
    const { service } = build({ count: 50 });

    const summary = await service.getFacultyFeedback(TENANT_ID, "faculty_other", {}, OWN_FACULTY);

    assert.equal(summary.disclosure.isVisible, false);
    assert.equal(summary.disclosure.reason, "NOT_OWN_RECORD");
    assert.equal(summary.disclosure.shortfall, null);
  });

  it("raises 404 for a faculty member outside the tenant", async () => {
    const { service } = build({ facultyExists: false });

    await expectAppError(
      () => service.getFacultyFeedback(TENANT_ID, FACULTY_ID, {}, ADMIN),
      404
    );
  });
});

// --- Submission -------------------------------------------------------------

describe("FeedbackService — submitFeedback", () => {
  it("records a valid submission as SUBMITTED", async () => {
    const { service, calls } = build();
    const result = await service.submitFeedback(TENANT_ID, USER_ID, BODY, NOW);

    assert.equal(result.status, FeedbackSubmissionStatus.SUBMITTED);
    assert.equal(result.recorded, 1);
    assert.ok(calls.includes("transaction"));
    assert.ok(calls.includes("replaceAnswers"));
  });

  it("FORBIDS a caller with no Student row", async () => {
    const { service } = build({ own: null });

    await expectAppError(() => service.submitFeedback(TENANT_ID, USER_ID, BODY, NOW), 403);
  });

  it("raises 404 for a form that does not resolve", async () => {
    const { service } = build({ form: null });

    await expectAppError(() => service.submitFeedback(TENANT_ID, USER_ID, BODY, NOW), 404);
  });

  it("returns 409 — not 403 — when the form is CLOSED", async () => {
    // The window shut. Telling a student "forbidden" would send them to the
    // wrong person for help.
    const { service } = build({ form: formRow({ status: FeedbackFormStatus.CLOSED }) });

    const error = await expectAppError(
      () => service.submitFeedback(TENANT_ID, USER_ID, BODY, NOW),
      409
    );

    assert.ok(error.message.includes("not accepting"));
  });

  it("refuses a student who was not registered", async () => {
    const { service } = build({ registrations: [] });

    await expectAppError(() => service.submitFeedback(TENANT_ID, USER_ID, BODY, NOW), 403);
  });

  it("refuses a faculty member who did not teach the course", async () => {
    const { service } = build({ assignments: [] });

    await expectAppError(() => service.submitFeedback(TENANT_ID, USER_ID, BODY, NOW), 403);
  });

  it("refuses a LAB form when no LAB session took place", async () => {
    const { service } = build({
      form: formRow({ sessionType: SessionType.LAB }),
      sessions: [],
    });

    const error = await expectAppError(
      () => service.submitFeedback(TENANT_ID, USER_ID, BODY, NOW),
      403
    );

    assert.ok(error.message.includes("lab"));
  });

  it("ACCEPTS a lab form when a LAB session did take place", async () => {
    const { service } = build({
      form: formRow({ sessionType: SessionType.LAB }),
      sessions: [
        {
          facultyId: FACULTY_ID,
          courseId: COURSE_ID,
          semesterId: SEMESTER_ID,
          sectionId: "sec1",
          sessionType: SessionType.LAB,
          isActive: true,
        },
      ],
    });

    const result = await service.submitFeedback(TENANT_ID, USER_ID, BODY, NOW);

    assert.equal(result.status, FeedbackSubmissionStatus.SUBMITTED);
  });

  it("REFUSES a second submission once one is final", async () => {
    const { service } = build({
      existing: { id: "sub_1", status: FeedbackSubmissionStatus.SUBMITTED },
    });

    await expectAppError(() => service.submitFeedback(TENANT_ID, USER_ID, BODY, NOW), 409);
  });

  it("UPDATES an existing draft rather than inserting a second row", async () => {
    // The unique constraint would refuse a second; the service must know to
    // update.
    const { service, calls } = build({
      existing: { id: "sub_1", status: FeedbackSubmissionStatus.DRAFT },
    });

    await service.submitFeedback(TENANT_ID, USER_ID, BODY, NOW);

    assert.ok(calls.includes("updateSubmissionStatus"));
    assert.equal(calls.includes("createSubmission"), false);
  });

  it("REFUSES an answer citing a question not on the form", async () => {
    const { service } = build();

    await expectAppError(
      () =>
        service.submitFeedback(
          TENANT_ID,
          USER_ID,
          { ...BODY, answers: [{ questionId: "ghost", rating: 4 }] },
          NOW
        ),
      422
    );
  });

  it("REFUSES a comment on a question that does not invite one", async () => {
    const { service } = build();

    const error = await expectAppError(
      () =>
        service.submitFeedback(
          TENANT_ID,
          USER_ID,
          { ...BODY, answers: [{ questionId: "q1", rating: 4, comment: "unasked" }] },
          NOW
        ),
      422
    );

    assert.ok(error.message.includes("comment"));
  });

  it("REFUSES to finish while a required question is unanswered", async () => {
    const { service } = build({
      form: formRow({
        questions: [questionRow(), questionRow({ id: "q2", code: "T2" })],
      }),
    });

    await expectAppError(() => service.submitFeedback(TENANT_ID, USER_ID, BODY, NOW), 422);
  });

  it("SAVES an incomplete set as a DRAFT when not finishing", async () => {
    const { service } = build({
      form: formRow({
        questions: [questionRow(), questionRow({ id: "q2", code: "T2" })],
      }),
    });

    const result = await service.submitFeedback(
      TENANT_ID,
      USER_ID,
      { ...BODY, isFinal: false },
      NOW
    );

    assert.equal(result.status, FeedbackSubmissionStatus.DRAFT);
    assert.equal(result.submittedAt, null);
  });

  it("stamps submittedAt only on a final submission", async () => {
    const final = await build().service.submitFeedback(TENANT_ID, USER_ID, BODY, NOW);
    const draft = await build().service.submitFeedback(
      TENANT_ID,
      USER_ID,
      { ...BODY, isFinal: false },
      NOW
    );

    assert.equal(final.submittedAt, NOW.toISOString());
    assert.equal(draft.submittedAt, null);
  });

  it("writes the submission and its answers in ONE transaction", async () => {
    const { service, calls } = build();

    await service.submitFeedback(TENANT_ID, USER_ID, BODY, NOW);

    assert.equal(calls.filter((call) => call === "transaction").length, 1);
  });
});

// --- Report -----------------------------------------------------------------

describe("FeedbackService — getReport", () => {
  const submissions = [
    { id: "s1", formId: FORM_ID, facultyId: "f1", courseId: COURSE_ID, semesterId: SEMESTER_ID },
    { id: "s2", formId: FORM_ID, facultyId: "f2", courseId: COURSE_ID, semesterId: SEMESTER_ID },
  ];

  const answers = [
    { submissionId: "s1", questionId: "q1", rating: 5 },
    { submissionId: "s2", questionId: "q1", rating: 3 },
  ];

  it("aggregates for an admin", async () => {
    const { service } = build({ submissions, answers });
    const report = await service.getReport(TENANT_ID, {}, ADMIN);

    assert.equal(report.facultyCount, 2);
    assert.equal(report.submissionCount, 2);
    assert.equal(formatRating(report.overallAverage), "4.00");
  });

  it("aggregates for a department head", async () => {
    const { service } = build({ submissions, answers });

    assert.equal((await service.getReport(TENANT_ID, {}, HOD)).facultyCount, 2);
  });

  it("REFUSES a faculty member", async () => {
    // A cross-faculty report is a comparison between colleagues.
    const { service } = build({ submissions, answers });

    await expectAppError(() => service.getReport(TENANT_ID, {}, OWN_FACULTY), 403);
  });

  it("REFUSES a student", async () => {
    const { service } = build({ submissions, answers });

    await expectAppError(
      () => service.getReport(TENANT_ID, {}, { scope: "STUDENT", userId: USER_ID }),
      403
    );
  });

  it("handles a scope nobody has feedback for", async () => {
    const { service } = build({ submissions: [], answers: [] });
    const report = await service.getReport(TENANT_ID, {}, ADMIN);

    assert.equal(report.facultyCount, 0);
    assert.equal(report.overallAverage, null);
  });

  it("reads the cohort's answers in ONE statement", async () => {
    const { service, calls } = build({ submissions, answers });

    await service.getReport(TENANT_ID, {}, ADMIN);

    assert.equal(calls.filter((call) => call === "findAnswersForSubmissions").length, 1);
  });

  it("reads one question set when the report names a form", async () => {
    const { service, calls } = build({ submissions, answers });

    await service.getReport(TENANT_ID, { formId: FORM_ID }, ADMIN);

    assert.equal(calls.filter((call) => call === "findQuestions").length, 1);
  });
});

// --- Query budget -----------------------------------------------------------

describe("FeedbackService — query budget", () => {
  it("costs a fixed set of reads regardless of cohort size", async () => {
    const small = build({
      count: 10,
      submissions: [
        { id: "s1", formId: FORM_ID, facultyId: FACULTY_ID, courseId: COURSE_ID, semesterId: SEMESTER_ID },
      ],
      answers: [{ submissionId: "s1", questionId: "q1", rating: 4 }],
    });

    const large = build({
      count: 300,
      submissions: Array.from({ length: 300 }, (_value, index) => ({
        id: `s${index}`,
        formId: FORM_ID,
        facultyId: FACULTY_ID,
        courseId: COURSE_ID,
        semesterId: SEMESTER_ID,
      })),
      answers: Array.from({ length: 300 }, (_value, index) => ({
        submissionId: `s${index}`,
        questionId: "q1",
        rating: 4,
      })),
    });

    await small.service.getFacultyFeedback(TENANT_ID, FACULTY_ID, {}, ADMIN);
    await large.service.getFacultyFeedback(TENANT_ID, FACULTY_ID, {}, ADMIN);

    assert.equal(
      small.calls.length,
      large.calls.length,
      "three hundred submissions cost more reads than one"
    );
  });

  it("resolves the student exactly once per submission", async () => {
    const { service, calls } = build();

    await service.submitFeedback(TENANT_ID, USER_ID, BODY, NOW);

    assert.equal(calls.filter((call) => call === "findStudentByUserId").length, 1);
  });
});
