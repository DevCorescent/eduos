// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Credits, SGPA and CGPA
// LAYER  : Domain — Unit Tests
// PURPOSE: Prove that WHICH results enter an average is decided by
//          configuration, and that the arithmetic never touches a float.
//
//          The attempt policies carry the most risk. A BEST_ATTEMPT regulation
//          that silently kept the latest attempt would quietly punish every
//          student whose improvement attempt went worse than their original —
//          and would look entirely plausible in the output.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AttemptPolicy, RoundingMode } from "@/app/generated/prisma/enums";
import { GPA_SCALE } from "@/lib/constants/resultEngine";
import { formatMark, formatScaled, toScaled } from "@/lib/domain/result-engine/decimal";
import { COURSE_OUTCOME, RegistrationType } from "@/lib/domain/result-engine/enums";
import {
  carriesCredit,
  computeCgpa,
  computeGpa,
  gpaAsPercentage,
  selectAttempts,
  summariseCredits,
  type GpaCourseEntry,
} from "@/lib/domain/result-engine/gpa";
import type { RoundingPolicy } from "@/lib/domain/result-engine/types";

const POLICY: RoundingPolicy = {
  marksRounding: RoundingMode.HALF_UP,
  marksPrecision: 2,
  gpaRounding: RoundingMode.HALF_UP,
  gpaPrecision: 2,
};

function entry(
  courseId: string,
  credits: string,
  gradePoint: string | null,
  overrides: Partial<GpaCourseEntry> = {}
): GpaCourseEntry {
  return {
    courseId,
    courseRegistrationId: `reg_${courseId}_1`,
    attemptNumber: 1,
    registrationType: RegistrationType.REGULAR,
    creditsScaled: toScaled(credits),
    gradePointScaled: gradePoint === null ? null : toScaled(gradePoint),
    countsForGpa: true,
    outcome: gradePoint === null ? COURSE_OUTCOME.INCOMPLETE : COURSE_OUTCOME.PASS,
    ...overrides,
  };
}

/** Render a GPA at its own scale. */
function gpa(entries: readonly GpaCourseEntry[], policy = POLICY): string | null {
  const result = computeGpa(entries, policy);
  return result.valueScaled === null ? null : formatScaled(result.valueScaled, GPA_SCALE);
}

describe("computeGpa — the arithmetic", () => {
  it("weights each course by its credits", () => {
    // (4×9 + 3×8 + 3×10) / 10 = 90/10 = 9.00.
    assert.equal(
      gpa([entry("a", "4", "9"), entry("b", "3", "8"), entry("c", "3", "10")]),
      "9.000000"
    );
  });

  it("is NOT the unweighted mean", () => {
    // (4×10 + 1×5) / 5 = 9.00, where a plain mean would give 7.50.
    assert.equal(gpa([entry("a", "4", "10"), entry("b", "1", "5")]), "9.000000");
  });

  it("returns NULL, not zero, when nothing carries credit", () => {
    // Zero would put a first-semester transfer below everyone who failed.
    assert.equal(gpa([]), null);
    assert.equal(gpa([entry("a", "4", null)]), null);
  });

  it("rounds to the regulation's own GPA precision, exactly once", () => {
    // (3×8 + 3×9 + 2×7) / 8 = 65/8 = 8.125.
    const twoPlaces = computeGpa(
      [entry("a", "3", "8"), entry("b", "3", "9"), entry("c", "2", "7")],
      POLICY
    );

    assert.equal(formatScaled(twoPlaces.valueScaled ?? 0, GPA_SCALE), "8.130000");

    const threePlaces = computeGpa(
      [entry("a", "3", "8"), entry("b", "3", "9"), entry("c", "2", "7")],
      { ...POLICY, gpaPrecision: 3 }
    );

    assert.equal(formatScaled(threePlaces.valueScaled ?? 0, GPA_SCALE), "8.125000");
  });

  it("respects a regulation that truncates", () => {
    const truncating = computeGpa(
      [entry("a", "3", "8"), entry("b", "3", "9"), entry("c", "2", "7")],
      { ...POLICY, gpaRounding: RoundingMode.FLOOR }
    );

    assert.equal(formatScaled(truncating.valueScaled ?? 0, GPA_SCALE), "8.120000");
  });

  it("holds exactness where floats would drift", () => {
    // Thirds do not terminate in binary. Ten three-credit courses at 8.33 must
    // come back exactly 8.33, not 8.329999999999998.
    const entries = Array.from({ length: 10 }, (_value, index) =>
      entry(`c${index}`, "3", "8.33")
    );

    assert.equal(gpa(entries), "8.330000");
  });

  it("reports what went into it", () => {
    const result = computeGpa([entry("a", "4", "9"), entry("b", "3", "8")], POLICY);

    assert.equal(result.scale, GPA_SCALE);
    assert.equal(formatMark(result.creditsAttemptedScaled), "7.00");
    assert.equal(formatMark(result.creditsEarnedScaled), "7.00");
    assert.equal(result.coursesCounted, 2);
  });
});

