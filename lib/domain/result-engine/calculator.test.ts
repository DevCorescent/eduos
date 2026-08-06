// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Orchestrator
// LAYER  : Domain — Unit Tests
// PURPOSE: Run the whole pipeline against realistic regulations and check the
//          numbers a student would actually see.
//
//          The unit tests for each stage prove the stages. These prove the
//          WIRING — that the stages run in the right order, that each runs once,
//          and that a regulation expressed entirely in configuration produces
//          the grade that regulation intends.
//
//          Two universities are modelled, deliberately disagreeing about almost
//          everything, from the same engine and no code differences at all.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AttemptPolicy, RoundingMode } from "@/app/generated/prisma/enums";
import { GPA_SCALE } from "@/lib/constants/resultEngine";
import { formatMark, formatScaled, toScaled } from "@/lib/domain/result-engine/decimal";
import {
  COURSE_OUTCOME,
  ComponentAggregation,
  ComponentRollup,
  ComponentSource,
  CriterionOutcome,
  MarkStatus,
  PassingMetric,
  RegistrationType,
  RulePhase,
  RuleOperation,
  ThresholdUnit,
} from "@/lib/domain/result-engine/enums";
import {
  buildGradeCard,
  calculateCourse,
  calculateSemester,
  calculateStudent,
  prepareScheme,
  type PreparedScheme,
  type SemesterCourseInput,
} from "@/lib/domain/result-engine/calculator";
import { RELATIVE_GRADING_PENDING } from "@/lib/domain/result-engine/grading";
import type { GpaCourseEntry } from "@/lib/domain/result-engine/gpa";
import type {
  AssessmentValue,
  CalculatorContext,
  ComponentDefinition,
  CourseCalculationInput,
  CriterionDefinition,
  GradeBandDefinition,
  RoundingPolicy,
  RuleDefinition,
} from "@/lib/domain/result-engine/types";

// --- Configuration builders -------------------------------------------------

const POLICY: RoundingPolicy = {
  marksRounding: RoundingMode.HALF_UP,
  marksPrecision: 2,
  gpaRounding: RoundingMode.HALF_UP,
  gpaPrecision: 2,
};

const MAX_GRADE_POINT = toScaled("10");

function band(
  grade: string,
  min: string,
  max: string,
  point: string,
  isPass: boolean,
  label: string | null = null
): GradeBandDefinition {
  return {
    grade,
    label,
    minPercentScaled: toScaled(min),
    maxPercentScaled: toScaled(max),
    gradePointScaled: toScaled(point),
    isPass,
    countsForGpa: true,
    sequence: 1,
  };
}

const BANDS: readonly GradeBandDefinition[] = [
  band("F", "0", "39.99", "0", false, "Fail"),
  band("C", "40", "54.99", "5", true, "Second Class"),
  band("B", "55", "69.99", "7", true, "First Class"),
  band("A", "70", "84.99", "9", true, "First Class with Distinction"),
  band("O", "85", "100", "10", true, "Outstanding"),
];

function component(
  id: string,
  overrides: Partial<ComponentDefinition> = {}
): ComponentDefinition {
  return {
    id,
    code: id.toUpperCase(),
    parentComponentId: null,
    sequence: 1,
    maxMarksScaled: toScaled("100"),
    weightageScaled: toScaled("100"),
    aggregation: ComponentAggregation.SUM,
    rollup: null,
    sourceType: ComponentSource.MANUAL_ENTRY,
    isMandatory: true,
    ruleConfig: null,
    ...overrides,
  };
}

/**
 * University A: internal 30 / external 70, internals being the best two of
 * three sessionals, a 40% overall pass and a 40% minimum in the external paper.
 */
const UNIVERSITY_A_COMPONENTS: readonly ComponentDefinition[] = [
  component("internal", {
    code: "INT",
    maxMarksScaled: toScaled("30"),
    weightageScaled: toScaled("30"),
    aggregation: null,
    rollup: ComponentRollup.WEIGHTED_SUM,
  }),
  component("sessional", {
    code: "ST",
    parentComponentId: "internal",
    maxMarksScaled: toScaled("20"),
    weightageScaled: toScaled("67"),
    aggregation: ComponentAggregation.BEST_N,
    ruleConfig: { count: 2 },
  }),
  component("assignment", {
    code: "ASG",
    parentComponentId: "internal",
    sequence: 2,
    maxMarksScaled: toScaled("10"),
    weightageScaled: toScaled("33"),
    aggregation: ComponentAggregation.SUM,
  }),
  component("external", {
    code: "EXT",
    sequence: 2,
    maxMarksScaled: toScaled("70"),
    weightageScaled: toScaled("70"),
    aggregation: ComponentAggregation.SUM,
  }),
];

function criterion(overrides: Partial<CriterionDefinition> = {}): CriterionDefinition {
  return {
    id: "criterion_1",
    code: "MIN_EXTERNAL",
    componentId: "external",
    metric: PassingMetric.COMPONENT_SCORE,
    thresholdScaled: toScaled("40"),
    unit: ThresholdUnit.PERCENT,
    failureOutcome: CriterionOutcome.FAIL,
    ...overrides,
  };
}

