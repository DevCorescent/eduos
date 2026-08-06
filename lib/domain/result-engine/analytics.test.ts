// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Analytics
// LAYER  : Domain — Unit Tests
// PURPOSE: Prove that a statistic never invents a result, and that a student
//          whose marks are sealed does not depress their whole cohort.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RoundingMode } from "@/app/generated/prisma/enums";
import { GPA_SCALE } from "@/lib/constants/resultEngine";
import { formatMark, formatScaled, toScaled } from "@/lib/domain/result-engine/decimal";
import { COURSE_OUTCOME, type CourseOutcome } from "@/lib/domain/result-engine/enums";
import { RANK_SCOPE } from "@/lib/domain/result-engine/ranking";
import {
  buildMeritList,
  componentBreakdown,
  creditPosition,
  gradeDistribution,
  median,
  semesterTrend,
  summariseCohort,
  trendDelta,
  type CohortMember,
} from "@/lib/domain/result-engine/analytics";
import type {
  ComponentResult,
  CourseResultValue,
  RoundingPolicy,
  TranscriptRow,
} from "@/lib/domain/result-engine/types";

const POLICY: RoundingPolicy = {
  marksRounding: RoundingMode.HALF_UP,
  marksPrecision: 2,
  gpaRounding: RoundingMode.HALF_UP,
  gpaPrecision: 2,
};

function member(
  studentId: string,
  percent: string | null,
  grade: string | null,
  outcome: CourseOutcome = COURSE_OUTCOME.PASS,
  sgpa: string | null = "8"
): CohortMember {
  return {
    studentId,
    percentageScaled: percent === null ? null : toScaled(percent),
    sgpaScaled: sgpa === null ? null : toScaled(sgpa),
    grade,
    outcome,
    creditsEarnedScaled: toScaled("4"),
  };
}

describe("summariseCohort", () => {
  const cohort = [
    member("a", "90", "A"),
    member("b", "70", "B"),
    member("c", "55", "C"),
    member("d", "30", "F", COURSE_OUTCOME.FAIL),
  ];

  it("counts passes and failures", () => {
    const stats = summariseCohort(cohort, POLICY);

    assert.equal(stats.total, 4);
    assert.equal(stats.evaluated, 4);
    assert.equal(stats.passed, 3);
    assert.equal(stats.failed, 1);
    assert.equal(stats.pending, 0);
  });

  it("computes pass and fail percentages exactly", () => {
    const stats = summariseCohort(cohort, POLICY);

    assert.equal(formatMark(stats.passPercentScaled ?? 0), "75.00");
    assert.equal(formatMark(stats.failPercentScaled ?? 0), "25.00");
  });

  it("computes the average, median and extremes", () => {
    const stats = summariseCohort(cohort, POLICY);

    // (90 + 70 + 55 + 30) / 4 = 61.25.
    assert.equal(formatMark(stats.averageScaled ?? 0), "61.25");
    // Middle pair of 30, 55, 70, 90 is 55 and 70 -> 62.50.
    assert.equal(formatMark(stats.medianScaled ?? 0), "62.50");
    assert.equal(formatMark(stats.highestScaled ?? 0), "90.00");
    assert.equal(formatMark(stats.lowestScaled ?? 0), "30.00");
  });

  it("EXCLUDES a withheld student from every average", () => {
    // A sealed result is not a zero. Letting it divide the mean would depress a
    // whole cohort's reported performance.
    const withPending = [...cohort, member("e", null, null, COURSE_OUTCOME.WITHHELD, null)];
    const stats = summariseCohort(withPending, POLICY);

    assert.equal(stats.total, 5, "still counted as a member of the cohort");
    assert.equal(stats.evaluated, 4);
    assert.equal(stats.pending, 1);
    assert.equal(formatMark(stats.averageScaled ?? 0), "61.25", "unchanged");
  });

  it("EXCLUDES an incomplete student too", () => {
    const stats = summariseCohort(
      [...cohort, member("e", null, null, COURSE_OUTCOME.INCOMPLETE, null)],
      POLICY
    );

    assert.equal(stats.pending, 1);
    assert.equal(formatMark(stats.passPercentScaled ?? 0), "75.00", "divides by evaluated");
  });

  it("reports nulls rather than zeroes for a cohort nobody has graded", () => {
    const stats = summariseCohort(
      [member("a", null, null, COURSE_OUTCOME.WITHHELD, null)],
      POLICY
    );

    assert.equal(stats.passPercentScaled, null);
    assert.equal(stats.averageScaled, null);
    assert.equal(stats.medianScaled, null);
    assert.equal(stats.highestScaled, null);
  });

  it("handles an empty cohort", () => {
    const stats = summariseCohort([], POLICY);

    assert.equal(stats.total, 0);
    assert.equal(stats.averageScaled, null);
  });

  it("summarises a thousand students in one pass", () => {
    const large = Array.from({ length: 1000 }, (_value, index) =>
      member(
        `s${index}`,
        String(30 + (index % 70)),
        index % 70 >= 10 ? "B" : "F",
        index % 70 >= 10 ? COURSE_OUTCOME.PASS : COURSE_OUTCOME.FAIL
      )
    );

    const stats = summariseCohort(large, POLICY);

    assert.equal(stats.total, 1000);
    assert.equal(stats.passed + stats.failed, 1000);
  });
});

