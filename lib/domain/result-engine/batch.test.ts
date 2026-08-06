// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Batch Processing
// LAYER  : Domain — Unit Tests
// PURPOSE: Prove that one student's failure never costs the other nine hundred
//          and ninety-nine, and that the cohort passes do what a moderation and
//          a curve actually mean.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RoundingMode } from "@/app/generated/prisma/enums";
import { formatMark, toScaled } from "@/lib/domain/result-engine/decimal";
import {
  COURSE_OUTCOME,
  ComponentAggregation,
  ComponentSource,
  MarkStatus,
  RegistrationType,
} from "@/lib/domain/result-engine/enums";
import { prepareScheme, type PreparedScheme } from "@/lib/domain/result-engine/calculator";
import {
  BATCH_ERROR,
  batchFailures,
  batchResults,
  cohortMean,
  curveCohort,
  isCohortOperation,
  moderateCohort,
  processCohort,
  processStudent,
  regradeAfterCohortPass,
  type BatchStudentInput,
  type CohortEntry,
} from "@/lib/domain/result-engine/batch";
import { RELATIVE_GRADING_PENDING } from "@/lib/domain/result-engine/grading";
import type {
  ComponentDefinition,
  GradeBandDefinition,
  RoundingPolicy,
} from "@/lib/domain/result-engine/types";

const POLICY: RoundingPolicy = {
  marksRounding: RoundingMode.HALF_UP,
  marksPrecision: 2,
  gpaRounding: RoundingMode.HALF_UP,
  gpaPrecision: 2,
};

function band(
  grade: string,
  min: string,
  max: string,
  point: string,
  isPass: boolean
): GradeBandDefinition {
  return {
    grade,
    label: null,
    minPercentScaled: toScaled(min),
    maxPercentScaled: toScaled(max),
    gradePointScaled: toScaled(point),
    isPass,
    countsForGpa: true,
    sequence: 1,
  };
}

const BANDS: readonly GradeBandDefinition[] = [
  band("F", "0", "39.99", "0", false),
  band("C", "40", "59.99", "5", true),
  band("B", "60", "79.99", "8", true),
  band("A", "80", "100", "10", true),
];

const TOTAL: ComponentDefinition = {
  id: "total",
  code: "TOT",
  parentComponentId: null,
  sequence: 1,
  maxMarksScaled: toScaled("100"),
  weightageScaled: toScaled("100"),
  aggregation: ComponentAggregation.SUM,
  rollup: null,
  sourceType: ComponentSource.MANUAL_ENTRY,
  isMandatory: true,
  ruleConfig: null,
};

function scheme(id = "scheme_1"): PreparedScheme {
  const outcome = prepareScheme(
    {
      evaluationSchemeId: id,
      components: [TOTAL],
      rules: [],
      criteria: [],
      gradeBands: BANDS,
      policy: POLICY,
      isRelativeGrading: false,
    },
    toScaled("10")
  );

  assert.ok(outcome.ok);
  if (!outcome.ok) {
    throw new Error("unreachable");
  }

  return outcome.value;
}

const SCHEMES = new Map([["scheme_1", scheme()]]);

function student(
  studentId: string,
  marks: string,
  overrides: Partial<BatchStudentInput> = {}
): BatchStudentInput {
  return {
    studentId,
    semesterId: "sem_1",
    courses: [
      {
        courseId: "math",
        evaluationSchemeId: "scheme_1",
        attemptNumber: 1,
        registrationType: RegistrationType.REGULAR,
        calculation: {
          courseRegistrationId: `reg_${studentId}`,
          creditsScaled: toScaled("4"),
          attendancePercentScaled: null,
          marks: [
            {
              componentId: "total",
              sequenceNumber: 1,
              maxMarksScaled: toScaled("100"),
              marksScaled: toScaled(marks),
              status: MarkStatus.RECORDED,
            },
          ],
        },
      },
    ],
    ...overrides,
  };
}

