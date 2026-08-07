// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Feedback System
// LAYER  : Repository — Unit Tests
// PURPOSE: Verify what every query ASKS OF THE DATABASE.
//
//          A repository holds no logic, so the meaningful questions are
//          structural — and in a module whose core requirement is
//          NON-DISCLOSURE, the first of them is the most important test in the
//          phase:
//
//            • does the faculty-facing projection OMIT studentId?
//            • is every query tenant-scoped?
//            • do analytics read only SUBMITTED rows?
//            • does a cohort read avoid an N+1 across two hundred submissions?
//            • does the repository decide NOTHING about averages, thresholds or
//              eligibility?
//
//          Every method takes an injectable client, so all of it runs with no
//          database and no environment.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FeedbackFormStatus,
  FeedbackSubmissionStatus,
  SessionType,
} from "@/app/generated/prisma/enums";
import { FakePrismaClient } from "@/lib/repositories/testing/fakePrismaClient";
import {
  ANALYSABLE_STATUS,
  ANONYMOUS_SUBMISSION_SELECT,
  ANSWER_SELECT,
  ATTRIBUTED_SUBMISSION_SELECT,
  FORM_ORDER_BY,
  FORM_SELECT,
  FeedbackRepository,
  QUESTION_SELECT,
  SUBMISSION_ORDER_BY,
  type DbClient,
} from "@/lib/repositories/feedback.repository";

const TENANT_ID = "tenant_1";
const OTHER_TENANT = "tenant_2";
const FORM_ID = "form_1";
const FACULTY_ID = "faculty_1";
const STUDENT_ID = "student_1";
const COURSE_ID = "course_1";
const SEMESTER_ID = "sem_1";
const SUBMISSION_ID = "submission_1";
const NOW = new Date("2026-08-09T00:00:00.000Z");

const repository = new FeedbackRepository();

function fake(): { client: FakePrismaClient; db: DbClient } {
  const client = new FakePrismaClient();
  return { client, db: client as unknown as DbClient };
}

function whereOf(args: Record<string, unknown>): Record<string, unknown> {
  return args.where as Record<string, unknown>;
}

const KEY = {
  studentId: STUDENT_ID,
  facultyId: FACULTY_ID,
  courseId: COURSE_ID,
  semesterId: SEMESTER_ID,
  formId: FORM_ID,
};

// --- Anonymity: the most important suite in the phase ------------------------