describe("computeGpa — what enters the average is configuration", () => {
  it("EXCLUDES a failure whose band says it does not count", () => {
    // The Indian convention: a failure is excluded until cleared.
    const excluded = entry("b", "4", "0", {
      countsForGpa: false,
      outcome: COURSE_OUTCOME.FAIL,
    });

    assert.equal(gpa([entry("a", "4", "9"), excluded]), "9.000000");
  });

  it("INCLUDES a failure whose band says it counts", () => {
    // The US convention: an F sits in the denominator at zero.
    const included = entry("b", "4", "0", {
      countsForGpa: true,
      outcome: COURSE_OUTCOME.FAIL,
    });

    assert.equal(gpa([entry("a", "4", "9"), included]), "4.500000");
  });

  it("excludes an AUDIT, which carries no credit", () => {
    const audit = entry("b", "4", "10", { registrationType: RegistrationType.AUDIT });

    assert.equal(gpa([entry("a", "4", "8"), audit]), "8.000000");
  });

  it("excludes a CREDIT_TRANSFER, which already carried its credit elsewhere", () => {
    const transfer = entry("b", "4", "10", {
      registrationType: RegistrationType.CREDIT_TRANSFER,
    });

    assert.equal(gpa([entry("a", "4", "8"), transfer]), "8.000000");
  });

  it("excludes a zero-credit course, which can weight nothing", () => {
    assert.equal(gpa([entry("a", "4", "8"), entry("b", "0", "10")]), "8.000000");
  });

  it("excludes a withheld or incomplete course rather than scoring it zero", () => {
    const withheld = entry("b", "4", null, { outcome: COURSE_OUTCOME.WITHHELD });

    assert.equal(gpa([entry("a", "4", "8"), withheld]), "8.000000");
  });

  it("names which registration types carry credit", () => {
    assert.equal(carriesCredit(RegistrationType.REGULAR), true);
    assert.equal(carriesCredit(RegistrationType.BACKLOG), true);
    assert.equal(carriesCredit(RegistrationType.IMPROVEMENT), true);
    assert.equal(carriesCredit(RegistrationType.REPEAT), true);
    assert.equal(carriesCredit(RegistrationType.AUDIT), false);
    assert.equal(carriesCredit(RegistrationType.CREDIT_TRANSFER), false);
  });
});

describe("summariseCredits", () => {
  it("separates registered, attempted and earned", () => {
    const summary = summariseCredits([
      entry("a", "4", "9"),
      entry("b", "3", "0", { outcome: COURSE_OUTCOME.FAIL }),
      entry("c", "2", "10", { registrationType: RegistrationType.AUDIT }),
    ]);

    assert.equal(formatMark(summary.creditsRegisteredScaled), "9.00", "everything signed up for");
    assert.equal(formatMark(summary.creditsAttemptedScaled), "7.00", "the audit cannot carry credit");
    assert.equal(formatMark(summary.creditsEarnedScaled), "4.00", "only the pass");
  });

  it("counts a concluded failure as a backlog", () => {
    const summary = summariseCredits([
      entry("a", "4", "9"),
      entry("b", "3", "0", { outcome: COURSE_OUTCOME.FAIL }),
      entry("c", "3", "0", { outcome: COURSE_OUTCOME.INELIGIBLE }),
    ]);

    assert.equal(summary.backlogCount, 2);
  });

  it("does NOT count a withheld or incomplete course as a backlog", () => {
    // Telling a student they have a backlog because their marks are sealed
    // would be wrong in a way they cannot act on.
    const summary = summariseCredits([
      entry("a", "4", null, { outcome: COURSE_OUTCOME.WITHHELD }),
      entry("b", "4", null, { outcome: COURSE_OUTCOME.INCOMPLETE }),
    ]);

    assert.equal(summary.backlogCount, 0);
  });

  it("totals nothing for an empty set", () => {
    const summary = summariseCredits([]);

    assert.equal(summary.creditsEarnedScaled, 0);
    assert.equal(summary.backlogCount, 0);
    assert.equal(summary.coursesCounted, 0);
  });
});

