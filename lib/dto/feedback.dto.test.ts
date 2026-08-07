// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Feedback System
// LAYER  : DTO — Unit Tests
// PURPOSE: Prove the boundary conversion, and that the anonymous shape cannot
//          carry an identity.
//
//          The anonymity suite is the one that matters. It asserts not merely
//          that `toSubmissionDto` omits studentId today, but that it CANNOT
//          emit one — the parameter type has no such property, so a later edit
//          reaching for it would fail to compile rather than leak.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Prisma } from "@/app/generated/prisma/client";
import {
  FeedbackCategory,
  FeedbackFormStatus,
  FeedbackSubmissionStatus,
  SessionType,
} from "@/app/generated/prisma/enums";
import {
  isoDate,
  toAnswerDto,
  toAttributedSubmissionDto,
  toFormDto,
  toMyFeedbackDto,
  toQuestionDto,
  toSubmissionDto,
  weight,
} from "@/lib/dto/feedback.dto";

const NOW = new Date("2026-08-09T00:00:00.000Z");
const PAST = new Date("2026-01-01T00:00:00.000Z");

function questionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "q1",
    formId: "form_1",
    code: "TEACH_CLARITY",
    text: "Explains concepts clearly",
    category: FeedbackCategory.TEACHING,
    weight: new Prisma.Decimal("1.50"),
    sequence: 1,
    isRequired: true,
    allowsComment: false,
    ...overrides,
  } as Parameters<typeof toQuestionDto>[0];
}

function formRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "form_1",
    tenantId: "tenant_1",
    code: "FB2026",
    name: "Faculty Feedback 2026",
    description: null,
    version: 2,
    status: FeedbackFormStatus.OPEN,
    sessionType: SessionType.LECTURE,
    statusChangedAt: PAST,
    createdAt: PAST,
    updatedAt: PAST,
    questions: [questionRow()],
    ...overrides,
  } as Parameters<typeof toFormDto>[0];
}

function anonymousRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    formId: "form_1",
    facultyId: "faculty_1",
    courseId: "course_1",
    semesterId: "sem_1",
    status: FeedbackSubmissionStatus.SUBMITTED,
    submittedAt: NOW,
    createdAt: PAST,
    ...overrides,
  } as Parameters<typeof toSubmissionDto>[0];
}

function answerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    submissionId: "sub_1",
    questionId: "q1",
    rating: 4,
    comment: null,
    ...overrides,
  } as Parameters<typeof toAnswerDto>[0];
}

// --- Anonymity --------------------------------------------------------------

describe("feedback DTO — the anonymous shape cannot carry an identity", () => {
  it("omits studentId from a mapped submission", () => {
    const dto = toSubmissionDto(anonymousRow());

    assert.equal("studentId" in dto, false);
  });

  it("omits it even when the row object happens to carry one at runtime", () => {
    // The TYPE has no studentId, so the mapper never reads it. This proves the
    // omission survives a row that was over-selected by mistake.
    const dto = toSubmissionDto(
      anonymousRow({ studentId: "student_secret" } as Record<string, unknown>)
    );

    assert.equal("studentId" in dto, false);
    assert.equal(JSON.stringify(dto).includes("student_secret"), false);
  });

  it("the ATTRIBUTED mapper is a separate function, not a flag", () => {
    // A boolean parameter is a thing a caller can pass wrongly; a function name
    // is something a reviewer notices.
    const dto = toAttributedSubmissionDto({
      ...anonymousRow(),
      studentId: "student_1",
    } as Parameters<typeof toAttributedSubmissionDto>[0]);

    assert.equal(dto.studentId, "student_1");
  });

  it("the attributed shape extends the anonymous one by exactly one key", () => {
    const anonymous = toSubmissionDto(anonymousRow());
    const attributed = toAttributedSubmissionDto({
      ...anonymousRow(),
      studentId: "student_1",
    } as Parameters<typeof toAttributedSubmissionDto>[0]);

    assert.deepEqual(
      Object.keys(attributed).filter((key) => !(key in anonymous)),
      ["studentId"]
    );
  });

  it("a student's own view uses the ANONYMOUS shape", () => {
    // They already know who they are; echoing an identity serves nothing while
    // widening the surface on which one could leak.
    const dto = toMyFeedbackDto(anonymousRow(), [answerRow()], true);

    assert.ok(dto.submission);
    assert.equal("studentId" in (dto.submission ?? {}), false);
  });
});

// --- Forms and questions ----------------------------------------------------

describe("toFormDto", () => {
  it("derives acceptsSubmissions from the status", () => {
    assert.equal(toFormDto(formRow()).acceptsSubmissions, true);

    for (const status of [FeedbackFormStatus.DRAFT, FeedbackFormStatus.CLOSED]) {
      assert.equal(
        toFormDto(formRow({ status })).acceptsSubmissions,
        false,
        status
      );
    }
  });

  it("carries the sessionType that separates faculty feedback from lab", () => {
    assert.equal(toFormDto(formRow()).sessionType, SessionType.LECTURE);
    assert.equal(
      toFormDto(formRow({ sessionType: SessionType.LAB })).sessionType,
      SessionType.LAB
    );
  });

  it("carries the version, so a historical analytic can name what it read", () => {
    assert.equal(toFormDto(formRow()).version, 2);
  });

  it("nests the questions", () => {
    const dto = toFormDto(formRow());

    assert.equal(dto.questions.length, 1);
    assert.equal(dto.questions[0].code, "TEACH_CLARITY");
  });

  it("handles a form with no questions yet", () => {
    assert.deepEqual(toFormDto(formRow({ questions: [] })).questions, []);
  });

  it("carries no Prisma value across the boundary", () => {
    const dto = toFormDto(formRow());

    assert.equal(typeof dto.statusChangedAt, "string");
    assert.equal(typeof dto.createdAt, "string");
    assert.equal(typeof dto.questions[0].weight, "string");
  });

  it("round-trips through JSON unchanged", () => {
    const dto = toFormDto(formRow());

    assert.deepEqual(JSON.parse(JSON.stringify(dto)), dto);
  });
});