describe("FeedbackRepository — anonymity is structural, not procedural", () => {
  it("the ANONYMOUS projection OMITS studentId entirely", () => {
    // A faculty-facing query using this shape cannot return an identity however
    // the result is later handled — there is no masking step to skip.
    assert.equal("studentId" in ANONYMOUS_SUBMISSION_SELECT, false);
  });

  it("the ATTRIBUTED projection includes it", () => {
    assert.equal(ATTRIBUTED_SUBMISSION_SELECT.studentId, true);
  });

  it("the two shapes differ by EXACTLY one field", () => {
    // If they ever converge, one of the two guarantees has quietly gone.
    const anonymous = Object.keys(ANONYMOUS_SUBMISSION_SELECT).sort();
    const attributed = Object.keys(ATTRIBUTED_SUBMISSION_SELECT).sort();

    assert.deepEqual(
      attributed.filter((key) => !anonymous.includes(key)),
      ["studentId"]
    );
    assert.deepEqual(
      anonymous.filter((key) => !attributed.includes(key)),
      [],
      "the anonymous shape has a field the attributed one lacks"
    );
  });

  it("the FACULTY report uses the anonymous projection", async () => {
    const { client, db } = fake();

    await repository.findSubmissionsForFaculty(TENANT_ID, FACULTY_ID, {}, db);

    const select = client.onlyCallTo("feedbackSubmission", "findMany").args.select;

    assert.deepEqual(select, ANONYMOUS_SUBMISSION_SELECT);
    assert.equal("studentId" in (select as Record<string, unknown>), false);
  });

  it("the INSTITUTION report uses the anonymous projection too", async () => {
    // A report is a statement about a population; an identity has no place in
    // one.
    const { client, db } = fake();

    await repository.findSubmissionsForReport(TENANT_ID, {}, db);

    assert.equal(
      "studentId" in
        (client.onlyCallTo("feedbackSubmission", "findMany").args.select as Record<
          string,
          unknown
        >),
      false
    );
  });

  it("the AUDIT read is a separate METHOD, not a boolean flag", async () => {
    // A boolean parameter is a thing a caller can pass wrongly; a method name
    // is something a reviewer notices.
    const { client, db } = fake();

    await repository.findAttributedSubmissionsForFaculty(TENANT_ID, FACULTY_ID, {}, db);

    assert.deepEqual(
      client.onlyCallTo("feedbackSubmission", "findMany").args.select,
      ATTRIBUTED_SUBMISSION_SELECT
    );
  });

  it("the two faculty reads share an identical PREDICATE", async () => {
    // Only the projection differs. If the predicates diverged, one audience
    // would be seeing a different population than the other.
    const anonymous = fake();
    const attributed = fake();

    await repository.findSubmissionsForFaculty(
      TENANT_ID,
      FACULTY_ID,
      { courseId: COURSE_ID },
      anonymous.db
    );
    await repository.findAttributedSubmissionsForFaculty(
      TENANT_ID,
      FACULTY_ID,
      { courseId: COURSE_ID },
      attributed.db
    );

    assert.deepEqual(
      whereOf(anonymous.client.onlyCallTo("feedbackSubmission", "findMany").args),
      whereOf(attributed.client.onlyCallTo("feedbackSubmission", "findMany").args)
    );
  });

  it("exposes no method whose name promises masking", () => {
    // Masking is an action a caller can forget. This module has none to forget.
    for (const method of Object.getOwnPropertyNames(FeedbackRepository.prototype)) {
      assert.equal(
        /mask|anonymi[sz]e|redact|hide/i.test(method),
        false,
        `${method} implies a masking step`
      );
    }
  });
});

// --- Tenant isolation -------------------------------------------------------

