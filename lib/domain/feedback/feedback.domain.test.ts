// ============================================================================
// OWNER  : Gauransh
// MODULE : Feedback — Domain
// LAYER  : Domain — Unit Tests
// PURPOSE: Prove the four rules the phase rests on:
//
//   1. every average is EXACT — no float ever touches a rating
//   2. a category with one question weighs the same as one with nine
//   3. an aggregate is WITHHELD below the threshold, not emptied
//   4. a null CGPA-style absence is never substituted with a zero
//
// These modules import no Prisma client and no HTTP, so all of this runs with
// no database and no environment.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FeedbackCategory } from "@/app/generated/prisma/enums";
import {
  FEEDBACK_VIEWER,
  MIN_SUBMISSIONS_FOR_FACULTY_VIEW,
  RATING_MAX,
  RATING_MIN,
} from "@/lib/constants/feedback";
import {
  distribution,
  extremes,
  formatRating,
  mean,
  meanOfScaled,
  median,
  responseRate,
  weightedMean,
} from "@/lib/domain/feedback/statistics";
import {
  analyse,
  scoreCategories,
  scoreQuestions,
  type AnalyticAnswer,
  type AnalyticQuestion,
} from "@/lib/domain/feedback/analytics";
import {
  WITHHOLDING_REASON,
  evaluateAccess,
  evaluateDisclosure,
  mayViewAttribution,
  withhold,
} from "@/lib/domain/feedback/anonymity";
import {
  INELIGIBILITY_REASON,
  evaluateEligibility,
  type EligibilityInput,
} from "@/lib/domain/feedback/eligibility";
import {
  COMPLETION_PROBLEM,
  evaluateCompletion,
  resolveStatus,
} from "@/lib/domain/feedback/completion";
import {
  isSummaryCoherent,
  summariseAggregate,
  summariseFaculty,
  type SubmissionWithAnswers,
} from "@/lib/domain/feedback/report";

// --- Statistics: exactness --------------------------------------------------

describe("statistics — every average is exact", () => {
  it("computes a mean at two places", () => {
    // Three 4s and two 5s: 22/5 = 4.4.
    assert.equal(formatRating(mean([4, 4, 4, 5, 5])), "4.40");
  });

  it("rounds a repeating quotient ONCE, predictably", () => {
    // 30/7 = 4.285714... A float would let one caller see 4.29 and another 4.28.
    assert.equal(formatRating(mean([4, 4, 4, 4, 5, 5, 4])), "4.29");
  });

  it("survives a set a float would corrupt", () => {
    // Ten 3s and ten 4s is exactly 3.50, not 3.4999999999999996.
    const ratings = [...Array(10).fill(3), ...Array(10).fill(4)];

    assert.equal(formatRating(mean(ratings)), "3.50");
  });

  it("returns NULL, not zero, for an empty set", () => {
    // A faculty member with no responses has no average; 0.00 would put them
    // bottom of a comparison they never entered.
    assert.equal(mean([]), null);
    assert.equal(formatRating(mean([])), null);
  });

  it("renders as a STRING, never a number", () => {
    assert.equal(typeof formatRating(mean([4])), "string");
  });
});

describe("statistics — median", () => {
  it("takes the middle of an odd-sized set", () => {
    assert.equal(formatRating(median([1, 4, 5])), "4.00");
  });

  it("takes the exact mean of the middle pair of an even set", () => {
    // 4 and 5 must give 4.50, not 4.4999999.
    assert.equal(formatRating(median([1, 4, 5, 5])), "4.50");
  });

  it("is null for an empty set", () => {
    assert.equal(median([]), null);
  });

  it("does not mutate the caller's array", () => {
    const ratings = [5, 1, 3];
    median(ratings);

    assert.equal(ratings[0], 5);
  });
});