describe("processStudent", () => {
  it("computes a student and projects the GPA facts", () => {
    const outcome = processStudent(SCHEMES, student("s1", "75"), POLICY);

    assert.ok(outcome.ok);
    if (!outcome.ok) {
      return;
    }

    assert.equal(outcome.value.entries.length, 1);
    assert.equal(formatMark(outcome.value.entries[0].gradePointScaled ?? 0), "8.00");
    assert.equal(outcome.value.entries[0].outcome, COURSE_OUTCOME.PASS);
    assert.equal(outcome.value.semester.result.isPromoted, true);
  });

  it("REFUSES a registration citing a regulation the batch never prepared", () => {
    const outcome = processStudent(
      SCHEMES,
      student("s1", "75", {
        courses: [
          {
            ...student("s1", "75").courses[0],
            evaluationSchemeId: "scheme_unknown",
          },
        ],
      }),
      POLICY
    );

    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.failure.code, BATCH_ERROR.UNKNOWN_SCHEME);
    }
  });

  it("carries a course's pending cohort work up to the student", () => {
    const relative = prepareScheme(
      {
        evaluationSchemeId: "scheme_rel",
        components: [TOTAL],
        rules: [],
        criteria: [],
        gradeBands: BANDS,
        policy: POLICY,
        isRelativeGrading: true,
      },
      toScaled("10")
    );

    assert.ok(relative.ok);
    if (!relative.ok) {
      return;
    }

    const outcome = processStudent(
      new Map([["scheme_rel", relative.value]]),
      student("s1", "75", {
        courses: [
          { ...student("s1", "75").courses[0], evaluationSchemeId: "scheme_rel" },
        ],
      }),
      POLICY
    );

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.deepEqual(outcome.value.pendingOperations, [RELATIVE_GRADING_PENDING]);
    }
  });

  it("handles a student registered for nothing", () => {
    const outcome = processStudent(SCHEMES, student("s1", "0", { courses: [] }), POLICY);

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(outcome.value.semester.result.sgpa.valueScaled, null, "null, not zero");
    }
  });
});

describe("processCohort — a failure never stops the batch", () => {
  it("records the failure and computes everyone else", () => {
    const cohort = [
      student("s1", "75"),
      student("s2", "50", {
        courses: [
          { ...student("s2", "50").courses[0], evaluationSchemeId: "missing" },
        ],
      }),
      student("s3", "90"),
    ];

    const outcome = processCohort(SCHEMES, cohort, POLICY);

    assert.equal(outcome.succeeded, 2);
    assert.equal(outcome.failed, 1);
    assert.equal(batchResults(outcome).length, 2);
    assert.equal(batchFailures(outcome).length, 1);
    assert.equal(batchFailures(outcome)[0].code, BATCH_ERROR.UNKNOWN_SCHEME);
  });

  it("preserves the order students were supplied in", () => {
    const cohort = [student("c", "60"), student("a", "70"), student("b", "80")];

    assert.deepEqual(
      processCohort(SCHEMES, cohort, POLICY).students.map((entry) => entry.studentId),
      ["c", "a", "b"]
    );
  });

  it("computes a thousand students against ONE prepared scheme", () => {
    const cohort = Array.from({ length: 1000 }, (_value, index) =>
      student(`s${index}`, String(30 + (index % 70)))
    );

    const outcome = processCohort(SCHEMES, cohort, POLICY);

    assert.equal(outcome.succeeded, 1000);
    assert.equal(outcome.failed, 0);
  });

  it("gives the identical answer when the batch is re-run", () => {
    const cohort = [student("s1", "63"), student("s2", "41")];

    const first = processCohort(SCHEMES, cohort, POLICY);
    const second = processCohort(SCHEMES, cohort, POLICY);

    assert.deepEqual(batchResults(first), batchResults(second));
  });

  it("handles an empty cohort", () => {
    const outcome = processCohort(SCHEMES, [], POLICY);

    assert.equal(outcome.succeeded, 0);
    assert.equal(outcome.failed, 0);
  });
});