function context(overrides: Partial<CalculatorContext> = {}): CalculatorContext {
  return {
    evaluationSchemeId: "scheme_a",
    components: UNIVERSITY_A_COMPONENTS,
    rules: [],
    criteria: [],
    gradeBands: BANDS,
    policy: POLICY,
    isRelativeGrading: false,
    ...overrides,
  };
}

/** Prepare and assert success. */
function scheme(overrides: Partial<CalculatorContext> = {}): PreparedScheme {
  const outcome = prepareScheme(context(overrides), MAX_GRADE_POINT);
  assert.ok(outcome.ok, outcome.ok ? "" : `refused: ${outcome.failure.code}`);
  return outcome.value;
}

function mark(
  componentId: string,
  sequenceNumber: number,
  marks: string | null,
  max: string,
  status: AssessmentValue["status"] = MarkStatus.RECORDED
): AssessmentValue {
  return {
    componentId,
    sequenceNumber,
    maxMarksScaled: toScaled(max),
    marksScaled: marks === null ? null : toScaled(marks),
    status,
  };
}

function input(
  marks: readonly AssessmentValue[],
  overrides: Partial<CourseCalculationInput> = {}
): CourseCalculationInput {
  return {
    courseRegistrationId: "reg_1",
    creditsScaled: toScaled("4"),
    marks,
    attendancePercentScaled: null,
    ...overrides,
  };
}

/** A full-marks mark set for University A. */
function fullMarks(): readonly AssessmentValue[] {
  return [
    mark("sessional", 1, "20", "20"),
    mark("sessional", 2, "20", "20"),
    mark("sessional", 3, "20", "20"),
    mark("assignment", 1, "10", "10"),
    mark("external", 1, "70", "70"),
  ];
}

/** Compute and assert a result came back. */
function compute(prepared: PreparedScheme, calculationInput: CourseCalculationInput) {
  const computation = calculateCourse(prepared, calculationInput);
  assert.equal(
    computation.errors.length,
    0,
    `unexpected errors: ${JSON.stringify(computation.errors)}`
  );
  assert.ok(computation.result !== null, "no result produced");
  return { computation, result: computation.result };
}

// --- prepareScheme ----------------------------------------------------------

describe("prepareScheme", () => {
  it("indexes a well-formed scheme", () => {
    const prepared = scheme();

    assert.equal(prepared.components.roots.length, 2);
    assert.equal(prepared.bands.passMarkScaled, toScaled("40"));
  });

  it("REFUSES a tree with an orphaned component", () => {
    const outcome = prepareScheme(
      context({
        components: [...UNIVERSITY_A_COMPONENTS, component("lost", { parentComponentId: "gone" })],
      }),
      MAX_GRADE_POINT
    );

    assert.equal(outcome.ok, false, "a course missing a component is wrong, not smaller");
  });

  it("REFUSES a cyclic tree", () => {
    const outcome = prepareScheme(
      context({
        components: [
          component("a", { parentComponentId: "b" }),
          component("b", { parentComponentId: "a" }),
        ],
      }),
      MAX_GRADE_POINT
    );

    assert.equal(outcome.ok, false);
  });

  it("REFUSES a scheme whose band table is broken", () => {
    const outcome = prepareScheme(
      context({ gradeBands: [band("A", "50", "100", "9", true)] }),
      MAX_GRADE_POINT
    );

    assert.equal(outcome.ok, false, "a gap must be caught before it grades anyone");
  });

  it("converts a PERCENT component criterion onto the component's own scale", () => {
    // 40% of the 70-mark external paper is 28 marks.
    const prepared = scheme({ criteria: [criterion()] });

    assert.equal(prepared.componentPassMarks.get("external"), toScaled("28"));
  });

  it("keeps the STRICTEST criterion when a component carries several", () => {
    const prepared = scheme({
      criteria: [
        criterion({ code: "LOW", unit: ThresholdUnit.MARKS, thresholdScaled: toScaled("20") }),
        criterion({ code: "HIGH", unit: ThresholdUnit.MARKS, thresholdScaled: toScaled("30") }),
      ],
    });

    assert.equal(prepared.componentPassMarks.get("external"), toScaled("30"));
  });
});

// --- The pipeline end to end ------------------------------------------------