describe("median", () => {
  it("takes the middle of an odd-sized set", () => {
    assert.equal(formatMark(median([toScaled("10"), toScaled("30"), toScaled("20")], POLICY) ?? 0), "20.00");
  });

  it("takes the exact mean of the middle pair of an even-sized set", () => {
    // 67 and 68 must give 67.50, not 67.49999.
    assert.equal(formatMark(median([toScaled("67"), toScaled("68")], POLICY) ?? 0), "67.50");
  });

  it("is null for an empty set", () => {
    assert.equal(median([], POLICY), null);
  });

  it("does not mutate the caller's array", () => {
    const values = [toScaled("30"), toScaled("10"), toScaled("20")];
    median(values, POLICY);

    assert.equal(formatMark(values[0]), "30.00");
  });
});

describe("gradeDistribution", () => {
  it("counts each grade and its share", () => {
    const rows = gradeDistribution(
      [
        member("a", "90", "A"),
        member("b", "88", "A"),
        member("c", "70", "B"),
        member("d", "30", "F", COURSE_OUTCOME.FAIL),
      ],
      POLICY
    );

    assert.equal(rows.length, 3);
    assert.equal(rows[0].grade, "A");
    assert.equal(rows[0].count, 2);
    assert.equal(formatMark(rows[0].percentScaled), "50.00");
  });

  it("orders by count descending, then by grade, so two runs agree", () => {
    const members = [
      member("a", "90", "B"),
      member("b", "88", "A"),
      member("c", "70", "B"),
      member("d", "60", "C"),
    ];

    const forward = gradeDistribution(members, POLICY).map((row) => row.grade);
    const reversed = gradeDistribution([...members].reverse(), POLICY).map((row) => row.grade);

    assert.deepEqual(forward, ["B", "A", "C"]);
    assert.deepEqual(forward, reversed);
  });

  it("ignores students with no grade", () => {
    const rows = gradeDistribution(
      [member("a", "90", "A"), member("b", null, null, COURSE_OUTCOME.WITHHELD, null)],
      POLICY
    );

    assert.equal(rows.length, 1);
    assert.equal(formatMark(rows[0].percentScaled), "100.00");
  });

  it("returns nothing for a cohort with no grades", () => {
    assert.deepEqual(gradeDistribution([], POLICY), []);
  });
});

