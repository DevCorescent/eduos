// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Grade Resolution
// LAYER  : Domain — Unit Tests
// PURPOSE: Prove that every academic judgement came from configuration, and
//          that a band table which could grade someone wrongly is refused
//          before it grades anyone at all.
//
//          The boundary cases carry the most weight. A band table is a set of
//          closed intervals, and every real dispute about a grade happens at
//          39.99, 40.00 or 40.01.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RoundingMode } from "@/app/generated/prisma/enums";
import { toScaled } from "@/lib/domain/result-engine/decimal";
import { CriterionOutcome, PassingMetric, ThresholdUnit } from "@/lib/domain/result-engine/enums";
import {
  GRADING_ERROR,
  applyFailOverride,
  evaluateCriteria,
  findBand,
  prepareBandTable,
  resolveGrade,
  worstOutcome,
  type BandTable,
} from "@/lib/domain/result-engine/grading";
import type {
  CriterionDefinition,
  GradeBandDefinition,
  RoundingPolicy,
} from "@/lib/domain/result-engine/types";

function band(
  grade: string,
  min: string,
  max: string,
  point: string,
  isPass: boolean,
  overrides: Partial<GradeBandDefinition> = {}
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
    ...overrides,
  };
}

/**
 * A ten-point Indian scale, with classification carried in the LABEL — which is
 * the only place a "First Class" can live without the engine inventing one.
 */
const INDIAN_BANDS: readonly GradeBandDefinition[] = [
  band("F", "0", "39.99", "0", false, { label: "Fail", sequence: 6 }),
  band("C", "40", "49.99", "5", true, { label: "Second Class", sequence: 5 }),
  band("B", "50", "59.99", "6", true, { label: "Second Class", sequence: 4 }),
  band("A", "60", "74.99", "8", true, { label: "First Class", sequence: 3 }),
  band("A+", "75", "89.99", "9", true, { label: "First Class with Distinction", sequence: 2 }),
  band("O", "90", "100", "10", true, { label: "Outstanding", sequence: 1 }),
];

const MAX_GRADE_POINT = toScaled("10");

const POLICY: RoundingPolicy = {
  marksRounding: RoundingMode.HALF_UP,
  marksPrecision: 2,
  gpaRounding: RoundingMode.HALF_UP,
  gpaPrecision: 2,
};

/** Prepare and assert success. */
function table(
  bands: readonly GradeBandDefinition[] = INDIAN_BANDS,
  ceiling = MAX_GRADE_POINT
): BandTable {
  const outcome = prepareBandTable(bands, ceiling);
  assert.ok(outcome.ok, outcome.ok ? "" : `refused: ${outcome.failure.code}`);
  return outcome.value;
}

function expectRefusal(bands: readonly GradeBandDefinition[], code: string): void {
  const outcome = prepareBandTable(bands, MAX_GRADE_POINT);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.failure.code, code);
  }
}

/** Resolve and assert success. */
function grade(percent: string, policy = POLICY, prepared = table()) {
  const outcome = resolveGrade(prepared, toScaled(percent), policy);
  assert.ok(outcome.ok, outcome.ok ? "" : `failed: ${outcome.failure.code}`);
  return outcome.value;
}