describe("calculateCourse — the whole pipeline", () => {
  it("full marks is exactly 100.00 and the top band", () => {
    const { result } = compute(scheme(), input(fullMarks()));

    assert.equal(formatMark(result.percentageScaled), "100.00", "99.99 would drop a band");
    assert.equal(result.grade?.grade, "O");
    assert.equal(result.grade?.label, "Outstanding");
    assert.equal(result.outcome, COURSE_OUTCOME.PASS);
    assert.equal(formatMark(result.creditsEarnedScaled), "4.00");
  });

  it("zero marks is 0.00 and a fail that earns no credit", () => {
    const { result } = compute(
      scheme(),
      input([
        mark("sessional", 1, "0", "20"),
        mark("sessional", 2, "0", "20"),
        mark("assignment", 1, "0", "10"),
        mark("external", 1, "0", "70"),
      ])
    );

    assert.equal(formatMark(result.percentageScaled), "0.00");
    assert.equal(result.grade?.grade, "F");
    assert.equal(result.outcome, COURSE_OUTCOME.FAIL);
    assert.equal(result.creditsEarnedScaled, 0);
  });

  it("computes a realistic mixed mark sheet", () => {
    // Sessionals 15, 18, 12 of 20 -> best two are 18 and 15 -> 33/40 -> 82.5%
    // of the 20-mark component -> 16.50. Assignment 8/10 -> 8.00.
    // Internal = 67% × (16.50/20) + 33% × (8/10), on a 30-mark scale
    //          = 0.67×30×0.825 + 0.33×30×0.80 = 16.58 + 7.92 = 24.50 (rounded)
    // External 45/70 -> 45.00.
    // Course = 30% × (24.50/30) + 70% × (45/70) = 24.50 + 45.00 = 69.50%.
    const { result } = compute(
      scheme(),
      input([
        mark("sessional", 1, "15", "20"),
        mark("sessional", 2, "18", "20"),
        mark("sessional", 3, "12", "20"),
        mark("assignment", 1, "8", "10"),
        mark("external", 1, "45", "70"),
      ])
    );

    assert.equal(formatMark(result.percentageScaled), "69.50");
    assert.equal(result.grade?.grade, "B");
    assert.equal(result.outcome, COURSE_OUTCOME.PASS);
  });

  it("reports every component it computed, leaves and branches alike", () => {
    const { result } = compute(scheme(), input(fullMarks()));
    const byCode = new Map(result.components.map((entry) => [entry.code, entry]));

    assert.equal(byCode.size, 4);
    assert.equal(byCode.get("ST")?.isLeaf, true);
    assert.equal(byCode.get("INT")?.isLeaf, false);
    assert.equal(formatMark(byCode.get("INT")?.adjustedScaled ?? 0), "30.00");
    assert.equal(formatMark(byCode.get("EXT")?.contributionScaled ?? 0), "70.00");
  });

  it("BEST_N is genuinely applied — the worst sessional is discarded", () => {
    const withBadThird = compute(
      scheme(),
      input([
        mark("sessional", 1, "20", "20"),
        mark("sessional", 2, "20", "20"),
        mark("sessional", 3, "0", "20"),
        mark("assignment", 1, "10", "10"),
        mark("external", 1, "70", "70"),
      ])
    );

    assert.equal(
      formatMark(withBadThird.result.percentageScaled),
      "100.00",
      "the zero is dropped, so the student is untouched by it"
    );
  });
});

describe("calculateCourse — rules, in configured order", () => {
  function rule(
    code: string,
    phase: RulePhase,
    operation: RuleOperation,
    config: unknown,
    componentId: string | null,
    sequence = 1
  ): RuleDefinition {
    return {
      id: `rule_${code}`,
      code,
      componentId,
      phase,
      operation,
      sequence,
      config,
      condition: null,
    };
  }

  it("applies a COURSE_ADJUSTMENT rule to the total", () => {
    const prepared = scheme({
      rules: [
        rule("BONUS", RulePhase.COURSE_ADJUSTMENT, RuleOperation.ADD_CONSTANT, { amount: 5 }, null),
      ],
    });

    const { result } = compute(
      prepared,
      input([
        mark("sessional", 1, "10", "20"),
        mark("sessional", 2, "10", "20"),
        mark("assignment", 1, "5", "10"),
        mark("external", 1, "35", "70"),
      ])
    );

    assert.equal(formatMark(result.percentageScaled), "55.00", "50.00 plus the 5-point bonus");
    assert.equal(result.grade?.grade, "B", "the bonus moved the band");
  });

  it("applies rules in SEQUENCE, each consuming the last", () => {
    const prepared = scheme({
      rules: [
        rule("BONUS", RulePhase.COURSE_ADJUSTMENT, RuleOperation.ADD_CONSTANT, { amount: 10 }, null, 1),
        rule("CAP", RulePhase.COURSE_ADJUSTMENT, RuleOperation.CAP, { limit: 95 }, null, 2),
      ],
    });

    const { result } = compute(prepared, input(fullMarks()));

    assert.equal(formatMark(result.percentageScaled), "95.00", "100 + 10 then capped");
  });

  it("applies a COMPONENT_ADJUSTMENT rule to one component only", () => {
    const prepared = scheme({
      rules: [
        rule("SCALE_EXT", RulePhase.COMPONENT_ADJUSTMENT, RuleOperation.SCALE, { factor: 2 }, "external"),
      ],
    });

    const { result } = compute(
      prepared,
      input([
        mark("sessional", 1, "20", "20"),
        mark("sessional", 2, "20", "20"),
        mark("assignment", 1, "10", "10"),
        mark("external", 1, "35", "70"),
      ])
    );

    // The external doubles from 35 to 70, so the whole course reaches 100.
    assert.equal(formatMark(result.percentageScaled), "100.00");
  });

  it("applies a SESSION_ADJUSTMENT rule to each sitting BEFORE they combine", () => {
    // Scaling each sitting then taking the best two is not the same as taking
    // the best two then scaling — which is exactly why the phase order matters.
    const prepared = scheme({
      rules: [
        rule("SESSION_CAP", RulePhase.SESSION_ADJUSTMENT, RuleOperation.CAP, { limit: 10 }, "sessional"),
      ],
    });

    const { result } = compute(
      prepared,
      input([
        mark("sessional", 1, "20", "20"),
        mark("sessional", 2, "20", "20"),
        mark("assignment", 1, "10", "10"),
        mark("external", 1, "70", "70"),
      ])
    );

    // Each sessional capped at 10/20 = 50%, so the sessional component halves.
    // Internal = 0.67×30×0.5 + 0.33×30×1.0 = 10.05 + 9.90 = 19.95 of 30.
    // Course = 19.95 + 70.00 = 89.95%.
    assert.equal(formatMark(result.percentageScaled), "89.95");
  });

  it("GRACE at course level lifts a near miss to the pass mark", () => {
    const prepared = scheme({
      rules: [
        rule("GRACE", RulePhase.COURSE_ADJUSTMENT, RuleOperation.GRACE, { maxAward: 2 }, null),
      ],
    });

    const { result } = compute(
      prepared,
      input([
        mark("sessional", 1, "8", "20"),
        mark("sessional", 2, "8", "20"),
        mark("assignment", 1, "4", "10"),
        mark("external", 1, "27", "70"),
      ])
    );

    assert.ok(result.percentageScaled >= toScaled("40"), "grace reached the pass mark");
    assert.equal(result.outcome, COURSE_OUTCOME.PASS);
    assert.equal(result.grade?.grade, "C");
  });

  it("GRACE does not lift a shortfall beyond its allowance", () => {
    const prepared = scheme({
      rules: [
        rule("GRACE", RulePhase.COURSE_ADJUSTMENT, RuleOperation.GRACE, { maxAward: 2 }, null),
      ],
    });

    const { result } = compute(
      prepared,
      input([
        mark("sessional", 1, "4", "20"),
        mark("sessional", 2, "4", "20"),
        mark("assignment", 1, "2", "10"),
        mark("external", 1, "14", "70"),
      ])
    );

    assert.equal(result.outcome, COURSE_OUTCOME.FAIL);
  });
});