describe("FeedbackRepository — tenant isolation", () => {
  it("scopes EVERY read by tenant", async () => {
    const { client, db } = fake();

    await repository.listForms(TENANT_ID, { page: 1, limit: 20 }, db);
    await repository.findFormById(TENANT_ID, FORM_ID, db);
    await repository.findQuestions(TENANT_ID, FORM_ID, db);
    await repository.findSubmission(TENANT_ID, KEY, db);
    await repository.findSubmissionById(TENANT_ID, SUBMISSION_ID, db);
    await repository.findSubmissionsForFaculty(TENANT_ID, FACULTY_ID, {}, db);
    await repository.findAttributedSubmissionsForFaculty(TENANT_ID, FACULTY_ID, {}, db);
    await repository.findSubmissionsForReport(TENANT_ID, {}, db);
    await repository.countSubmissionsForFaculty(TENANT_ID, FACULTY_ID, {}, db);
    await repository.findAnswers(TENANT_ID, SUBMISSION_ID, db);
    await repository.findAnswersForSubmissions(TENANT_ID, [SUBMISSION_ID], db);

    assert.ok(client.calls.length > 0);

    for (const call of client.calls) {
      assert.equal(
        whereOf(call.args).tenantId,
        TENANT_ID,
        `${call.model}.${call.operation} is not tenant-scoped`
      );
    }
  });

  it("folds the tenant into a single-form lookup rather than checking after", async () => {
    const { client, db } = fake();

    await repository.findFormById(TENANT_ID, FORM_ID, db);

    const where = whereOf(client.onlyCallTo("feedbackForm", "findFirst").args);

    assert.equal(where.id, FORM_ID);
    assert.equal(where.tenantId, TENANT_ID);
  });

  it("uses findFirst, never findUnique", async () => {
    const { client, db } = fake();

    await repository.findFormById(TENANT_ID, FORM_ID, db);
    await repository.findSubmissionById(TENANT_ID, SUBMISSION_ID, db);

    assert.equal(client.callsTo("feedbackForm", "findUnique").length, 0);
    assert.equal(client.callsTo("feedbackSubmission", "findUnique").length, 0);
  });

  it("carries the caller's OWN tenant, never a substituted one", async () => {
    const { client, db } = fake();

    await repository.findSubmissionsForFaculty(OTHER_TENANT, FACULTY_ID, {}, db);

    assert.equal(
      whereOf(client.onlyCallTo("feedbackSubmission", "findMany").args).tenantId,
      OTHER_TENANT
    );
  });

  it("writes a status change with its OWN tenant predicate", async () => {
    // The TOCTOU defence: the selector carries the tenant rather than
    // inheriting it from a preceding read.
    const { client, db } = fake();

    await repository.updateSubmissionStatus(
      TENANT_ID,
      SUBMISSION_ID,
      FeedbackSubmissionStatus.SUBMITTED,
      NOW,
      db
    );

    assert.deepEqual(client.onlyCallTo("feedbackSubmission", "update").args.where, {
      tenantId_id: { tenantId: TENANT_ID, id: SUBMISSION_ID },
    });
  });

  it("scopes both answer writes by tenant", async () => {
    const { client, db } = fake();

    await repository.replaceAnswers(
      TENANT_ID,
      SUBMISSION_ID,
      [{ questionId: "q1", rating: 4 }],
      db
    );

    assert.equal(
      whereOf(client.onlyCallTo("feedbackAnswer", "deleteMany").args).tenantId,
      TENANT_ID
    );

    const data = client.onlyCallTo("feedbackAnswer", "createMany").args.data as Record<
      string,
      unknown
    >[];

    assert.equal(data[0].tenantId, TENANT_ID);
  });
});

// --- Only SUBMITTED rows are analysable -------------------------------------

describe("FeedbackRepository — a DRAFT never reaches an analytic", () => {
  it("names SUBMITTED as the only analysable status", () => {
    assert.equal(ANALYSABLE_STATUS, FeedbackSubmissionStatus.SUBMITTED);
  });

  it("filters the faculty report to SUBMITTED", async () => {
    // A DRAFT is a student mid-thought. Averaging it would let a half-finished
    // form move a faculty member's score.
    const { client, db } = fake();

    await repository.findSubmissionsForFaculty(TENANT_ID, FACULTY_ID, {}, db);

    assert.equal(
      whereOf(client.onlyCallTo("feedbackSubmission", "findMany").args).status,
      FeedbackSubmissionStatus.SUBMITTED
    );
  });

  it("filters the institution report to SUBMITTED", async () => {
    const { client, db } = fake();

    await repository.findSubmissionsForReport(TENANT_ID, {}, db);

    assert.equal(
      whereOf(client.onlyCallTo("feedbackSubmission", "findMany").args).status,
      FeedbackSubmissionStatus.SUBMITTED
    );
  });

  it("filters the COUNT to SUBMITTED too", async () => {
    // The count feeds the disclosure threshold. Counting drafts would let a
    // faculty member's results unlock on submissions nobody finished.
    const { client, db } = fake();

    await repository.countSubmissionsForFaculty(TENANT_ID, FACULTY_ID, {}, db);

    assert.equal(
      whereOf(client.onlyCallTo("feedbackSubmission", "count").args).status,
      FeedbackSubmissionStatus.SUBMITTED
    );
  });

  it("does NOT filter the duplicate-check read by status", async () => {
    // An existing DRAFT still occupies the unique key; ignoring it would make
    // the service try to create a second row and hit the constraint.
    const { client, db } = fake();

    await repository.findSubmission(TENANT_ID, KEY, db);

    assert.equal(
      "status" in whereOf(client.onlyCallTo("feedbackSubmission", "findFirst").args),
      false
    );
  });
});

