// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Feedback System
// LAYER  : Validation — Unit Tests
// PURPOSE: Prove the boundary refuses an incoherent answer set, and that no
//          request can ask for a student's identity.
//
//          Two suites carry the weight. The rating bound, because every
//          aggregate downstream assumes 1..5 and a 7 would silently skew a
//          faculty member's score. And the absence of any identity parameter,
//          because a request able to ASK for attribution is a request someone
//          eventually grants.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FeedbackCategory,
  FeedbackFormStatus,
  SessionType,
} from "@/app/generated/prisma/enums";
import {
  MAX_COMMENT_LENGTH,
  MAX_QUESTIONS_PER_FORM,
  MIN_SUBMISSIONS_FOR_FACULTY_VIEW,
  RATING_MAX,
  RATING_MIN,
  RATING_SPAN,
} from "@/lib/constants/feedback";
import {
  FORBIDDEN_IDENTITY_KEYS,
  STUDENT_FACING_SCHEMAS,
  facultyFeedbackQuerySchema,
  facultyParamSchema,
  feedbackReportQuerySchema,
  listFormsQuerySchema,
  submitFeedbackSchema,
} from "@/lib/validations/feedback.validation";

/** A well-formed submission of `count` answers. */
function submission(count: number, overrides: Record<string, unknown> = {}) {
  return {
    formId: "form_1",
    facultyId: "faculty_1",
    courseId: "course_1",
    semesterId: "sem_1",
    answers: Array.from({ length: count }, (_value, index) => ({
      questionId: `q${index}`,
      rating: 4,
    })),
    ...overrides,
  };
}

// --- The rating scale -------------------------------------------------------

describe("the rating scale is declared once and enforced", () => {
  it("is 1..5", () => {
    assert.equal(RATING_MIN, 1);
    assert.equal(RATING_MAX, 5);
  });

  it("derives its span rather than hardcoding it", () => {
    // So a scale change moves one number, not two.
    assert.equal(RATING_SPAN, RATING_MAX - RATING_MIN);
  });

  it("accepts every value on the scale", () => {
    for (let rating = RATING_MIN; rating <= RATING_MAX; rating += 1) {
      const body = submission(1, { answers: [{ questionId: "q1", rating }] });

      assert.equal(submitFeedbackSchema.safeParse(body).success, true, String(rating));
    }
  });

  it("REJECTS a rating above the scale", () => {
    // Every aggregate downstream assumes the bound; a 7 would silently skew a
    // faculty member's score.
    for (const rating of [6, 10, 100]) {
      const body = submission(1, { answers: [{ questionId: "q1", rating }] });

      assert.equal(submitFeedbackSchema.safeParse(body).success, false, String(rating));
    }
  });

  it("REJECTS a rating below the scale", () => {
    for (const rating of [0, -1]) {
      const body = submission(1, { answers: [{ questionId: "q1", rating }] });

      assert.equal(submitFeedbackSchema.safeParse(body).success, false, String(rating));
    }
  });

  it("REJECTS a fractional rating", () => {
    // The column is SMALLINT. A 4.5 would round on write and the student's
    // answer would not be what they gave.
    const body = submission(1, { answers: [{ questionId: "q1", rating: 4.5 }] });

    assert.equal(submitFeedbackSchema.safeParse(body).success, false);
  });

  it("REJECTS a non-numeric rating", () => {
    for (const rating of ["4", null, true, {}]) {
      const body = submission(1, { answers: [{ questionId: "q1", rating }] });

      assert.equal(submitFeedbackSchema.safeParse(body).success, false, JSON.stringify(rating));
    }
  });
});

// --- The answer set ---------------------------------------------------------