describe("calculateCourse — deferred cohort operations", () => {
  function cohortRule(code: string, operation: RuleOperation): RuleDefinition {
    return {
      id: `rule_${code}`,
      code,
      componentId: null,
      phase: RulePhase.COURSE_ADJUSTMENT,
      operation,
      sequence: 1,
      config: { targetMean: 60 },
      condition: null,
    };
  }

  it("reports MODERATION as pending WITHOUT applying it", () => {
    const prepared = scheme({ rules: [cohortRule("MOD", RuleOperation.MODERATION)] });
    const { computation, result } = compute(prepared, input(fullMarks()));

    assert.deepEqual(computation.pendingOperations, ["MOD"]);
    assert.deepEqual(computation.deferredCodes, ["MOD"]);
    assert.equal(formatMark(result.percentageScaled), "100.00", "untouched");
  });

  it("reports CURVE as pending WITHOUT applying it", () => {
    const prepared = scheme({ rules: [cohortRule("CRV", RuleOperation.CURVE)] });
    const { computation } = compute(prepared, input(fullMarks()));

    assert.deepEqual(computation.pendingOperations, ["CRV"]);
  });

  it("withholds credit while a cohort operation is outstanding", () => {
    // A provisional pass is not a pass. Awarding credit now and revoking it
    // after the curve would be worse than awarding it late.
    const prepared = scheme({ rules: [cohortRule("MOD", RuleOperation.MODERATION)] });
    const { result } = compute(prepared, input(fullMarks()));

    assert.equal(result.creditsEarnedScaled, 0);
    assert.deepEqual(result.pendingCohortRules, ["MOD"]);
  });

  it("RELATIVE grading refuses to grade one student in isolation", () => {
    const prepared = scheme({ isRelativeGrading: true });
    const { computation, result } = compute(prepared, input(fullMarks()));

    assert.equal(result.grade, null, "a provisional grade would be a fabrication");
    assert.equal(result.outcome, COURSE_OUTCOME.INCOMPLETE);
    assert.deepEqual(computation.pendingOperations, [RELATIVE_GRADING_PENDING]);
    assert.equal(
      formatMark(result.percentageScaled),
      "100.00",
      "the percentage is still computed — only the band is deferred"
    );
  });
});