describe("prepareBandTable — refuses a table that could grade someone wrongly", () => {
  it("refuses an empty table", () => {
    expectRefusal([], GRADING_ERROR.MISSING_BANDS);
  });

  it("refuses a band no percentage can reach", () => {
    expectRefusal(
      [band("X", "60", "40", "5", true), ...INDIAN_BANDS],
      GRADING_ERROR.UNREACHABLE_BAND
    );
  });

  it("refuses OVERLAPPING bands, where one mark would resolve two ways", () => {
    const overlapping = [
      band("F", "0", "45", "0", false),
      band("C", "40", "59.99", "5", true),
      band("A", "60", "100", "8", true),
    ];

    expectRefusal(overlapping, GRADING_ERROR.OVERLAPPING_BANDS);
  });

  it("refuses a GAP, where a mark would resolve no way at all", () => {
    // Nothing covers 40.00 to 49.99.
    const gapped = [
      band("F", "0", "39.99", "0", false),
      band("B", "50", "100", "6", true),
    ];

    expectRefusal(gapped, GRADING_ERROR.BAND_GAP);
  });

  it("refuses a table that does not start at 0.00", () => {
    expectRefusal(
      [band("C", "40", "100", "5", true)],
      GRADING_ERROR.INCOMPLETE_COVERAGE
    );
  });

  it("refuses a table that does not reach 100.00", () => {
    expectRefusal(
      [band("F", "0", "39.99", "0", false), band("C", "40", "99", "5", true)],
      GRADING_ERROR.INCOMPLETE_COVERAGE
    );
  });

  it("refuses two bands sharing a letter", () => {
    expectRefusal(
      [
        band("F", "0", "39.99", "0", false),
        band("F", "40", "100", "5", true),
      ],
      GRADING_ERROR.DUPLICATE_GRADE
    );
  });

  it("refuses a grade point above the scale's own ceiling", () => {
    expectRefusal(
      [band("F", "0", "39.99", "0", false), band("X", "40", "100", "11", true)],
      GRADING_ERROR.INVALID_SCALE
    );
  });

  it("refuses a negative grade point", () => {
    expectRefusal(
      [band("F", "0", "39.99", "-1", false), band("C", "40", "100", "5", true)],
      GRADING_ERROR.INVALID_SCALE
    );
  });

  it("refuses a scale where nothing can pass", () => {
    expectRefusal(
      [band("F", "0", "100", "0", false)],
      GRADING_ERROR.INVALID_SCALE
    );
  });

  it("accepts a well-formed table and orders it ascending", () => {
    const prepared = table();

    assert.deepEqual(
      prepared.bands.map((entry) => entry.grade),
      ["F", "C", "B", "A", "A+", "O"]
    );
  });

  it("derives the pass mark from the lowest PASSING band", () => {
    assert.equal(table().passMarkScaled, toScaled("40"));
  });

  it("derives the fail band by position, never by letter", () => {
    // The bottom band is chosen because it is the lowest non-passing one, not
    // because it happens to be called F.
    assert.equal(table().failBand?.grade, "F");
  });

  it("does not mutate the caller's array", () => {
    const input = [...INDIAN_BANDS];
    const snapshot = input.map((entry) => entry.grade).join(",");

    prepareBandTable(input, MAX_GRADE_POINT);

    assert.equal(input.map((entry) => entry.grade).join(","), snapshot);
  });

  it("accepts a four-point US scale with its own ceiling", () => {
    const us = [
      band("F", "0", "59.99", "0", false, { countsForGpa: true }),
      band("D", "60", "69.99", "1", true),
      band("C", "70", "79.99", "2", true),
      band("B", "80", "89.99", "3", true),
      band("A", "90", "100", "4", true),
    ];

    const prepared = table(us, toScaled("4"));

    assert.equal(prepared.passMarkScaled, toScaled("60"));
    assert.equal(prepared.maxGradePointScaled, toScaled("4"));
  });
});

describe("findBand — boundaries", () => {
  const prepared = table();

  it("both bounds are INCLUSIVE", () => {
    assert.equal(findBand(prepared, toScaled("40"))?.grade, "C");
    assert.equal(findBand(prepared, toScaled("49.99"))?.grade, "C");
  });

  it("one hundredth decides the band", () => {
    assert.equal(findBand(prepared, toScaled("39.99"))?.grade, "F");
    assert.equal(findBand(prepared, toScaled("40"))?.grade, "C");
  });

  it("finds the extremes", () => {
    assert.equal(findBand(prepared, toScaled("0"))?.grade, "F");
    assert.equal(findBand(prepared, toScaled("100"))?.grade, "O");
  });

  it("returns null outside the covered range", () => {
    assert.equal(findBand(prepared, toScaled("100.01")), null);
    assert.equal(findBand(prepared, toScaled("-0.01")), null);
  });

  it("agrees with a linear scan at every hundredth", () => {
    // The binary search is the only lookup in the engine; if it disagrees with
    // the obvious implementation anywhere, every grade is suspect.
    for (let percent = 0; percent <= 10_000; percent += 1) {
      const found = findBand(prepared, percent);
      const scanned = prepared.bands.find(
        (entry) => percent >= entry.minPercentScaled && percent <= entry.maxPercentScaled
      );

      assert.equal(found?.grade, scanned?.grade, `disagreement at ${percent}`);
    }
  });
});