// --- No N+1 -----------------------------------------------------------------

describe("FeedbackRepository — no read can become an N+1", () => {
  it("nests a form's questions rather than reading them per form", async () => {
    const { client, db } = fake();

    await repository.findFormById(TENANT_ID, FORM_ID, db);

    assert.equal(client.callCount, 1);
    assert.ok("questions" in FORM_SELECT);
  });

  it("reads a whole cohort's answers in ONE statement", async () => {
    // Two hundred submissions cost one read, not two hundred.
    const { client, db } = fake();
    const ids = Array.from({ length: 200 }, (_value, index) => `submission_${index}`);

    await repository.findAnswersForSubmissions(TENANT_ID, ids, db);

    assert.equal(client.callCount, 1);
    assert.equal(
      (whereOf(client.onlyCallTo("feedbackAnswer", "findMany").args).submissionId as {
        in: string[];
      }).in.length,
      200
    );
  });

  it("short-circuits an empty id set rather than issuing a query", async () => {
    const { client, db } = fake();

    assert.deepEqual(await repository.findAnswersForSubmissions(TENANT_ID, [], db), []);
    assert.equal(client.callCount, 0);
  });

  it("costs exactly TWO statements for a paginated form list", async () => {
    const { client, db } = fake();

    await repository.listForms(TENANT_ID, { page: 1, limit: 20 }, db);

    assert.equal(client.callCount, 2, "one page, one count");
  });

  it("costs exactly ONE statement for a whole faculty report read", async () => {
    const { client, db } = fake();

    client.resultFor(
      "feedbackSubmission",
      "findMany",
      Array.from({ length: 300 }, (_value, index) => ({ id: `s${index}` }))
    );

    await repository.findSubmissionsForFaculty(TENANT_ID, FACULTY_ID, {}, db);

    assert.equal(client.callCount, 1);
  });
});

// --- The repository decides nothing -----------------------------------------

describe("FeedbackRepository — it computes and decides nothing", () => {
  it("exposes NO method that returns an average or a score", () => {
    for (const method of Object.getOwnPropertyNames(FeedbackRepository.prototype)) {
      assert.equal(
        /average|mean|score|rating[A-Z]|aggregate|analyt|report[A-Z]|trend/i.test(method),
        false,
        `${method} implies a calculation`
      );
    }
  });

  it("exposes NO method that evaluates eligibility or duplication", () => {
    for (const method of Object.getOwnPropertyNames(FeedbackRepository.prototype)) {
      assert.equal(
        /isEligible|canSubmit|isDuplicate|hasSubmitted|isVisible|threshold/i.test(method),
        false,
        `${method} implies a decision`
      );
    }
  });

  it("COUNTS rather than judging whether a threshold is met", async () => {
    // Whether five is enough is a comparison, and a comparison is a decision.
    const { db } = fake();

    const count = await repository.countSubmissionsForFaculty(TENANT_ID, FACULTY_ID, {}, db);

    assert.equal(typeof count, "number");
  });

  it("does not consult a form's status on any write", async () => {
    // Whether the form is OPEN is a lifecycle rule and therefore the service's.
    const { client, db } = fake();

    await repository.replaceAnswers(
      TENANT_ID,
      SUBMISSION_ID,
      [{ questionId: "q1", rating: 5 }],
      db
    );

    assert.equal(JSON.stringify(client.calls).includes("OPEN"), false);
  });
});

// --- Filters, ordering and writes -------------------------------------------