describe("calculateCourse — passing criteria and the fail override", () => {
  it("passes a student who clears the component minimum", () => {
    const prepared = scheme({ criteria: [criterion()] });
    const { result } = compute(
      prepared,
      input([
        mark("sessional", 1, "20", "20"),
        mark("sessional", 2, "20", "20"),
        mark("assignment", 1, "10", "10"),
        mark("external", 1, "28", "70"),
      ])
    );

    assert.deepEqual(result.failedCriteria, []);
    assert.equal(result.outcome, COURSE_OUTCOME.PASS);
  });

  it("OVERRIDES a passing band when a component minimum is missed", () => {
    // 30 internal + 27 external is 57% — comfortably a B — but the external
    // paper is one mark below its own 28-mark minimum.
    const prepared = scheme({ criteria: [criterion()] });
    const { result } = compute(
      prepared,
      input([
        mark("sessional", 1, "20", "20"),
        mark("sessional", 2, "20", "20"),
        mark("assignment", 1, "10", "10"),
        mark("external", 1, "27", "70"),
      ])
    );

    assert.equal(formatMark(result.percentageScaled), "57.00");
    assert.equal(result.grade?.grade, "F", "the band's letter is replaced by the scale's own fail");
    assert.equal(result.grade?.isOverridden, true);
    assert.equal(result.outcome, COURSE_OUTCOME.FAIL);
    assert.equal(result.creditsEarnedScaled, 0);
    assert.equal(result.failedCriteria[0].code, "MIN_EXTERNAL");
  });

  it("an INELIGIBLE criterion is distinct from a failure", () => {
    const prepared = scheme({
      criteria: [
        criterion({
          code: "MIN_ATTENDANCE",
          componentId: null,
          metric: PassingMetric.ATTENDANCE_PERCENT,
          thresholdScaled: toScaled("75"),
          failureOutcome: CriterionOutcome.INELIGIBLE,
        }),
      ],
    });

    const { result } = compute(
      prepared,
      input(fullMarks(), { attendancePercentScaled: toScaled("60") })
    );

    assert.equal(
      result.outcome,
      COURSE_OUTCOME.INELIGIBLE,
      "barred, not beaten — re-sitting the same attempt will not fix it"
    );
  });

  it("never PROMOTES a failing mark, however many criteria were cleared", () => {
    const prepared = scheme({ criteria: [criterion()] });
    const { result } = compute(
      prepared,
      input([
        mark("sessional", 1, "5", "20"),
        mark("sessional", 2, "5", "20"),
        mark("assignment", 1, "2", "10"),
        mark("external", 1, "28", "70"),
      ])
    );

    assert.equal(result.outcome, COURSE_OUTCOME.FAIL, "a threshold is a floor, not a grade");
  });

  it("warns rather than fails when a criterion's figure was never supplied", () => {
    const prepared = scheme({
      criteria: [
        criterion({
          code: "MIN_ATTENDANCE",
          componentId: null,
          metric: PassingMetric.ATTENDANCE_PERCENT,
          thresholdScaled: toScaled("75"),
        }),
      ],
    });

    const { computation, result } = compute(prepared, input(fullMarks()));

    assert.equal(result.outcome, COURSE_OUTCOME.PASS);
    assert.equal(computation.warnings.length, 1);
  });
});

describe("calculateCourse — unfinished and withheld", () => {
  it("reports INCOMPLETE when a mandatory component has no mark", () => {
    const { result } = compute(
      scheme(),
      input([mark("sessional", 1, "20", "20"), mark("assignment", 1, "10", "10")])
    );

    assert.equal(result.outcome, COURSE_OUTCOME.INCOMPLETE);
    assert.equal(result.grade, null);
    assert.equal(result.creditsEarnedScaled, 0);
  });

  it("reports WITHHELD when a contributing mark is sealed", () => {
    const marks = [
      ...fullMarks().filter((entry) => entry.componentId !== "external"),
      mark("external", 1, "70", "70", MarkStatus.WITHHELD),
    ];

    const { result } = compute(scheme(), input(marks));

    assert.equal(result.outcome, COURSE_OUTCOME.WITHHELD);
    assert.equal(result.grade, null);
  });

  it("WITHHELD outranks INCOMPLETE — the student may be told nothing", () => {
    const marks = [
      mark("sessional", 1, "20", "20"),
      mark("sessional", 2, "20", "20"),
      mark("external", 1, "70", "70", MarkStatus.WITHHELD),
    ];

    const { result } = compute(scheme(), input(marks));

    assert.equal(result.outcome, COURSE_OUTCOME.WITHHELD);
  });

  it("warns about a mark citing a component this scheme does not contain", () => {
    const computation = calculateCourse(
      scheme(),
      input([...fullMarks(), mark("retired_component", 1, "10", "10")])
    );

    assert.equal(computation.warnings.length, 1);
    assert.equal(
      formatMark(computation.result?.percentageScaled ?? 0),
      "100.00",
      "the stray mark is dropped, not folded into the total"
    );
  });
});