describe("selectAttempts — the policy is the regulation's", () => {
  const attempts: readonly GpaCourseEntry[] = [
    entry("math", "4", "5", {
      attemptNumber: 1,
      courseRegistrationId: "r1",
      outcome: COURSE_OUTCOME.PASS,
    }),
    entry("math", "4", "9", {
      attemptNumber: 2,
      courseRegistrationId: "r2",
      registrationType: RegistrationType.IMPROVEMENT,
    }),
    entry("math", "4", "7", {
      attemptNumber: 3,
      courseRegistrationId: "r3",
      registrationType: RegistrationType.IMPROVEMENT,
    }),
  ];

  function chosen(policy: AttemptPolicy): readonly string[] {
    return selectAttempts(attempts, policy).map((item) => item.courseRegistrationId);
  }

  it("BEST_ATTEMPT keeps the highest grade point", () => {
    // The whole promise of an improvement: re-sitting cannot make things worse.
    assert.deepEqual(chosen(AttemptPolicy.BEST_ATTEMPT), ["r2"]);
  });

  it("LATEST_ATTEMPT keeps the newest, whichever way it went", () => {
    assert.deepEqual(chosen(AttemptPolicy.LATEST_ATTEMPT), ["r3"]);
  });

  it("FIRST_ATTEMPT keeps the original", () => {
    assert.deepEqual(chosen(AttemptPolicy.FIRST_ATTEMPT), ["r1"]);
  });

  it("ALL_ATTEMPTS keeps every one", () => {
    assert.deepEqual(chosen(AttemptPolicy.ALL_ATTEMPTS), ["r1", "r2", "r3"]);
  });

  it("the four policies genuinely disagree about the SGPA", () => {
    assert.equal(gpa(selectAttempts(attempts, AttemptPolicy.BEST_ATTEMPT)), "9.000000");
    assert.equal(gpa(selectAttempts(attempts, AttemptPolicy.LATEST_ATTEMPT)), "7.000000");
    assert.equal(gpa(selectAttempts(attempts, AttemptPolicy.FIRST_ATTEMPT)), "5.000000");
    assert.equal(gpa(selectAttempts(attempts, AttemptPolicy.ALL_ATTEMPTS)), "7.000000");
  });

  it("BEST_ATTEMPT never lets an UNGRADED re-sit displace a held grade", () => {
    // A pending re-sit must not erase the grade the student already holds.
    const pending = [
      entry("math", "4", "8", { attemptNumber: 1, courseRegistrationId: "r1" }),
      entry("math", "4", null, {
        attemptNumber: 2,
        courseRegistrationId: "r2",
        outcome: COURSE_OUTCOME.INCOMPLETE,
      }),
    ];

    assert.deepEqual(
      selectAttempts(pending, AttemptPolicy.BEST_ATTEMPT).map((i) => i.courseRegistrationId),
      ["r1"]
    );
  });

  it("BEST_ATTEMPT breaks an exact tie toward the LATER attempt", () => {
    const tied = [
      entry("math", "4", "8", { attemptNumber: 1, courseRegistrationId: "r1" }),
      entry("math", "4", "8", { attemptNumber: 2, courseRegistrationId: "r2" }),
    ];

    assert.deepEqual(
      selectAttempts(tied, AttemptPolicy.BEST_ATTEMPT).map((i) => i.courseRegistrationId),
      ["r2"]
    );
  });

  it("reconciles per COURSE, leaving other courses untouched", () => {
    const mixed = [
      ...attempts,
      entry("physics", "3", "6", { courseRegistrationId: "p1" }),
    ];

    assert.deepEqual(selectAttempts(mixed, AttemptPolicy.BEST_ATTEMPT).map((i) => i.courseId), [
      "math",
      "physics",
    ]);
  });

  it("does not depend on the order attempts arrive in", () => {
    const reversed = [...attempts].reverse();

    for (const policy of [
      AttemptPolicy.BEST_ATTEMPT,
      AttemptPolicy.LATEST_ATTEMPT,
      AttemptPolicy.FIRST_ATTEMPT,
    ]) {
      assert.deepEqual(
        selectAttempts(reversed, policy).map((i) => i.courseRegistrationId),
        selectAttempts(attempts, policy).map((i) => i.courseRegistrationId),
        policy
      );
    }
  });

  it("does not mutate the caller's array", () => {
    const input = [...attempts];
    selectAttempts(input, AttemptPolicy.BEST_ATTEMPT);

    assert.equal(input.length, 3);
    assert.equal(input[0].courseRegistrationId, "r1");
  });
});