describe("moderateCohort", () => {
  function entries(...values: string[]): readonly CohortEntry[] {
    return values.map((value, index) => ({
      courseRegistrationId: `reg_${index}`,
      percentageScaled: toScaled(value),
    }));
  }

  it("computes the cohort mean exactly", () => {
    assert.equal(formatMark(cohortMean(entries("40", "50", "60"), POLICY) ?? 0), "50.00");
  });

  it("has no mean for an empty cohort", () => {
    assert.equal(cohortMean([], POLICY), null);
  });

  it("shifts the cohort onto the target mean", () => {
    // Mean is 50; a target of 60 lifts everyone by 10.
    const moderated = moderateCohort(entries("40", "50", "60"), { targetMean: 60 }, POLICY);

    assert.deepEqual(
      moderated.map((entry) => formatMark(entry.percentageScaled)),
      ["50.00", "60.00", "70.00"]
    );
  });

  it("PRESERVES the gaps between candidates", () => {
    // A rescaling would compress or stretch them, changing the relative
    // standing of students whose marks nobody disputed.
    const before = entries("30", "50", "90");
    const after = moderateCohort(before, { targetMean: 60 }, POLICY);

    assert.equal(
      after[1].percentageScaled - after[0].percentageScaled,
      before[1].percentageScaled - before[0].percentageScaled
    );
  });

  it("shifts DOWNWARD when the cohort scored above the target", () => {
    const moderated = moderateCohort(entries("70", "80", "90"), { targetMean: 70 }, POLICY);

    assert.deepEqual(
      moderated.map((entry) => formatMark(entry.percentageScaled)),
      ["60.00", "70.00", "80.00"]
    );
  });

  it("respects maxShift, so a regulation can bound moderation", () => {
    // Reaching 60 from a mean of 30 needs +30, but only +5 is permitted.
    const moderated = moderateCohort(
      entries("20", "30", "40"),
      { targetMean: 60, maxShift: 5 },
      POLICY
    );

    assert.deepEqual(
      moderated.map((entry) => formatMark(entry.percentageScaled)),
      ["25.00", "35.00", "45.00"]
    );
  });

  it("clamps at full marks rather than exceeding them", () => {
    const moderated = moderateCohort(entries("95", "98"), { targetMean: 100 }, POLICY);

    assert.equal(formatMark(moderated[1].percentageScaled), "100.00");
  });

  it("clamps at zero rather than going negative", () => {
    const moderated = moderateCohort(entries("5", "10"), { targetMean: 0 }, POLICY);

    assert.equal(formatMark(moderated[0].percentageScaled), "0.00");
  });

  it("changes nothing when the config is malformed", () => {
    for (const config of [null, {}, { targetMean: "60" }, []]) {
      const moderated = moderateCohort(entries("40", "60"), config, POLICY);

      assert.deepEqual(
        moderated.map((entry) => formatMark(entry.percentageScaled)),
        ["40.00", "60.00"],
        JSON.stringify(config)
      );
    }
  });

  it("does not mutate the entries it was given", () => {
    const before = entries("40", "60");
    const snapshot = JSON.stringify(before);

    moderateCohort(before, { targetMean: 80 }, POLICY);

    assert.equal(JSON.stringify(before), snapshot);
  });
});