describe("FeedbackRepository — filters", () => {
  it("omits a filter entirely when it was not supplied", async () => {
    const { client, db } = fake();

    await repository.findSubmissionsForFaculty(TENANT_ID, FACULTY_ID, {}, db);

    const where = whereOf(client.onlyCallTo("feedbackSubmission", "findMany").args);

    for (const key of ["courseId", "semesterId", "formId"]) {
      assert.equal(key in where, false, key);
    }
  });

  it("applies every faculty-report filter", async () => {
    const { client, db } = fake();

    await repository.findSubmissionsForFaculty(
      TENANT_ID,
      FACULTY_ID,
      { courseId: COURSE_ID, semesterId: SEMESTER_ID, formId: FORM_ID },
      db
    );

    const where = whereOf(client.onlyCallTo("feedbackSubmission", "findMany").args);

    assert.equal(where.courseId, COURSE_ID);
    assert.equal(where.semesterId, SEMESTER_ID);
    assert.equal(where.formId, FORM_ID);
  });

  it("reaches a department through the faculty relation", async () => {
    // The only cross-model filter this module needs.
    const { client, db } = fake();

    await repository.findSubmissionsForReport(TENANT_ID, { departmentId: "dept_1" }, db);

    assert.deepEqual(
      whereOf(client.onlyCallTo("feedbackSubmission", "findMany").args).faculty,
      { departmentId: "dept_1" }
    );
  });

  it("applies the form-list filters", async () => {
    const { client, db } = fake();

    await repository.listForms(
      TENANT_ID,
      {
        page: 1,
        limit: 20,
        status: FeedbackFormStatus.OPEN,
        sessionType: SessionType.LAB,
        code: "FB2026",
      },
      db
    );

    const where = whereOf(client.onlyCallTo("feedbackForm", "findMany").args);

    assert.equal(where.status, FeedbackFormStatus.OPEN);
    assert.equal(where.sessionType, SessionType.LAB);
    assert.equal(where.code, "FB2026");
  });

  it("scopes the duplicate check on all FIVE key columns", async () => {
    // Exactly the columns the unique constraint names — anything narrower would
    // report a duplicate that is not one.
    const { client, db } = fake();

    await repository.findSubmission(TENANT_ID, KEY, db);

    const where = whereOf(client.onlyCallTo("feedbackSubmission", "findFirst").args);

    for (const [key, value] of Object.entries(KEY)) {
      assert.equal(where[key], value, key);
    }
  });
});

describe("FeedbackRepository — ordering and pagination", () => {
  it("closes every ordering with a unique tiebreaker", () => {
    for (const ordering of [FORM_ORDER_BY, SUBMISSION_ORDER_BY]) {
      const last = ordering[ordering.length - 1] as Record<string, string>;

      assert.ok("id" in last, JSON.stringify(ordering));
    }
  });

  it("orders forms by code then newest version", async () => {
    const { client, db } = fake();

    await repository.listForms(TENANT_ID, { page: 1, limit: 20 }, db);

    assert.deepEqual(client.onlyCallTo("feedbackForm", "findMany").args.orderBy, [
      ...FORM_ORDER_BY,
    ]);
  });

  it("orders a form's questions by sequence", async () => {
    const { client, db } = fake();

    await repository.findQuestions(TENANT_ID, FORM_ID, db);

    assert.deepEqual(client.onlyCallTo("feedbackQuestion", "findMany").args.orderBy, {
      sequence: "asc",
    });
  });

  it("translates page and limit to skip and take", async () => {
    const { client, db } = fake();

    await repository.listForms(TENANT_ID, { page: 3, limit: 25 }, db);

    const args = client.onlyCallTo("feedbackForm", "findMany").args;

    assert.equal(args.skip, 50);
    assert.equal(args.take, 25);
  });

  it("does NOT paginate the count", async () => {
    const { client, db } = fake();

    await repository.listForms(TENANT_ID, { page: 2, limit: 10 }, db);

    assert.equal(client.onlyCallTo("feedbackForm", "count").args.skip, undefined);
  });

  it("counts under the identical predicate as the page", async () => {
    const { client, db } = fake();

    await repository.listForms(
      TENANT_ID,
      { page: 1, limit: 20, status: FeedbackFormStatus.CLOSED },
      db
    );

    assert.deepEqual(
      whereOf(client.onlyCallTo("feedbackForm", "count").args),
      whereOf(client.onlyCallTo("feedbackForm", "findMany").args)
    );
  });
});