describe("computeCgpa", () => {
  it("clears a backlog when a later attempt passes", () => {
    const degree = [
      entry("math", "4", "0", {
        attemptNumber: 1,
        courseRegistrationId: "r1",
        countsForGpa: false,
        outcome: COURSE_OUTCOME.FAIL,
      }),
      entry("physics", "4", "8", { courseRegistrationId: "p1" }),
      entry("math", "4", "6", {
        attemptNumber: 2,
        courseRegistrationId: "r2",
        registrationType: RegistrationType.BACKLOG,
      }),
    ];

    const cgpa = computeCgpa(degree, AttemptPolicy.BEST_ATTEMPT, POLICY);

    assert.equal(formatScaled(cgpa.valueScaled ?? 0, GPA_SCALE), "7.000000");
    assert.equal(formatMark(cgpa.creditsEarnedScaled), "8.00", "the cleared backlog now earns");
  });

  it("is computed from COURSES, not by averaging SGPAs", () => {
    // Semester one: one course, 4 credits at 10. Semester two: four courses,
    // 16 credits at 5. Averaging the two SGPAs gives 7.50; the correct
    // credit-weighted answer is 6.00.
    const degree = [
      entry("a", "4", "10"),
      entry("b", "4", "5"),
      entry("c", "4", "5"),
      entry("d", "4", "5"),
      entry("e", "4", "5"),
    ];

    assert.equal(
      formatScaled(computeCgpa(degree, AttemptPolicy.LATEST_ATTEMPT, POLICY).valueScaled ?? 0, GPA_SCALE),
      "6.000000"
    );
  });
});

describe("gpaAsPercentage", () => {
  it("normalises a ten-point scale", () => {
    assert.equal(formatMark(gpaAsPercentage(8_500_000, toScaled("10"), POLICY) ?? 0), "85.00");
  });

  it("normalises a four-point scale to the SAME percentage", () => {
    // 3.4 of 4 and 8.5 of 10 are both 85%. A hardcoded "CGPA × 10" would be
    // right for one and badly wrong for the other.
    assert.equal(formatMark(gpaAsPercentage(3_400_000, toScaled("4"), POLICY) ?? 0), "85.00");
  });

  it("is null for a GPA that does not exist", () => {
    assert.equal(gpaAsPercentage(null, toScaled("10"), POLICY), null);
  });

  it("is null for a scale with no ceiling to divide by", () => {
    assert.equal(gpaAsPercentage(8_500_000, 0, POLICY), null);
  });

  it("reaches exactly 100 at the ceiling", () => {
    assert.equal(formatMark(gpaAsPercentage(10_000_000, toScaled("10"), POLICY) ?? 0), "100.00");
  });
});

describe("gpa — scale", () => {
  it("computes a 100-course degree without drift", () => {
    const entries = Array.from({ length: 100 }, (_value, index) =>
      entry(`c${index}`, "3", "7.77")
    );

    assert.equal(gpa(entries), "7.770000");
    assert.equal(formatMark(summariseCredits(entries).creditsEarnedScaled), "300.00");
  });

  it("computes the same answer on a reordered input", () => {
    const entries = Array.from({ length: 50 }, (_value, index) =>
      entry(`c${index}`, String((index % 4) + 1), String((index % 10) + 1))
    );

    assert.equal(gpa(entries), gpa([...entries].reverse()));
  });
});