describe("calculateCourse — immutability and repeatability", () => {
  it("does not mutate the marks it was given", () => {
    const marks = fullMarks();
    const snapshot = JSON.stringify(marks);

    calculateCourse(scheme({ rules: [] }), input(marks));

    assert.equal(JSON.stringify(marks), snapshot);
  });

  it("does not mutate the prepared scheme", () => {
    const prepared = scheme();
    const before = prepared.components.evaluationOrder.join(",");

    calculateCourse(prepared, input(fullMarks()));

    assert.equal(prepared.components.evaluationOrder.join(","), before);
  });

  it("gives the identical answer when re-run — the reproducibility promise", () => {
    const prepared = scheme({ criteria: [criterion()] });
    const calculationInput = input(fullMarks());

    assert.deepEqual(
      calculateCourse(prepared, calculationInput).result,
      calculateCourse(prepared, calculationInput).result
    );
  });

  it("one prepared scheme computes many students independently", () => {
    const prepared = scheme();

    const strong = compute(prepared, input(fullMarks())).result;
    const weak = compute(
      prepared,
      input([
        mark("sessional", 1, "5", "20"),
        mark("sessional", 2, "5", "20"),
        mark("assignment", 1, "2", "10"),
        mark("external", 1, "20", "70"),
      ])
    ).result;

    // Sessionals 5+5 of 40 -> 5.00 of the 20-mark component; assignment 2.00
    // of 10. Internal = 67%×30×(5/20) + 33%×30×(2/10) = 5.03 + 1.98 = 7.01.
    // External 20 of 70 = 20.00. Course = 7.01 + 20.00 = 27.01%.
    assert.equal(formatMark(strong.percentageScaled), "100.00");
    assert.equal(formatMark(weak.percentageScaled), "27.01");
    assert.equal(
      formatMark(compute(prepared, input(fullMarks())).result.percentageScaled),
      "100.00",
      "the second student left no trace on the first"
    );
  });
});

describe("two universities, one engine, no code differences", () => {
  it("a US four-point absolute scale grades the same marks differently", () => {
    const usBands = [
      band("F", "0", "59.99", "0", false, "Fail"),
      band("D", "60", "69.99", "1", true, "Pass"),
      band("C", "70", "79.99", "2", true, "Satisfactory"),
      band("B", "80", "89.99", "3", true, "Good"),
      band("A", "90", "100", "4", true, "Excellent"),
    ];

    const usScheme = prepareScheme(
      context({
        evaluationSchemeId: "scheme_us",
        components: [component("total", { code: "TOT" })],
        gradeBands: usBands,
      }),
      toScaled("4")
    );

    assert.ok(usScheme.ok);
    if (!usScheme.ok) {
      return;
    }

    const { result } = compute(usScheme.value, input([mark("total", 1, "65", "100")]));

    assert.equal(result.grade?.grade, "D", "65% is a D on this scale");
    assert.equal(result.grade?.label, "Pass");
    assert.equal(formatMark(result.grade?.gradePointScaled ?? 0), "1.00");

    // The same 65% on University A's ten-point scale.
    const indian = compute(
      scheme({ components: [component("total", { code: "TOT" })] }),
      input([mark("total", 1, "65", "100")])
    );

    assert.equal(indian.result.grade?.grade, "B");
    assert.equal(formatMark(indian.result.grade?.gradePointScaled ?? 0), "7.00");
  });

  it("a regulation that rounds to whole percents moves the boundary", () => {
    const prepared = scheme({
      components: [component("total", { code: "TOT" })],
      policy: { ...POLICY, marksPrecision: 0 },
    });

    // 54.6% rounds to 55, which is a B rather than a C.
    const { result } = compute(prepared, input([mark("total", 1, "54.6", "100")]));

    assert.equal(result.grade?.grade, "B");
  });
});

// --- Semester, degree, grade card ------------------------------------------