describe("buildMeritList", () => {
  it("ranks on SGPA and reports the scope", () => {
    const result = buildMeritList(
      [member("a", "70", "B", COURSE_OUTCOME.PASS, "7"), member("b", "90", "A", COURSE_OUTCOME.PASS, "9")],
      RANK_SCOPE.PROGRAMME
    );

    assert.equal(result.scope, RANK_SCOPE.PROGRAMME);
    assert.deepEqual(result.ranked.map((entry) => entry.subjectId), ["b", "a"]);
  });

  it("breaks an SGPA tie on percentage", () => {
    const result = buildMeritList(
      [
        member("a", "70", "B", COURSE_OUTCOME.PASS, "8"),
        member("b", "85", "A", COURSE_OUTCOME.PASS, "8"),
      ],
      RANK_SCOPE.CLASS
    );

    assert.deepEqual(result.ranked.map((entry) => entry.subjectId), ["b", "a"]);
  });

  it("excludes an ungraded student rather than ranking them last", () => {
    const result = buildMeritList(
      [member("a", "70", "B"), member("sealed", null, null, COURSE_OUTCOME.WITHHELD, null)],
      RANK_SCOPE.SECTION
    );

    assert.deepEqual(result.unranked, ["sealed"]);
    assert.equal(result.ranked.length, 1);
  });
});

describe("creditPosition", () => {
  function course(
    credits: string,
    outcome: CourseOutcome,
    earned: string
  ): CourseResultValue {
    return {
      courseRegistrationId: `reg_${outcome}_${credits}`,
      evaluationSchemeId: "scheme_1",
      components: [],
      percentageScaled: 0,
      grade: null,
      outcome,
      creditsScaled: toScaled(credits),
      creditsEarnedScaled: toScaled(earned),
      failedCriteria: [],
      pendingCohortRules: [],
    };
  }

  it("SEPARATES pending credits from failed ones", () => {
    // Both are credits the student does not hold, but only one is their fault.
    const position = creditPosition([
      course("4", COURSE_OUTCOME.PASS, "4"),
      course("3", COURSE_OUTCOME.FAIL, "0"),
      course("2", COURSE_OUTCOME.WITHHELD, "0"),
    ]);

    assert.equal(formatMark(position.registeredScaled), "9.00");
    assert.equal(formatMark(position.earnedScaled), "4.00");
    assert.equal(formatMark(position.failedScaled), "3.00");
    assert.equal(formatMark(position.pendingScaled), "2.00");
  });

  it("counts an incomplete course as pending, not failed", () => {
    const position = creditPosition([course("4", COURSE_OUTCOME.INCOMPLETE, "0")]);

    assert.equal(formatMark(position.pendingScaled), "4.00");
    assert.equal(formatMark(position.failedScaled), "0.00");
  });

  it("counts an ineligible course as failed", () => {
    const position = creditPosition([course("4", COURSE_OUTCOME.INELIGIBLE, "0")]);

    assert.equal(formatMark(position.failedScaled), "4.00");
  });

  it("totals nothing for no courses", () => {
    assert.equal(creditPosition([]).registeredScaled, 0);
  });
});