describe("submitFeedbackSchema — the answer set", () => {
  it("accepts a well-formed submission", () => {
    assert.equal(submitFeedbackSchema.safeParse(submission(3)).success, true);
  });

  it("REJECTS the same question answered twice", () => {
    // Which rating counts? The question has no answer, so the request has no
    // meaning.
    const body = submission(0, {
      answers: [
        { questionId: "q1", rating: 5 },
        { questionId: "q1", rating: 1 },
      ],
    });

    const parsed = submitFeedbackSchema.safeParse(body);

    assert.equal(parsed.success, false);
    if (!parsed.success) {
      assert.ok(
        parsed.error.issues.some((issue) => issue.message.includes("only once")),
        "the message does not explain what is wrong"
      );
    }
  });

  it("ACCEPTS a partial submission — completeness needs the question set", () => {
    // A missing required answer is decidable only against the form, so a
    // partial submission is valid input that produces a DRAFT rather than a 400.
    assert.equal(
      submitFeedbackSchema.safeParse(submission(1, { isFinal: false })).success,
      true
    );
  });

  it("REFUSES an empty answer set", () => {
    const body = submission(0, { answers: [] });

    assert.equal(submitFeedbackSchema.safeParse(body).success, false);
  });

  it("bounds the answer set at the form maximum", () => {
    assert.equal(
      submitFeedbackSchema.safeParse(submission(MAX_QUESTIONS_PER_FORM)).success,
      true
    );
    assert.equal(
      submitFeedbackSchema.safeParse(submission(MAX_QUESTIONS_PER_FORM + 1)).success,
      false
    );
  });

  it("defaults isFinal to true, because submitting is the ordinary act", () => {
    const parsed = submitFeedbackSchema.safeParse(submission(1));

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.isFinal, true);
    }
  });

  it("accepts an explicit draft", () => {
    const parsed = submitFeedbackSchema.safeParse(submission(1, { isFinal: false }));

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.isFinal, false);
    }
  });
});

describe("submitFeedbackSchema — comments", () => {
  it("accepts a comment", () => {
    const body = submission(0, {
      answers: [{ questionId: "q1", rating: 5, comment: "Very clear" }],
    });

    assert.equal(submitFeedbackSchema.safeParse(body).success, true);
  });

  it("trims a comment", () => {
    const body = submission(0, {
      answers: [{ questionId: "q1", rating: 5, comment: "  Clear  " }],
    });

    const parsed = submitFeedbackSchema.safeParse(body);

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.answers[0].comment, "Clear");
    }
  });

  it("REJECTS a whitespace-only comment rather than storing an empty one", () => {
    const body = submission(0, {
      answers: [{ questionId: "q1", rating: 5, comment: "   " }],
    });

    assert.equal(submitFeedbackSchema.safeParse(body).success, false);
  });

  it("bounds a comment's length", () => {
    const long = (over: number) =>
      submission(0, {
        answers: [
          { questionId: "q1", rating: 5, comment: "x".repeat(MAX_COMMENT_LENGTH + over) },
        ],
      });

    assert.equal(submitFeedbackSchema.safeParse(long(0)).success, true);
    assert.equal(submitFeedbackSchema.safeParse(long(1)).success, false);
  });
});

describe("submitFeedbackSchema — context and strictness", () => {
  it("requires all four context ids", () => {
    for (const key of ["formId", "facultyId", "courseId", "semesterId"]) {
      const body = submission(1) as Record<string, unknown>;
      delete body[key];

      assert.equal(submitFeedbackSchema.safeParse(body).success, false, key);
    }
  });

  it("rejects an empty context id", () => {
    assert.equal(
      submitFeedbackSchema.safeParse(submission(1, { facultyId: "  " })).success,
      false
    );
  });

  it("is STRICT — a misspelled key on this write is a 400", () => {
    // This write records an opinion attributed to a person. A quietly corrected
    // request is worse than a rejected one.
    assert.equal(
      submitFeedbackSchema.safeParse(submission(1, { semseterId: "sem_2" })).success,
      false
    );
  });

  it("is strict on an ANSWER too", () => {
    const body = submission(0, {
      answers: [{ questionId: "q1", rating: 5, score: 9 }],
    });

    assert.equal(submitFeedbackSchema.safeParse(body).success, false);
  });

  it("ONE schema serves both endpoints, so they cannot drift", () => {
    // /faculty and /lab differ only in which FORM they target — a property of
    // the form the caller names, not of the request shape.
    assert.equal(STUDENT_FACING_SCHEMAS.length, 1);
    assert.equal(STUDENT_FACING_SCHEMAS[0], submitFeedbackSchema);
  });
});

// --- No request may ask for an identity -------------------------------------