describe("statistics — distribution", () => {
  it("includes EVERY value on the scale, even those nobody chose", () => {
    // A histogram missing its empty bars is one a reader misinterprets.
    const result = distribution([5, 5, 4]);

    for (let value = RATING_MIN; value <= RATING_MAX; value += 1) {
      assert.ok(result.counts.has(value), `${value} is missing a bar`);
    }

    assert.equal(result.counts.get(1), 0);
    assert.equal(result.counts.get(5), 2);
    assert.equal(result.total, 3);
  });

  it("reports an empty set as all zeroes rather than no bars", () => {
    const result = distribution([]);

    assert.equal(result.counts.size, RATING_MAX - RATING_MIN + 1);
    assert.equal(result.total, 0);
  });

  it("keeps the TOTAL honest when a rating is off-scale", () => {
    // Unreachable through validation, but the bars and the count beside them
    // must not disagree if it ever happened.
    const result = distribution([4, 9]);

    assert.equal(result.total, 2);
    assert.equal(result.counts.get(4), 1);
  });
});

describe("statistics — response rate and weighted mean", () => {
  it("computes a rate as a percentage", () => {
    assert.equal(formatRating(responseRate(3, 4)), "75.00");
  });

  it("returns NULL for an empty cohort rather than 0%", () => {
    // A rate over nobody is undefined, not a failure of engagement.
    assert.equal(responseRate(0, 0), null);
  });

  it("weights terms by their declared weight", () => {
    // 5 at weight 3, 1 at weight 1 -> (15+1)/4 = 4.00.
    assert.equal(
      formatRating(weightedMean([
        { weightScaled: 300, value: 5 },
        { weightScaled: 100, value: 1 },
      ])),
      "4.00"
    );
  });

  it("returns null when every weight is zero", () => {
    assert.equal(weightedMean([{ weightScaled: 0, value: 5 }]), null);
  });

  it("meanOfScaled does NOT lift already-scaled values again", () => {
    // 4.20 and 4.40 average 4.30. Feeding these to `mean` would give 0.04.
    assert.equal(formatRating(meanOfScaled([420, 440])), "4.30");
  });

  it("reports extremes, or null for an empty set", () => {
    assert.deepEqual(extremes([3, 5, 1]), { highest: 5, lowest: 1 });
    assert.equal(extremes([]), null);
  });
});

// --- Analytics: the weighting rule ------------------------------------------