describe("componentBreakdown", () => {
  function componentResult(
    code: string,
    achieved: string,
    max: string,
    isLeaf = true
  ): ComponentResult {
    return {
      componentId: code.toLowerCase(),
      code,
      isLeaf,
      rawScaled: toScaled(achieved),
      adjustedScaled: toScaled(achieved),
      maxMarksScaled: toScaled(max),
      contributionScaled: 0,
      sessionCount: 1,
    };
  }

  function course(components: readonly ComponentResult[]): CourseResultValue {
    return {
      courseRegistrationId: "reg_1",
      evaluationSchemeId: "scheme_1",
      components,
      percentageScaled: 0,
      grade: null,
      outcome: COURSE_OUTCOME.PASS,
      creditsScaled: toScaled("4"),
      creditsEarnedScaled: toScaled("4"),
      failedCriteria: [],
      pendingCohortRules: [],
    };
  }

  it("totals a component across every course that carries it", () => {
    const rows = componentBreakdown(
      [
        course([componentResult("INT", "24", "30"), componentResult("EXT", "50", "70")]),
        course([componentResult("INT", "18", "30"), componentResult("EXT", "60", "70")]),
      ],
      POLICY
    );

    const byCode = new Map(rows.map((row) => [row.code, row]));

    assert.equal(formatMark(byCode.get("INT")?.achievedScaled ?? 0), "42.00");
    assert.equal(formatMark(byCode.get("INT")?.maxScaled ?? 0), "60.00");
    assert.equal(formatMark(byCode.get("INT")?.percentScaled ?? 0), "70.00");
    assert.equal(byCode.get("INT")?.courseCount, 2);
  });

  it("EXCLUDES branch components, which would double-count their children", () => {
    const rows = componentBreakdown(
      [
        course([
          componentResult("INTERNAL", "24", "30", false),
          componentResult("ST", "16", "20"),
          componentResult("ASG", "8", "10"),
        ]),
      ],
      POLICY
    );

    assert.deepEqual(rows.map((row) => row.code), ["ASG", "ST"]);
  });

  it("names no component of its own — the codes come from configuration", () => {
    const rows = componentBreakdown(
      [course([componentResult("VIVA", "9", "10"), componentResult("PRACTICAL", "40", "50")])],
      POLICY
    );

    assert.deepEqual(rows.map((row) => row.code), ["PRACTICAL", "VIVA"]);
  });

  it("orders alphabetically, implying no ranking between components", () => {
    const rows = componentBreakdown(
      [course([componentResult("Z", "1", "2"), componentResult("A", "1", "2")])],
      POLICY
    );

    assert.deepEqual(rows.map((row) => row.code), ["A", "Z"]);
  });

  it("reports a null percentage for a zero-maximum component", () => {
    const rows = componentBreakdown([course([componentResult("X", "0", "0")])], POLICY);

    assert.equal(rows[0].percentScaled, null);
  });

  it("returns nothing for no courses", () => {
    assert.deepEqual(componentBreakdown([], POLICY), []);
  });
});

describe("semesterTrend and trendDelta", () => {
  function row(semesterId: string, sgpa: string | null, cgpa: string | null): TranscriptRow {
    return {
      semesterId,
      creditsRegisteredScaled: toScaled("20"),
      creditsEarnedScaled: toScaled("20"),
      sgpaScaled: sgpa === null ? null : Number(sgpa) * 10 ** GPA_SCALE,
      cgpaScaled: cgpa === null ? null : Number(cgpa) * 10 ** GPA_SCALE,
      backlogCount: 0,
    };
  }

  it("projects a transcript without recomputing anything", () => {
    const points = semesterTrend([row("s1", "7", "7"), row("s2", "9", "8")]);

    assert.deepEqual(points.map((point) => point.semesterId), ["s1", "s2"]);
    assert.equal(formatScaled(points[1].sgpaScaled ?? 0, GPA_SCALE), "9.000000");
  });

  it("measures an improving trajectory", () => {
    const delta = trendDelta(semesterTrend([row("s1", "6", "6"), row("s2", "9", "7.5")]));

    assert.equal(formatScaled(delta ?? 0, GPA_SCALE), "3.000000");
  });

  it("measures a declining one", () => {
    const delta = trendDelta(semesterTrend([row("s1", "9", "9"), row("s2", "6", "7.5")]));

    assert.ok((delta ?? 0) < 0);
  });

  it("has NO trend for a single semester", () => {
    // Reporting 0.00 would be a claim about a trajectory that does not exist.
    assert.equal(trendDelta(semesterTrend([row("s1", "8", "8")])), null);
  });

  it("has no trend when nothing is graded", () => {
    assert.equal(trendDelta(semesterTrend([row("s1", null, null), row("s2", null, null)])), null);
  });

  it("ignores ungraded semesters when measuring", () => {
    const delta = trendDelta(
      semesterTrend([row("s1", "6", "6"), row("s2", null, null), row("s3", "8", "7")])
    );

    assert.equal(formatScaled(delta ?? 0, GPA_SCALE), "2.000000");
  });
});