describe("resolveGrade", () => {
  it("awards the band's letter, point and classification LABEL", () => {
    const resolved = grade("78");

    assert.equal(resolved.grade, "A+");
    assert.equal(resolved.label, "First Class with Distinction");
    assert.equal(resolved.gradePointScaled, toScaled("9"));
    assert.equal(resolved.isPass, true);
    assert.equal(resolved.isOverridden, false);
  });

  it("reads classification from configuration, never from a threshold", () => {
    // Two universities disagree about where first class begins. Both are right,
    // and only their own band tables can say so.
    const lenient = table([
      band("F", "0", "39.99", "0", false, { label: "Fail" }),
      band("P", "40", "54.99", "5", true, { label: "Second Class" }),
      band("A", "55", "100", "8", true, { label: "First Class" }),
    ]);

    assert.equal(grade("57", POLICY, lenient).label, "First Class");
    assert.equal(grade("57").label, "Second Class", "the strict table disagrees, correctly");
  });

  it("fails a percentage no band covers", () => {
    const outcome = resolveGrade(table(), toScaled("120"), POLICY);

    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.failure.code, GRADING_ERROR.NO_BAND);
    }
  });

  it("rounds to the REGULATION's precision before looking up", () => {
    // 59.6 at whole-percent precision IS 60, and 60 is an A. Looking the
    // unrounded figure up would award a B the transcript contradicts.
    const wholePercent: RoundingPolicy = { ...POLICY, marksPrecision: 0 };

    assert.equal(grade("59.6", wholePercent).grade, "A");
    assert.equal(grade("59.6").grade, "B", "at two places it stays a B");
  });

  it("respects a regulation that rounds DOWN", () => {
    const roundsDown: RoundingPolicy = {
      ...POLICY,
      marksPrecision: 0,
      marksRounding: RoundingMode.FLOOR,
    };

    assert.equal(grade("59.6", roundsDown).grade, "B");
  });

  it("resolves the same answer every time it is asked", () => {
    const prepared = table();

    assert.deepEqual(grade("63.5", POLICY, prepared), grade("63.5", POLICY, prepared));
  });
});

describe("applyFailOverride", () => {
  const prepared = table();

  it("replaces a passing grade with the scale's own bottom band", () => {
    const overridden = applyFailOverride(prepared, grade("85"));

    assert.equal(overridden.grade, "F");
    assert.equal(overridden.gradePointScaled, toScaled("0"));
    assert.equal(overridden.isPass, false);
    assert.equal(overridden.isOverridden, true);
  });

  it("does NOT award zero when the scale's fail band awards something else", () => {
    const withNonZeroFail = table([
      band("E", "0", "39.99", "2", false, { label: "Fail" }),
      band("P", "40", "100", "8", true),
    ]);

    const overridden = applyFailOverride(withNonZeroFail, grade("85", POLICY, withNonZeroFail));

    assert.equal(overridden.gradePointScaled, toScaled("2"), "the scale's number, not the engine's");
  });

  it("leaves an already-failing grade alone but marks it overridden", () => {
    const failing = grade("20");
    const overridden = applyFailOverride(prepared, failing);

    assert.equal(overridden.grade, failing.grade);
    assert.equal(overridden.gradePointScaled, failing.gradePointScaled);
    assert.equal(overridden.isOverridden, true);
  });

  it("does not mutate the resolution it was given", () => {
    const original = grade("85");
    applyFailOverride(prepared, original);

    assert.equal(original.grade, "A+");
    assert.equal(original.isPass, true);
    assert.equal(original.isOverridden, false);
  });
});