describe("analytics — a small category is not drowned by a large one", () => {
  const questions: AnalyticQuestion[] = [
    ...Array.from({ length: 9 }, (_value, index) => ({
      id: `t${index}`,
      code: `TEACH_${index}`,
      category: FeedbackCategory.TEACHING,
      weightScaled: 100,
    })),
    {
      id: "b1",
      code: "BEHAVE_1",
      category: FeedbackCategory.BEHAVIOUR,
      weightScaled: 100,
    },
  ];

  it("counts each CATEGORY once in the overall average", () => {
    // Nine Teaching questions at 5, one Behaviour at 1. Averaging raw answers
    // would give 4.60 and call Behaviour almost irrelevant; averaging the two
    // CATEGORY scores gives 3.00, which is what the tenant meant by asking
    // about both.
    const answers: AnalyticAnswer[] = [
      ...questions.slice(0, 9).map((question) => ({ questionId: question.id, rating: 5 })),
      { questionId: "b1", rating: 1 },
    ];

    const result = analyse(answers, questions);

    assert.equal(formatRating(result.overallAverage), "3.00");
  });

  it("scores each category independently", () => {
    const answers: AnalyticAnswer[] = [
      { questionId: "t0", rating: 5 },
      { questionId: "b1", rating: 1 },
    ];

    const categories = scoreCategories(answers, questions);
    const byCategory = new Map(categories.map((entry) => [entry.category, entry]));

    assert.equal(formatRating(byCategory.get(FeedbackCategory.TEACHING)?.average ?? null), "5.00");
    assert.equal(formatRating(byCategory.get(FeedbackCategory.BEHAVIOUR)?.average ?? null), "1.00");
  });

  it("weights questions WITHIN a category", () => {
    const weighted: AnalyticQuestion[] = [
      { id: "q1", code: "A", category: FeedbackCategory.TEACHING, weightScaled: 300 },
      { id: "q2", code: "B", category: FeedbackCategory.TEACHING, weightScaled: 100 },
    ];

    // 5 at weight 3, 1 at weight 1 -> 4.00.
    const categories = scoreCategories(
      [
        { questionId: "q1", rating: 5 },
        { questionId: "q2", rating: 1 },
      ],
      weighted
    );

    assert.equal(formatRating(categories[0].average), "4.00");
  });

  it("weights a question's OWN AVERAGE, not each raw answer", () => {
    // Otherwise a question's influence would depend on how many people answered
    // it as well as on its weight — two variables where the tenant set one.
    const weighted: AnalyticQuestion[] = [
      { id: "q1", code: "A", category: FeedbackCategory.TEACHING, weightScaled: 100 },
      { id: "q2", code: "B", category: FeedbackCategory.TEACHING, weightScaled: 100 },
    ];

    // q1 answered five times at 5; q2 once at 1. Equal weights -> 3.00.
    const categories = scoreCategories(
      [
        ...Array.from({ length: 5 }, () => ({ questionId: "q1", rating: 5 })),
        { questionId: "q2", rating: 1 },
      ],
      weighted
    );

    assert.equal(formatRating(categories[0].average), "3.00");
  });

  it("DROPS an answer citing a question outside the set", () => {
    const scores = scoreQuestions([{ questionId: "ghost", rating: 5 }], questions);

    assert.deepEqual(scores, []);
  });

  it("omits a question nobody answered rather than scoring it null", () => {
    const scores = scoreQuestions([{ questionId: "t0", rating: 4 }], questions);

    assert.equal(scores.length, 1);
    assert.equal(scores[0].questionId, "t0");
  });

  it("orders deterministically, so two runs are the same document", () => {
    const answers: AnalyticAnswer[] = [
      { questionId: "b1", rating: 3 },
      { questionId: "t0", rating: 4 },
    ];

    assert.deepEqual(
      scoreQuestions(answers, questions).map((score) => score.code),
      scoreQuestions([...answers].reverse(), questions).map((score) => score.code)
    );
  });

  it("returns nulls rather than zeroes for no answers at all", () => {
    const result = analyse([], questions);

    assert.equal(result.overallAverage, null);
    assert.equal(result.median, null);
    assert.equal(result.highest, null);
    assert.equal(result.answerCount, 0);
  });
});

// --- Anonymity --------------------------------------------------------------

describe("anonymity — the threshold", () => {
  it("WITHHOLDS from a faculty member below the threshold", () => {
    const verdict = evaluateDisclosure(FEEDBACK_VIEWER.FACULTY, 3);

    assert.equal(verdict.isVisible, false);
    assert.equal(verdict.reason, WITHHOLDING_REASON.BELOW_THRESHOLD);
    assert.equal(verdict.shortfall, MIN_SUBMISSIONS_FOR_FACULTY_VIEW - 3);
  });

  it("discloses at exactly the threshold", () => {
    assert.equal(
      evaluateDisclosure(FEEDBACK_VIEWER.FACULTY, MIN_SUBMISSIONS_FOR_FACULTY_VIEW)
        .isVisible,
      true
    );
  });

  it("gates a DEPARTMENT HEAD the same way", () => {
    // The risk — a colleague who knows the roster inferring an author — is
    // identical.
    assert.equal(evaluateDisclosure(FEEDBACK_VIEWER.HOD, 4).isVisible, false);
  });

  it("NEVER gates an admin", () => {
    for (const count of [0, 1, 4]) {
      assert.equal(
        evaluateDisclosure(FEEDBACK_VIEWER.ADMIN, count).isVisible,
        true,
        String(count)
      );
    }
  });

  it("reports the shortfall, so a portal can say how many more are needed", () => {
    assert.equal(evaluateDisclosure(FEEDBACK_VIEWER.FACULTY, 0).shortfall, 5);
    assert.equal(evaluateDisclosure(FEEDBACK_VIEWER.FACULTY, 4).shortfall, 1);
  });
});