describe("calculateSemester", () => {
  function courseInput(
    courseId: string,
    credits: string,
    marks: readonly AssessmentValue[],
    prepared = scheme()
  ): SemesterCourseInput {
    const computation = calculateCourse(
      prepared,
      input(marks, { courseRegistrationId: `reg_${courseId}`, creditsScaled: toScaled(credits) })
    );

    const entry: GpaCourseEntry = {
      courseId,
      courseRegistrationId: `reg_${courseId}`,
      attemptNumber: 1,
      registrationType: RegistrationType.REGULAR,
      creditsScaled: toScaled(credits),
      gradePointScaled: computation.result?.grade?.gradePointScaled ?? null,
      countsForGpa: computation.result?.grade?.countsForGpa ?? false,
      outcome: computation.result?.outcome ?? COURSE_OUTCOME.INCOMPLETE,
    };

    return { entry, computation };
  }

  const passing = fullMarks();
  const failing = [
    mark("sessional", 1, "2", "20"),
    mark("sessional", 2, "2", "20"),
    mark("assignment", 1, "1", "10"),
    mark("external", 1, "5", "70"),
  ];

  it("computes an SGPA and promotes a clear student", () => {
    const semester = calculateSemester(
      "sem_1",
      [courseInput("math", "4", passing), courseInput("physics", "3", passing)],
      POLICY
    );

    assert.equal(formatScaled(semester.result.sgpa.valueScaled ?? 0, GPA_SCALE), "10.000000");
    assert.equal(semester.result.backlogCount, 0);
    assert.equal(semester.result.isPromoted, true);
    assert.equal(formatMark(semester.credits.creditsEarnedScaled), "7.00");
  });

  it("counts a backlog and withholds promotion", () => {
    const semester = calculateSemester(
      "sem_1",
      [courseInput("math", "4", passing), courseInput("physics", "3", failing)],
      POLICY
    );

    assert.equal(semester.result.backlogCount, 1);
    assert.equal(semester.result.isPromoted, false);
    assert.equal(formatMark(semester.credits.creditsEarnedScaled), "4.00");
  });

  it("does not promote while a cohort operation is outstanding", () => {
    const deferredScheme = scheme({
      rules: [
        {
          id: "rule_mod",
          code: "MOD",
          componentId: null,
          phase: RulePhase.COURSE_ADJUSTMENT,
          operation: RuleOperation.MODERATION,
          sequence: 1,
          config: {},
          condition: null,
        },
      ],
    });

    const semester = calculateSemester(
      "sem_1",
      [courseInput("math", "4", passing, deferredScheme)],
      POLICY
    );

    assert.deepEqual(semester.pendingOperations, ["MOD"]);
    assert.equal(semester.result.isPromoted, false);
  });

  it("does not promote when the caller supplies a semester-level failure", () => {
    const semester = calculateSemester(
      "sem_1",
      [courseInput("math", "4", passing)],
      POLICY,
      [
        {
          code: "MIN_CREDITS",
          metric: PassingMetric.SEMESTER_CREDITS_EARNED,
          thresholdScaled: toScaled("20"),
          actualScaled: toScaled("4"),
          outcome: CriterionOutcome.FAIL,
        },
      ]
    );

    assert.equal(semester.result.isPromoted, false);
  });

  it("handles a 100-course semester", () => {
    const prepared = scheme();
    const courses = Array.from({ length: 100 }, (_value, index) =>
      courseInput(`course_${index}`, "3", passing, prepared)
    );

    const semester = calculateSemester("sem_big", courses, POLICY);

    assert.equal(semester.result.courses.length, 100);
    assert.equal(formatScaled(semester.result.sgpa.valueScaled ?? 0, GPA_SCALE), "10.000000");
    assert.equal(formatMark(semester.credits.creditsEarnedScaled), "300.00");
    assert.equal(semester.errors.length, 0);
  });

  it("computes a thousand students against one prepared scheme", () => {
    const prepared = scheme();
    const sgpas = new Set<string>();

    for (let student = 0; student < 1000; student += 1) {
      const external = String(20 + (student % 50));
      const semester = calculateSemester(
        `sem_${student}`,
        [
          courseInput(
            "math",
            "4",
            [
              mark("sessional", 1, "15", "20"),
              mark("sessional", 2, "15", "20"),
              mark("assignment", 1, "8", "10"),
              mark("external", 1, external, "70"),
            ],
            prepared
          ),
        ],
        POLICY
      );

      assert.equal(semester.errors.length, 0);
      sgpas.add(formatScaled(semester.result.sgpa.valueScaled ?? 0, GPA_SCALE));
    }

    assert.ok(sgpas.size > 1, "the cohort genuinely differs, so nothing was cached wrongly");
  });
});

describe("calculateStudent and the transcript", () => {
  function entry(
    courseId: string,
    credits: string,
    point: string | null,
    overrides: Partial<GpaCourseEntry> = {}
  ): GpaCourseEntry {
    return {
      courseId,
      courseRegistrationId: `reg_${courseId}_1`,
      attemptNumber: 1,
      registrationType: RegistrationType.REGULAR,
      creditsScaled: toScaled(credits),
      gradePointScaled: point === null ? null : toScaled(point),
      countsForGpa: true,
      outcome: point === null ? COURSE_OUTCOME.INCOMPLETE : COURSE_OUTCOME.PASS,
      ...overrides,
    };
  }

  function semesterOf(semesterId: string, entries: readonly GpaCourseEntry[]) {
    return calculateSemester(
      semesterId,
      entries.map((item) => ({
        entry: item,
        computation: {
          result: null,
          warnings: [],
          errors: [],
          pendingOperations: [],
          deferredCodes: [],
        },
      })),
      POLICY
    );
  }

  it("builds a transcript with a RUNNING CGPA per line", () => {
    const first = [entry("a", "4", "10"), entry("b", "4", "8")];
    const second = [entry("c", "4", "6"), entry("d", "4", "4")];

    const student = calculateStudent(
      "student_1",
      [semesterOf("sem_1", first), semesterOf("sem_2", second)],
      [first, second],
      AttemptPolicy.LATEST_ATTEMPT,
      POLICY,
      scheme().bands
    );

    assert.equal(student.transcript.length, 2);
    assert.equal(formatScaled(student.transcript[0].cgpaScaled ?? 0, GPA_SCALE), "9.000000");
    assert.equal(formatScaled(student.transcript[1].cgpaScaled ?? 0, GPA_SCALE), "7.000000");
    assert.equal(formatScaled(student.transcript[0].sgpaScaled ?? 0, GPA_SCALE), "9.000000");
  });

  it("reads a CLASSIFICATION off the tenant's own bands", () => {
    // CGPA 9.0 of 10 is 90%, which this scale calls Outstanding.
    const entries = [entry("a", "4", "9"), entry("b", "4", "9")];

    const student = calculateStudent(
      "student_1",
      [semesterOf("sem_1", entries)],
      [entries],
      AttemptPolicy.LATEST_ATTEMPT,
      POLICY,
      scheme().bands
    );

    assert.equal(formatMark(student.standing.cgpaPercentScaled ?? 0), "90.00");
    assert.equal(student.standing.classification, "Outstanding");
    assert.equal(student.standing.grade, "O");
    assert.equal(student.standing.isClear, true);
  });

  it("a weaker student reads a different classification from the SAME bands", () => {
    const entries = [entry("a", "4", "6"), entry("b", "4", "6")];

    const student = calculateStudent(
      "student_2",
      [semesterOf("sem_1", entries)],
      [entries],
      AttemptPolicy.LATEST_ATTEMPT,
      POLICY,
      scheme().bands
    );

    assert.equal(student.standing.classification, "First Class");
  });

  it("is not clear while a backlog stands", () => {
    const entries = [
      entry("a", "4", "9"),
      entry("b", "4", "0", { countsForGpa: false, outcome: COURSE_OUTCOME.FAIL }),
    ];

    const student = calculateStudent(
      "student_3",
      [semesterOf("sem_1", entries)],
      [entries],
      AttemptPolicy.LATEST_ATTEMPT,
      POLICY,
      scheme().bands
    );

    assert.equal(student.standing.backlogCount, 1);
    assert.equal(student.standing.isClear, false);
  });

  it("applies the attempt policy ACROSS semesters, so a later re-sit counts", () => {
    const first = [
      entry("math", "4", "0", {
        courseRegistrationId: "r1",
        countsForGpa: false,
        outcome: COURSE_OUTCOME.FAIL,
      }),
    ];
    const second = [
      entry("math", "4", "8", {
        attemptNumber: 2,
        courseRegistrationId: "r2",
        registrationType: RegistrationType.BACKLOG,
      }),
    ];

    const student = calculateStudent(
      "student_4",
      [semesterOf("sem_1", first), semesterOf("sem_2", second)],
      [first, second],
      AttemptPolicy.BEST_ATTEMPT,
      POLICY,
      scheme().bands
    );

    assert.equal(formatScaled(student.cgpa.valueScaled ?? 0, GPA_SCALE), "8.000000");
    assert.equal(student.standing.backlogCount, 0, "the re-sit cleared it");
    assert.equal(formatMark(student.credits.creditsEarnedScaled), "4.00");
  });

  it("has no standing when nothing has been graded yet", () => {
    const entries = [entry("a", "4", null)];

    const student = calculateStudent(
      "student_5",
      [semesterOf("sem_1", entries)],
      [entries],
      AttemptPolicy.LATEST_ATTEMPT,
      POLICY,
      scheme().bands
    );

    assert.equal(student.cgpa.valueScaled, null, "null, not zero");
    assert.equal(student.standing.classification, null);
  });
});