describe("toQuestionDto", () => {
  it("renders the weight as a lossless string", () => {
    // A weight is Decimal(5,2); a JSON number would hand back the float problem.
    assert.equal(toQuestionDto(questionRow()).weight, "1.50");
    assert.equal(typeof toQuestionDto(questionRow()).weight, "string");
  });

  it("keeps a trailing zero so a column aligns", () => {
    assert.equal(
      toQuestionDto(questionRow({ weight: new Prisma.Decimal("2") })).weight,
      "2.00"
    );
  });

  it("carries every category the enum declares", () => {
    for (const category of Object.values(FeedbackCategory)) {
      assert.equal(toQuestionDto(questionRow({ category })).category, category);
    }
  });

  it("carries isRequired, which makes completeness decidable", () => {
    assert.equal(toQuestionDto(questionRow()).isRequired, true);
    assert.equal(
      toQuestionDto(questionRow({ isRequired: false })).isRequired,
      false
    );
  });

  it("does not echo the formId back to a caller who asked for the form", () => {
    assert.equal("formId" in toQuestionDto(questionRow()), false);
  });
});

describe("weight and isoDate", () => {
  it("renders a null weight as zero rather than null", () => {
    // A question always has a weight; a null here means a projection missed it,
    // and zero is the neutral value a rollup can survive.
    assert.equal(weight(null), "0.00");
  });

  it("renders a Date as ISO-8601", () => {
    assert.equal(isoDate(NOW), "2026-08-09T00:00:00.000Z");
  });

  it("preserves null and undefined alike", () => {
    assert.equal(isoDate(null), null);
    assert.equal(isoDate(undefined), null);
  });
});

// --- Submissions and answers ------------------------------------------------

describe("toSubmissionDto", () => {
  it("carries the three context axes", () => {
    const dto = toSubmissionDto(anonymousRow());

    assert.equal(dto.facultyId, "faculty_1");
    assert.equal(dto.courseId, "course_1");
    assert.equal(dto.semesterId, "sem_1");
  });

  it("preserves a null submittedAt for a DRAFT", () => {
    const dto = toSubmissionDto(
      anonymousRow({ status: FeedbackSubmissionStatus.DRAFT, submittedAt: null })
    );

    assert.equal(dto.submittedAt, null);
    assert.equal(dto.status, FeedbackSubmissionStatus.DRAFT);
  });

  it("OMITS the answers key entirely when none were supplied", () => {
    // Absent and empty mean different things: "not requested" versus "answered
    // nothing". A client rendering a detail view must be able to tell them
    // apart.
    const dto = toSubmissionDto(anonymousRow());

    assert.equal("answers" in dto, false);
  });

  it("includes answers when they were supplied", () => {
    const dto = toSubmissionDto(anonymousRow(), [answerRow(), answerRow({ id: "a2" })]);

    assert.equal(dto.answers?.length, 2);
  });

  it("includes an EMPTY answers array when an empty set was supplied", () => {
    const dto = toSubmissionDto(anonymousRow(), []);

    assert.deepEqual(dto.answers, []);
  });

  it("round-trips through JSON unchanged", () => {
    const dto = toSubmissionDto(anonymousRow(), [answerRow()]);

    assert.deepEqual(JSON.parse(JSON.stringify(dto)), dto);
  });
});

describe("toAnswerDto", () => {
  it("carries the rating as a number", () => {
    // 1..5 is a small integer with no fractional part to lose, unlike money or
    // a GPA. Any AVERAGE of these crosses the boundary as a string instead.
    const dto = toAnswerDto(answerRow());

    assert.equal(dto.rating, 4);
    assert.equal(typeof dto.rating, "number");
  });

  it("preserves a null comment", () => {
    assert.equal(toAnswerDto(answerRow()).comment, null);
  });

  it("carries a comment where one was given", () => {
    assert.equal(
      toAnswerDto(answerRow({ comment: "Very approachable" })).comment,
      "Very approachable"
    );
  });

  it("does not echo the answer's own id or submission back", () => {
    const dto = toAnswerDto(answerRow());

    assert.equal("id" in dto, false);
    assert.equal("submissionId" in dto, false);
  });
});

describe("toMyFeedbackDto", () => {
  it("reports a null submission for a student who has not started", () => {
    const dto = toMyFeedbackDto(null, [], true);

    assert.equal(dto.submission, null);
    assert.deepEqual(dto.answers, []);
    assert.equal(dto.isEditable, true);
  });

  it("carries the editability the form's status decided", () => {
    // Computed by the caller from the form, not re-derived here — one rule,
    // one place.
    assert.equal(toMyFeedbackDto(anonymousRow(), [], false).isEditable, false);
  });

  it("carries the student's own answers back for editing", () => {
    const dto = toMyFeedbackDto(anonymousRow(), [answerRow(), answerRow({ id: "a2" })], true);

    assert.equal(dto.answers.length, 2);
  });

  it("round-trips through JSON unchanged", () => {
    const dto = toMyFeedbackDto(anonymousRow(), [answerRow()], true);

    assert.deepEqual(JSON.parse(JSON.stringify(dto)), dto);
  });
});