describe("anonymity — ownership is checked BEFORE the threshold", () => {
  it("refuses a faculty member reading a COLLEAGUE", () => {
    const verdict = evaluateAccess(FEEDBACK_VIEWER.FACULTY, "faculty_1", "faculty_2", 50);

    assert.equal(verdict.isVisible, false);
    assert.equal(verdict.reason, WITHHOLDING_REASON.NOT_OWN_RECORD);
  });

  it("does NOT leak a colleague's response count through the shortfall", () => {
    // Refusing with "not enough responses" would confirm the colleague exists
    // and hint at how many they have.
    const verdict = evaluateAccess(FEEDBACK_VIEWER.FACULTY, "faculty_1", "faculty_2", 2);

    assert.equal(verdict.reason, WITHHOLDING_REASON.NOT_OWN_RECORD);
    assert.equal(verdict.shortfall, null);
  });

  it("admits a faculty member reading their OWN record, above threshold", () => {
    assert.equal(
      evaluateAccess(FEEDBACK_VIEWER.FACULTY, "faculty_1", "faculty_1", 7).isVisible,
      true
    );
  });

  it("still gates their own record below the threshold", () => {
    const verdict = evaluateAccess(FEEDBACK_VIEWER.FACULTY, "faculty_1", "faculty_1", 2);

    assert.equal(verdict.isVisible, false);
    assert.equal(verdict.reason, WITHHOLDING_REASON.BELOW_THRESHOLD);
  });

  it("refuses a faculty caller with no resolved faculty id", () => {
    assert.equal(
      evaluateAccess(FEEDBACK_VIEWER.FACULTY, null, "faculty_1", 50).isVisible,
      false
    );
  });

  it("does not apply ownership to an admin or a head", () => {
    assert.equal(evaluateAccess(FEEDBACK_VIEWER.ADMIN, null, "faculty_9", 1).isVisible, true);
    assert.equal(evaluateAccess(FEEDBACK_VIEWER.HOD, null, "faculty_9", 9).isVisible, true);
  });
});

describe("anonymity — attribution", () => {
  it("permits ONLY an admin to see who submitted", () => {
    assert.equal(mayViewAttribution(FEEDBACK_VIEWER.ADMIN), true);
    assert.equal(mayViewAttribution(FEEDBACK_VIEWER.FACULTY), false);
    assert.equal(mayViewAttribution(FEEDBACK_VIEWER.HOD), false);
  });

  it("withholds a payload behind a negative verdict", () => {
    const refused = evaluateDisclosure(FEEDBACK_VIEWER.FACULTY, 1);
    const allowed = evaluateDisclosure(FEEDBACK_VIEWER.ADMIN, 1);

    assert.equal(withhold(refused, { secret: true }), null);
    assert.deepEqual(withhold(allowed, { secret: true }), { secret: true });
  });
});

// --- Eligibility ------------------------------------------------------------