describe("buildGradeCard", () => {
  function cardFor(marks: readonly AssessmentValue[], prepared = scheme()) {
    const computation = calculateCourse(prepared, input(marks));

    const semester = calculateSemester(
      "sem_1",
      [
        {
          entry: {
            courseId: "math",
            courseRegistrationId: "reg_1",
            attemptNumber: 1,
            registrationType: RegistrationType.REGULAR,
            creditsScaled: toScaled("4"),
            gradePointScaled: computation.result?.grade?.gradePointScaled ?? null,
            countsForGpa: computation.result?.grade?.countsForGpa ?? false,
            outcome: computation.result?.outcome ?? COURSE_OUTCOME.INCOMPLETE,
          },
          computation,
        },
      ],
      POLICY
    );

    return buildGradeCard("student_1", semester);
  }

  it("renders one line per course, carrying the grade and its label", () => {
    const card = cardFor(fullMarks());

    assert.equal(card.lines.length, 1);
    assert.equal(card.lines[0].grade, "O");
    assert.equal(card.lines[0].label, "Outstanding");
    assert.equal(formatMark(card.lines[0].percentageScaled), "100.00");
    assert.equal(formatMark(card.lines[0].creditsEarnedScaled), "4.00");
    assert.equal(card.isPromoted, true);
    assert.equal(card.isProvisional, false);
  });

  it("marks the card PROVISIONAL while a cohort operation is outstanding", () => {
    const deferredScheme = scheme({
      rules: [
        {
          id: "rule_crv",
          code: "CRV",
          componentId: null,
          phase: RulePhase.COURSE_ADJUSTMENT,
          operation: RuleOperation.CURVE,
          sequence: 1,
          config: {},
          condition: null,
        },
      ],
    });

    const card = cardFor(fullMarks(), deferredScheme);

    assert.equal(card.isProvisional, true, "these marks are not final and the card must say so");
  });

  it("computes nothing of its own — every figure came from an earlier stage", () => {
    const card = cardFor(fullMarks());

    assert.equal(card.sgpa.valueScaled, card.sgpa.valueScaled);
    assert.equal(
      formatMark(card.credits.creditsEarnedScaled),
      formatMark(card.lines[0].creditsEarnedScaled)
    );
  });

  it("shows a failed course without credit", () => {
    const card = cardFor([
      mark("sessional", 1, "2", "20"),
      mark("sessional", 2, "2", "20"),
      mark("assignment", 1, "1", "10"),
      mark("external", 1, "5", "70"),
    ]);

    assert.equal(card.lines[0].grade, "F");
    assert.equal(card.lines[0].outcome, COURSE_OUTCOME.FAIL);
    assert.equal(card.lines[0].creditsEarnedScaled, 0);
    assert.equal(card.backlogCount, 1);
    assert.equal(card.isPromoted, false);
  });
});