describe("curveCohort", () => {
  function entries(...values: string[]): readonly CohortEntry[] {
    return values.map((value, index) => ({
      courseRegistrationId: `reg_${index}`,
      percentageScaled: toScaled(value),
    }));
  }

  const distribution = {
    distribution: [
      { grade: "O", topPercent: 20 },
      { grade: "A", topPercent: 60 },
      { grade: "B", topPercent: 100 },
    ],
  };

  it("assigns grades by POSITION, leaving the marks untouched", () => {
    const cohort = entries("90", "80", "70", "60", "50");
    const curved = curveCohort(cohort, distribution);

    // Top 20% of five is one student; the next 40% is two more.
    assert.deepEqual(
      curved.map((entry) => entry.grade),
      ["O", "A", "A", "B", "B"]
    );

    assert.deepEqual(
      curved.map((entry) => formatMark(entry.percentageScaled)),
      ["90.00", "80.00", "70.00", "60.00", "50.00"],
      "a curve is a statement about rank, not about score"
    );
  });

  it("gives TIED candidates the same grade even across a cut-off", () => {
    // Three students on 80 straddle the top-20%-of-five boundary. Splitting
    // them would award two letters for one identical performance.
    const cohort = entries("80", "80", "80", "50", "40");
    const curved = curveCohort(cohort, distribution);

    assert.deepEqual(
      curved.slice(0, 3).map((entry) => entry.grade),
      ["O", "O", "O"]
    );
  });

  it("is not affected by the order the cohort arrives in", () => {
    const forward = curveCohort(entries("90", "70", "50"), distribution);
    const reversed = curveCohort(entries("50", "70", "90"), distribution);

    assert.deepEqual(
      forward.map((entry) => entry.grade),
      [...reversed].reverse().map((entry) => entry.grade)
    );
  });

  it("leaves anyone past the last slice ungraded rather than unhandled", () => {
    const partial = { distribution: [{ grade: "O", topPercent: 20 }] };
    const curved = curveCohort(entries("90", "80", "70", "60", "50"), partial);

    assert.equal(curved[0].grade, "O");
    assert.equal(curved[4].grade, null, "the absolute grade stands");
  });

  it("sorts a distribution declared out of order", () => {
    const jumbled = {
      distribution: [
        { grade: "B", topPercent: 100 },
        { grade: "O", topPercent: 20 },
        { grade: "A", topPercent: 60 },
      ],
    };

    assert.deepEqual(
      curveCohort(entries("90", "80", "70", "60", "50"), jumbled).map((e) => e.grade),
      ["O", "A", "A", "B", "B"]
    );
  });

  it("changes nothing when the distribution is missing or malformed", () => {
    for (const config of [null, {}, { distribution: "top" }, { distribution: [{}] }]) {
      const curved = curveCohort(entries("90", "50"), config);

      assert.deepEqual(curved.map((entry) => entry.grade), [null, null], JSON.stringify(config));
    }
  });

  it("handles an empty cohort", () => {
    assert.deepEqual(curveCohort([], distribution), []);
  });

  it("curves a thousand students", () => {
    const cohort = Array.from({ length: 1000 }, (_value, index) => ({
      courseRegistrationId: `reg_${index}`,
      percentageScaled: toScaled(String(30 + (index % 70))),
    }));

    const curved = curveCohort(cohort, distribution);
    const graded = curved.filter((entry) => entry.grade !== null);

    assert.equal(curved.length, 1000);
    assert.ok(graded.length > 0);
  });
});

describe("regradeAfterCohortPass", () => {
  const bands = scheme().bands;

  it("re-resolves the band the moderated mark now falls in", () => {
    const outcome = regradeAfterCohortPass(bands, toScaled("85"), POLICY, false);

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(outcome.value.grade.grade, "A");
      assert.equal(outcome.value.outcome, COURSE_OUTCOME.PASS);
    }
  });

  it("STILL overrides when a criterion was already missed", () => {
    // Moderation lifts a mark; it does not excuse a component shortfall.
    const outcome = regradeAfterCohortPass(bands, toScaled("85"), POLICY, true);

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(outcome.value.grade.grade, "F");
      assert.equal(outcome.value.grade.isOverridden, true);
      assert.equal(outcome.value.outcome, COURSE_OUTCOME.FAIL);
    }
  });

  it("uses the same band rule the first pass used", () => {
    const outcome = regradeAfterCohortPass(bands, toScaled("39.99"), POLICY, false);

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(outcome.value.grade.grade, "F");
    }
  });
});

describe("isCohortOperation", () => {
  it("recognises exactly the three operations a cohort pass settles", () => {
    assert.equal(isCohortOperation("MODERATION"), true);
    assert.equal(isCohortOperation("CURVE"), true);
    assert.equal(isCohortOperation(RELATIVE_GRADING_PENDING), true);
    assert.equal(isCohortOperation("CAP"), false);
    assert.equal(isCohortOperation("GRACE"), false);
  });
});