describe("eligibility", () => {
  const context = { facultyId: "f1", courseId: "c1", semesterId: "s1" };

  function input(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
    return {
      context,
      formIsOpen: true,
      formSessionType: "LECTURE",
      registrations: [{ courseId: "c1", semesterId: "s1", sectionId: "sec1" }],
      assignments: [
        { facultyId: "f1", courseId: "c1", sectionId: null, semesterId: "s1", isActive: true },
      ],
      sessions: [],
      hasExistingSubmission: false,
      existingIsSubmitted: false,
      ...overrides,
    };
  }

  it("admits a registered student taught by that faculty member", () => {
    assert.equal(evaluateEligibility(input()).isEligible, true);
  });

  it("refuses when the form is CLOSED", () => {
    const verdict = evaluateEligibility(input({ formIsOpen: false }));

    assert.equal(verdict.isEligible, false);
    assert.equal(verdict.reason, INELIGIBILITY_REASON.FORM_NOT_OPEN);
  });

  it("refuses a student who was not registered", () => {
    const verdict = evaluateEligibility(input({ registrations: [] }));

    assert.equal(verdict.reason, INELIGIBILITY_REASON.NOT_REGISTERED);
  });

  it("refuses when no assignment shows that faculty member taught it", () => {
    const verdict = evaluateEligibility(input({ assignments: [] }));

    assert.equal(verdict.reason, INELIGIBILITY_REASON.NOT_TAUGHT_BY_FACULTY);
  });

  it("treats a NULL semesterId on an assignment as 'any semester'", () => {
    // Getting this backwards would refuse every student of a department-wide
    // assignment — the ordinary arrangement.
    const verdict = evaluateEligibility(
      input({
        assignments: [
          { facultyId: "f1", courseId: "c1", sectionId: null, semesterId: null, isActive: true },
        ],
      })
    );

    assert.equal(verdict.isEligible, true);
  });

  it("ignores an INACTIVE assignment", () => {
    const verdict = evaluateEligibility(
      input({
        assignments: [
          { facultyId: "f1", courseId: "c1", sectionId: null, semesterId: "s1", isActive: false },
        ],
      })
    );

    assert.equal(verdict.reason, INELIGIBILITY_REASON.NOT_TAUGHT_BY_FACULTY);
  });

  it("refuses a LAB form when no LAB session took place", () => {
    // Reads Timetable.sessionType, not Course.type: a lab course taught only as
    // lectures should not collect lab feedback.
    const verdict = evaluateEligibility(
      input({ formSessionType: "LAB", sessions: [] })
    );

    assert.equal(verdict.reason, INELIGIBILITY_REASON.NO_LAB_SESSION);
  });

  it("admits a LAB form when a LAB session did take place", () => {
    const verdict = evaluateEligibility(
      input({
        formSessionType: "LAB",
        sessions: [
          {
            facultyId: "f1",
            courseId: "c1",
            semesterId: "s1",
            sectionId: "sec1",
            sessionType: "LAB",
            isActive: true,
          },
        ],
      })
    );

    assert.equal(verdict.isEligible, true);
  });

  it("does not accept a LECTURE session as evidence for a LAB form", () => {
    const verdict = evaluateEligibility(
      input({
        formSessionType: "LAB",
        sessions: [
          {
            facultyId: "f1",
            courseId: "c1",
            semesterId: "s1",
            sectionId: "sec1",
            sessionType: "LECTURE",
            isActive: true,
          },
        ],
      })
    );

    assert.equal(verdict.reason, INELIGIBILITY_REASON.NO_LAB_SESSION);
  });

  it("REFUSES a second submission once one is final", () => {
    const verdict = evaluateEligibility(
      input({ hasExistingSubmission: true, existingIsSubmitted: true })
    );

    assert.equal(verdict.reason, INELIGIBILITY_REASON.ALREADY_SUBMITTED);
  });

  it("admits an existing DRAFT as an EDIT", () => {
    const verdict = evaluateEligibility(
      input({ hasExistingSubmission: true, existingIsSubmitted: false })
    );

    assert.equal(verdict.isEligible, true);
    assert.equal(verdict.isEdit, true, "the caller must update, not insert");
  });

  it("reports the window before entitlement", () => {
    // A shut form is nobody's fault; hearing "not taught" first would send a
    // student to the wrong person.
    const verdict = evaluateEligibility(
      input({ formIsOpen: false, registrations: [], assignments: [] })
    );

    assert.equal(verdict.reason, INELIGIBILITY_REASON.FORM_NOT_OPEN);
  });
});

// --- Completion -------------------------------------------------------------