describe("evaluateCriteria", () => {
  function criterion(overrides: Partial<CriterionDefinition> = {}): CriterionDefinition {
    return {
      id: "criterion_1",
      code: "MIN_INTERNAL",
      componentId: "internal",
      metric: PassingMetric.COMPONENT_SCORE,
      thresholdScaled: toScaled("40"),
      unit: ThresholdUnit.PERCENT,
      failureOutcome: CriterionOutcome.FAIL,
      ...overrides,
    };
  }

  const scores = new Map([
    ["internal", { valueScaled: toScaled("12"), maxScaled: toScaled("30") }],
  ]);

  function inputs(overrides = {}) {
    return {
      componentScores: scores,
      attendancePercentScaled: toScaled("82"),
      semesterCreditsEarnedScaled: null,
      rounding: RoundingMode.HALF_UP,
      ...overrides,
    };
  }

  it("passes a component exactly on the threshold", () => {
    // 12 of 30 is exactly 40%.
    assert.deepEqual(evaluateCriteria([criterion()], inputs()).failures, []);
  });

  it("fails a component one hundredth below", () => {
    const below = new Map([
      ["internal", { valueScaled: toScaled("11.99"), maxScaled: toScaled("30") }],
    ]);

    const { failures } = evaluateCriteria(
      [criterion()],
      inputs({ componentScores: below })
    );

    assert.equal(failures.length, 1);
    assert.equal(failures[0].code, "MIN_INTERNAL");
  });

  it("compares MARKS thresholds on the component's own scale", () => {
    const { failures } = evaluateCriteria(
      [criterion({ unit: ThresholdUnit.MARKS, thresholdScaled: toScaled("15") })],
      inputs()
    );

    assert.equal(failures.length, 1, "12 marks is below a 15-mark minimum");
  });

  it("checks attendance", () => {
    const attendance = criterion({
      code: "MIN_ATTENDANCE",
      componentId: null,
      metric: PassingMetric.ATTENDANCE_PERCENT,
      thresholdScaled: toScaled("75"),
      failureOutcome: CriterionOutcome.INELIGIBLE,
    });

    assert.deepEqual(evaluateCriteria([attendance], inputs()).failures, []);

    const { failures } = evaluateCriteria(
      [attendance],
      inputs({ attendancePercentScaled: toScaled("60") })
    );

    assert.equal(failures[0].outcome, CriterionOutcome.INELIGIBLE);
  });

  it("SKIPS rather than fails a criterion whose figure was never supplied", () => {
    // Failing a student for a number nobody recorded would be a fabrication.
    const attendance = criterion({
      code: "MIN_ATTENDANCE",
      componentId: null,
      metric: PassingMetric.ATTENDANCE_PERCENT,
      thresholdScaled: toScaled("75"),
    });

    const { failures, unevaluated } = evaluateCriteria(
      [attendance],
      inputs({ attendancePercentScaled: null })
    );

    assert.deepEqual(failures, []);
    assert.deepEqual(unevaluated, ["MIN_ATTENDANCE"]);
  });

  it("skips a criterion naming a component this scheme does not contain", () => {
    const { failures, unevaluated } = evaluateCriteria(
      [criterion({ componentId: "absent_component" })],
      inputs()
    );

    assert.deepEqual(failures, []);
    assert.equal(unevaluated.length, 1);
  });

  it("reports EVERY failure, not just the first", () => {
    const { failures } = evaluateCriteria(
      [
        criterion({ code: "A", unit: ThresholdUnit.MARKS, thresholdScaled: toScaled("20") }),
        criterion({ code: "B", unit: ThresholdUnit.MARKS, thresholdScaled: toScaled("25") }),
      ],
      inputs()
    );

    assert.deepEqual(
      failures.map((entry) => entry.code),
      ["A", "B"],
      "a student is entitled to know all of what they must clear"
    );
  });

  it("records the actual figure alongside the threshold", () => {
    const { failures } = evaluateCriteria(
      [criterion({ unit: ThresholdUnit.MARKS, thresholdScaled: toScaled("20") })],
      inputs()
    );

    assert.equal(failures[0].actualScaled, toScaled("12"));
    assert.equal(failures[0].thresholdScaled, toScaled("20"));
  });
});

describe("worstOutcome", () => {
  it("is null when nothing failed", () => {
    assert.equal(worstOutcome([]), null);
  });

  it("INELIGIBLE outranks FAIL whichever order they arrive in", () => {
    const failed = {
      code: "A",
      metric: PassingMetric.COMPONENT_SCORE,
      thresholdScaled: 0,
      actualScaled: 0,
      outcome: CriterionOutcome.FAIL,
    };
    const barred = { ...failed, code: "B", outcome: CriterionOutcome.INELIGIBLE };

    assert.equal(worstOutcome([failed, barred]), CriterionOutcome.INELIGIBLE);
    assert.equal(worstOutcome([barred, failed]), CriterionOutcome.INELIGIBLE);
  });

  it("is FAIL when only ordinary failures occurred", () => {
    assert.equal(
      worstOutcome([
        {
          code: "A",
          metric: PassingMetric.COMPONENT_SCORE,
          thresholdScaled: 0,
          actualScaled: 0,
          outcome: CriterionOutcome.FAIL,
        },
      ]),
      CriterionOutcome.FAIL
    );
  });
});