describe("no request may name a student or ask for attribution", () => {
  it("REJECTS an identity key on the write path", () => {
    // Strict, so it is a 400 rather than a silent strip.
    for (const key of FORBIDDEN_IDENTITY_KEYS) {
      const body = submission(1, { [key]: "victim" });

      assert.equal(submitFeedbackSchema.safeParse(body).success, false, key);
    }
  });

  it("STRIPS an identity key on every read path", () => {
    const hostile = Object.fromEntries(
      FORBIDDEN_IDENTITY_KEYS.map((key) => [key, "victim"])
    );

    for (const schema of [
      facultyFeedbackQuerySchema,
      feedbackReportQuerySchema,
      facultyParamSchema,
    ]) {
      const parsed = schema.safeParse({ facultyId: "faculty_1", ...hostile });

      assert.equal(parsed.success, true);
      if (parsed.success) {
        for (const key of FORBIDDEN_IDENTITY_KEYS) {
          assert.equal(key in parsed.data, false, `${key} survived validation`);
        }
      }
    }
  });

  it("offers NO flag that could request attribution", () => {
    // Whether a caller sees identity is decided by their ROLE, in the service.
    // A request parameter able to ask for it is one someone eventually grants.
    const parsed = facultyFeedbackQuerySchema.safeParse({
      includeStudentIdentity: "true",
      attributed: "true",
      anonymous: "false",
    });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.deepEqual(Object.keys(parsed.data), []);
    }
  });

  it("names the three keys no request may supply", () => {
    assert.deepEqual([...FORBIDDEN_IDENTITY_KEYS], ["studentId", "userId", "tenantId"]);
  });
});

// --- Read schemas -----------------------------------------------------------

describe("facultyFeedbackQuerySchema", () => {
  it("accepts an empty query — a faculty member's whole record", () => {
    assert.equal(facultyFeedbackQuerySchema.safeParse({}).success, true);
  });

  it("accepts the three narrowing filters", () => {
    const parsed = facultyFeedbackQuerySchema.safeParse({
      courseId: "course_1",
      semesterId: "sem_1",
      formId: "form_1",
    });

    assert.equal(parsed.success, true);
  });

  it("STRIPS an unknown key rather than rejecting a read", () => {
    const parsed = facultyFeedbackQuerySchema.safeParse({ _t: "1730000000" });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal("_t" in parsed.data, false);
    }
  });
});

describe("feedbackReportQuerySchema", () => {
  it("accepts every scope filter", () => {
    const parsed = feedbackReportQuerySchema.safeParse({
      formId: "form_1",
      semesterId: "sem_1",
      courseId: "course_1",
      facultyId: "faculty_1",
      departmentId: "dept_1",
      category: FeedbackCategory.TEACHING,
    });

    assert.equal(parsed.success, true);
  });

  it("accepts every category the enum declares", () => {
    for (const category of Object.values(FeedbackCategory)) {
      assert.equal(
        feedbackReportQuerySchema.safeParse({ category }).success,
        true,
        category
      );
    }
  });

  it("rejects a category outside the enum", () => {
    assert.equal(
      feedbackReportQuerySchema.safeParse({ category: "PUNCTUALITY" }).success,
      false
    );
  });

  it("accepts an empty query — the whole tenant", () => {
    assert.equal(feedbackReportQuerySchema.safeParse({}).success, true);
  });
});

describe("listFormsQuerySchema", () => {
  it("applies pagination defaults from the SHARED schema", () => {
    const parsed = listFormsQuerySchema.safeParse({});

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.page, 1);
      assert.equal(parsed.data.limit, 20);
    }
  });

  it("rejects a limit above the shared maximum", () => {
    assert.equal(listFormsQuerySchema.safeParse({ limit: "101" }).success, false);
  });

  it("accepts every form status and session type", () => {
    for (const status of Object.values(FeedbackFormStatus)) {
      assert.equal(listFormsQuerySchema.safeParse({ status }).success, true, status);
    }

    for (const sessionType of Object.values(SessionType)) {
      assert.equal(
        listFormsQuerySchema.safeParse({ sessionType }).success,
        true,
        sessionType
      );
    }
  });

  it("rejects a status outside the lifecycle", () => {
    assert.equal(listFormsQuerySchema.safeParse({ status: "ARCHIVED" }).success, false);
  });
});

describe("facultyParamSchema", () => {
  it("accepts an UNRECOGNISED but well-formed id", () => {
    // FacultyMember.id is an opaque cuid; rejecting here would turn a 404 into
    // a 400 and tell a client the id was malformed when it was merely absent.
    assert.equal(facultyParamSchema.safeParse({ facultyId: "does-not-exist" }).success, true);
  });

  it("rejects an empty or missing id", () => {
    assert.equal(facultyParamSchema.safeParse({ facultyId: "" }).success, false);
    assert.equal(facultyParamSchema.safeParse({}).success, false);
  });
});

// --- The disclosure threshold -----------------------------------------------

describe("the disclosure threshold", () => {
  it("is five, per the Phase 20 decision", () => {
    assert.equal(MIN_SUBMISSIONS_FOR_FACULTY_VIEW, 5);
  });

  it("is greater than one, or anonymity would be nominal", () => {
    // With a cohort of one, a faculty member knows exactly who spoke.
    assert.ok(MIN_SUBMISSIONS_FOR_FACULTY_VIEW > 1);
  });
});