describe("completion", () => {
  const questions = [
    { id: "q1", isRequired: true, allowsComment: false },
    { id: "q2", isRequired: true, allowsComment: true },
    { id: "q3", isRequired: false, allowsComment: false },
  ];

  it("is COMPLETE when every required question is answered", () => {
    const verdict = evaluateCompletion(questions, [
      { questionId: "q1" },
      { questionId: "q2" },
    ]);

    assert.equal(verdict.isValid, true);
    assert.equal(verdict.isComplete, true);
    assert.deepEqual(verdict.missingRequired, []);
  });

  it("is VALID BUT INCOMPLETE when a required question is missing", () => {
    // A legitimate draft, not an error.
    const verdict = evaluateCompletion(questions, [{ questionId: "q1" }]);

    assert.equal(verdict.isValid, true);
    assert.equal(verdict.isComplete, false);
    assert.deepEqual(verdict.missingRequired, ["q2"]);
    assert.equal(verdict.problem, COMPLETION_PROBLEM.MISSING_REQUIRED);
  });

  it("does not require an OPTIONAL question", () => {
    const verdict = evaluateCompletion(questions, [
      { questionId: "q1" },
      { questionId: "q2" },
    ]);

    assert.equal(verdict.isComplete, true);
    assert.equal(verdict.missingRequired.includes("q3"), false);
  });

  it("REFUSES an answer citing a question not on the form", () => {
    // One of the two rules the schema could only state.
    const verdict = evaluateCompletion(questions, [{ questionId: "ghost" }]);

    assert.equal(verdict.isValid, false);
    assert.deepEqual(verdict.unknownQuestions, ["ghost"]);
    assert.equal(verdict.problem, COMPLETION_PROBLEM.UNKNOWN_QUESTION);
  });

  it("REFUSES a comment on a question that does not invite one", () => {
    // The other rule. Free text with no place to be displayed would sit in the
    // database unread forever.
    const verdict = evaluateCompletion(questions, [
      { questionId: "q1", comment: "unsolicited" },
    ]);

    assert.equal(verdict.isValid, false);
    assert.deepEqual(verdict.uninvitedComments, ["q1"]);
  });

  it("ACCEPTS a comment where the question invites one", () => {
    const verdict = evaluateCompletion(questions, [
      { questionId: "q1" },
      { questionId: "q2", comment: "Very clear" },
    ]);

    assert.equal(verdict.isValid, true);
  });

  it("treats a blank comment as absent rather than uninvited", () => {
    const verdict = evaluateCompletion(questions, [
      { questionId: "q1", comment: "   " },
      { questionId: "q2" },
    ]);

    assert.equal(verdict.isValid, true);
  });

  it("reports the WORST problem when several coincide", () => {
    const verdict = evaluateCompletion(questions, [{ questionId: "ghost", comment: "x" }]);

    assert.equal(verdict.problem, COMPLETION_PROBLEM.UNKNOWN_QUESTION);
  });

  it("resolves SUBMITTED only when finishing a complete set", () => {
    const complete = evaluateCompletion(questions, [
      { questionId: "q1" },
      { questionId: "q2" },
    ]);
    const partial = evaluateCompletion(questions, [{ questionId: "q1" }]);

    assert.equal(resolveStatus(complete, true), "SUBMITTED");
    assert.equal(resolveStatus(complete, false), "DRAFT", "saving progress stays a draft");
    assert.equal(
      resolveStatus(partial, true),
      "DRAFT",
      "asking to finish an incomplete form saves the work rather than losing it"
    );
  });

  it("handles a form with no questions", () => {
    const verdict = evaluateCompletion([], []);

    assert.equal(verdict.isValid, true);
    assert.equal(verdict.isComplete, true);
  });
});

// --- Reporting --------------------------------------------------------------