describe("FeedbackRepository — writes", () => {
  it("replaces answers wholesale: delete then insert, in that order", async () => {
    const { client, db } = fake();

    await repository.replaceAnswers(
      TENANT_ID,
      SUBMISSION_ID,
      [
        { questionId: "q1", rating: 4 },
        { questionId: "q2", rating: 5, comment: "Clear explanations" },
      ],
      db
    );

    assert.deepEqual(
      client.calls.map((call) => call.operation),
      ["deleteMany", "createMany"]
    );
  });

  it("writes every answer in ONE createMany", async () => {
    const { client, db } = fake();

    const rows = Array.from({ length: 30 }, (_value, index) => ({
      questionId: `q${index}`,
      rating: 3,
    }));

    const written = await repository.replaceAnswers(TENANT_ID, SUBMISSION_ID, rows, db);

    assert.equal(written, 30);
    assert.equal(client.callsTo("feedbackAnswer", "createMany").length, 1);
  });

  it("normalises an absent comment to null rather than undefined", async () => {
    const { client, db } = fake();

    await repository.replaceAnswers(
      TENANT_ID,
      SUBMISSION_ID,
      [{ questionId: "q1", rating: 4 }],
      db
    );

    const data = client.onlyCallTo("feedbackAnswer", "createMany").args.data as Record<
      string,
      unknown
    >[];

    assert.equal(data[0].comment, null);
  });

  it("CLEARS without inserting when handed an empty set", async () => {
    const { client, db } = fake();

    assert.equal(await repository.replaceAnswers(TENANT_ID, SUBMISSION_ID, [], db), 0);
    assert.equal(client.callsTo("feedbackAnswer", "createMany").length, 0);
    assert.equal(client.callsTo("feedbackAnswer", "deleteMany").length, 1);
  });

  it("creates a submission carrying all five key columns", async () => {
    const { client, db } = fake();

    await repository.createSubmission(
      {
        tenantId: TENANT_ID,
        ...KEY,
        status: FeedbackSubmissionStatus.DRAFT,
        submittedAt: null,
      },
      db
    );

    const data = client.onlyCallTo("feedbackSubmission", "create").args.data as Record<
      string,
      unknown
    >;

    for (const [key, value] of Object.entries(KEY)) {
      assert.equal(data[key], value, key);
    }
    assert.equal(data.tenantId, TENANT_ID);
  });

  it("clears submittedAt when a submission returns to DRAFT", async () => {
    const { client, db } = fake();

    await repository.updateSubmissionStatus(
      TENANT_ID,
      SUBMISSION_ID,
      FeedbackSubmissionStatus.DRAFT,
      null,
      db
    );

    const data = client.onlyCallTo("feedbackSubmission", "update").args.data as Record<
      string,
      unknown
    >;

    assert.equal(data.submittedAt, null);
  });
});

// --- Projections ------------------------------------------------------------

describe("FeedbackRepository — projections", () => {
  it("carries the weight a weighted score needs", () => {
    assert.equal(QUESTION_SELECT.weight, true);
  });

  it("carries isRequired, which is what makes completeness decidable", () => {
    assert.equal(QUESTION_SELECT.isRequired, true);
  });

  it("carries the category a rollup groups by", () => {
    assert.equal(QUESTION_SELECT.category, true);
  });

  it("carries the rating and its question on an answer", () => {
    assert.equal(ANSWER_SELECT.rating, true);
    assert.equal(ANSWER_SELECT.questionId, true);
  });

  it("never projects a student relation from a submission", () => {
    // Not even nested — a relation would reintroduce the identity the anonymous
    // projection exists to withhold.
    assert.equal("student" in ANONYMOUS_SUBMISSION_SELECT, false);
    assert.equal("student" in ATTRIBUTED_SUBMISSION_SELECT, false);
  });
});