describe("report", () => {
  const questions: AnalyticQuestion[] = [
    { id: "q1", code: "A", category: FeedbackCategory.TEACHING, weightScaled: 100 },
    { id: "q2", code: "B", category: FeedbackCategory.BEHAVIOUR, weightScaled: 100 },
  ];

  function submissions(facultyId: string, count: number, rating: number) {
    return Array.from({ length: count }, (_value, index) => ({
      submissionId: `${facultyId}_${index}`,
      facultyId,
      courseId: "c1",
      semesterId: "s1",
      answers: [
        { questionId: "q1", rating },
        { questionId: "q2", rating },
      ],
    })) satisfies SubmissionWithAnswers[];
  }

  it("WITHHOLDS scores below the threshold but still reports the COUNT", () => {
    // Knowing three people responded discloses nothing about any of them;
    // knowing their average does.
    const summary = summariseFaculty({
      facultyId: "f1",
      submissionCount: submissions("f1", 3, 5).length,
      submissions: submissions("f1", 3, 5),
      questions,
      viewer: FEEDBACK_VIEWER.FACULTY,
      viewerFacultyId: "f1",
    });

    assert.equal(summary.submissionCount, 3);
    assert.equal(summary.analytics, null);
    assert.equal(summary.disclosure.isVisible, false);
    assert.equal(summary.disclosure.shortfall, 2);
  });

  it("a withheld summary is NOT an empty one", () => {
    // An empty summary would say nobody responded — a different, false claim.
    const summary = summariseFaculty({
      facultyId: "f1",
      submissionCount: submissions("f1", 2, 4).length,
      submissions: submissions("f1", 2, 4),
      questions,
      viewer: FEEDBACK_VIEWER.FACULTY,
      viewerFacultyId: "f1",
    });

    assert.notEqual(summary.submissionCount, 0);
  });

  it("discloses at the threshold", () => {
    const summary = summariseFaculty({
      facultyId: "f1",
      submissionCount: submissions("f1", 5, 4).length,
      submissions: submissions("f1", 5, 4),
      questions,
      viewer: FEEDBACK_VIEWER.FACULTY,
      viewerFacultyId: "f1",
    });

    assert.equal(summary.disclosure.isVisible, true);
    assert.equal(formatRating(summary.analytics?.overallAverage ?? null), "4.00");
  });

  it("never withholds from an admin", () => {
    const summary = summariseFaculty({
      facultyId: "f1",
      submissionCount: submissions("f1", 1, 5).length,
      submissions: submissions("f1", 1, 5),
      questions,
      viewer: FEEDBACK_VIEWER.ADMIN,
      viewerFacultyId: null,
    });

    assert.equal(summary.disclosure.isVisible, true);
    assert.equal(formatRating(summary.analytics?.overallAverage ?? null), "5.00");
  });

  it("counts each FACULTY MEMBER once in an aggregate", () => {
    // A faculty member teaching four hundred students must not dominate one
    // teaching twelve.
    const summary = summariseAggregate("dept_1", [
      ...submissions("f1", 100, 5),
      ...submissions("f2", 2, 1),
    ], questions);

    assert.equal(summary.facultyCount, 2);
    assert.equal(formatRating(summary.overallAverage), "3.00");
  });

  it("orders faculty lines deterministically", () => {
    const forward = summariseAggregate("d", [
      ...submissions("f2", 1, 3),
      ...submissions("f1", 1, 4),
    ], questions);

    assert.deepEqual(forward.faculty.map((line) => line.facultyId), ["f1", "f2"]);
  });

  it("produces internally coherent numbers", () => {
    const summary = summariseAggregate("d", [
      ...submissions("f1", 3, 5),
      ...submissions("f2", 2, 2),
    ], questions);

    assert.ok(isSummaryCoherent(summary));
    assert.equal(summary.submissionCount, 5);
  });

  it("handles a scope nobody has feedback for", () => {
    const summary = summariseAggregate("d", [], questions);

    assert.equal(summary.facultyCount, 0);
    assert.equal(summary.overallAverage, null);
    assert.deepEqual(summary.faculty, []);
    assert.ok(isSummaryCoherent(summary));
  });

  it("aggregates a large cohort", () => {
    const summary = summariseAggregate(
      "d",
      Array.from({ length: 20 }, (_value, index) =>
        submissions(`f${index}`, 25, (index % 5) + 1)
      ).flat(),
      questions
    );

    assert.equal(summary.facultyCount, 20);
    assert.equal(summary.submissionCount, 500);
    assert.ok(isSummaryCoherent(summary));
  });
});
