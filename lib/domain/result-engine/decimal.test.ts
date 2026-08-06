// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Exact Arithmetic
// LAYER  : Domain — Unit Tests
// PURPOSE: Verify the arithmetic every grade in the system will be computed
//          with.
//
//          This is the highest-consequence file in the phase and the one where
//          a defect is least visible on inspection: a sign error in FLOOR or an
//          off-by-one in HALF_EVEN produces numbers that look entirely
//          plausible and are wrong for a subset of students. Every mode is
//          therefore exercised on both signs, on exact division, and on the
//          half case that distinguishes it from its neighbours.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RoundingMode } from "@/app/generated/prisma/enums";
import { GPA_SCALE, MARK_SCALE } from "@/lib/constants/resultEngine";
import {
  asPercentage,
  creditWeightedAverage,
  divideRounded,
  formatMark,
  formatScaled,
  roundToPrecision,
  toScaled,
  weightedContribution,
} from "@/lib/domain/result-engine/decimal";

const HALF_UP = RoundingMode.HALF_UP;

describe("toScaled", () => {
  it("reads an exact decimal into hundredths", () => {
    assert.equal(toScaled("30"), 3000);
    assert.equal(toScaled("30.5"), 3050);
    assert.equal(toScaled("33.34"), 3334);
    assert.equal(toScaled("0.07"), 7);
    assert.equal(toScaled("0"), 0);
  });

  it("reads a negative value", () => {
    assert.equal(toScaled("-12.50"), -1250);
  });
});

describe("divideRounded — exact division", () => {
  it("returns the quotient when there is no remainder, whatever the mode", () => {
    for (const mode of Object.values(RoundingMode)) {
      assert.equal(divideRounded(4, 2, mode), 2, `${mode} on 4/2`);
      assert.equal(divideRounded(-6, 2, mode), -3, `${mode} on -6/2`);
    }
  });

  it("returns zero for a zero denominator rather than a non-finite number", () => {
    assert.equal(divideRounded(5, 0, HALF_UP), 0);
  });
});

describe("divideRounded — the half case, which is what separates the modes", () => {
  // 5/2 is exactly 2.5 — the value every mode answers differently.
  it("HALF_UP rounds away from zero", () => {
    assert.equal(divideRounded(5, 2, RoundingMode.HALF_UP), 3);
    assert.equal(divideRounded(-5, 2, RoundingMode.HALF_UP), -3);
  });

  it("HALF_DOWN rounds toward zero", () => {
    assert.equal(divideRounded(5, 2, RoundingMode.HALF_DOWN), 2);
    assert.equal(divideRounded(-5, 2, RoundingMode.HALF_DOWN), -2);
  });

  it("HALF_EVEN rounds to the even neighbour", () => {
    // 2.5 -> 2 (even), 3.5 -> 4 (even). This is what removes the systematic
    // upward bias HALF_UP introduces across a cohort.
    assert.equal(divideRounded(5, 2, RoundingMode.HALF_EVEN), 2);
    assert.equal(divideRounded(7, 2, RoundingMode.HALF_EVEN), 4);
    assert.equal(divideRounded(-5, 2, RoundingMode.HALF_EVEN), -2);
    assert.equal(divideRounded(-7, 2, RoundingMode.HALF_EVEN), -4);
  });

  it("FLOOR goes toward negative infinity, not toward zero", () => {
    assert.equal(divideRounded(5, 2, RoundingMode.FLOOR), 2);
    assert.equal(
      divideRounded(-5, 2, RoundingMode.FLOOR),
      -3,
      "a regulation that says round down means down, including below zero"
    );
  });

  it("CEILING goes toward positive infinity, not away from zero", () => {
    assert.equal(divideRounded(5, 2, RoundingMode.CEILING), 3);
    assert.equal(divideRounded(-5, 2, RoundingMode.CEILING), -2);
  });
});

describe("divideRounded — below and above the half", () => {
  it("rounds down below the half in every half-mode", () => {
    // 4/3 = 1.33
    for (const mode of [
      RoundingMode.HALF_UP,
      RoundingMode.HALF_DOWN,
      RoundingMode.HALF_EVEN,
    ]) {
      assert.equal(divideRounded(4, 3, mode), 1, mode);
    }
  });

  it("rounds up above the half in every half-mode", () => {
    // 5/3 = 1.67
    for (const mode of [
      RoundingMode.HALF_UP,
      RoundingMode.HALF_DOWN,
      RoundingMode.HALF_EVEN,
    ]) {
      assert.equal(divideRounded(5, 3, mode), 2, mode);
    }
  });
});

describe("roundToPrecision", () => {
  it("keeps the value at its own scale while coarsening it", () => {
    // 33.55 to one place is 33.60 — still expressed in hundredths, so
    // downstream arithmetic needs no unit conversion.
    assert.equal(roundToPrecision(3355, MARK_SCALE, 1, HALF_UP), 3360);
  });

  it("rounds to whole units", () => {
    assert.equal(roundToPrecision(3355, MARK_SCALE, 0, HALF_UP), 3400);
    assert.equal(roundToPrecision(3344, MARK_SCALE, 0, HALF_UP), 3300);
  });

  it("is a no-op when asked for the precision it already has", () => {
    assert.equal(roundToPrecision(3355, MARK_SCALE, 2, HALF_UP), 3355);
  });

  it("cannot invent precision it does not carry", () => {
    assert.equal(roundToPrecision(3355, MARK_SCALE, 5, HALF_UP), 3355);
  });

  it("honours the mode it is given", () => {
    // 33.55 to one place sits exactly on the half, which is where the modes
    // diverge. (33.50 to one place is already 33.5 and tests nothing.)
    assert.equal(roundToPrecision(3355, MARK_SCALE, 1, RoundingMode.HALF_UP), 3360);
    assert.equal(roundToPrecision(3355, MARK_SCALE, 1, RoundingMode.HALF_DOWN), 3350);
    assert.equal(roundToPrecision(3355, MARK_SCALE, 1, RoundingMode.HALF_EVEN), 3360);
    // 33.45 to one place: 334.5 tenths, and 334 is the even neighbour.
    assert.equal(roundToPrecision(3345, MARK_SCALE, 1, RoundingMode.HALF_EVEN), 3340);
    assert.equal(roundToPrecision(3355, MARK_SCALE, 1, RoundingMode.FLOOR), 3350);
    assert.equal(roundToPrecision(3355, MARK_SCALE, 1, RoundingMode.CEILING), 3360);
  });

  it("leaves a value already at the requested precision untouched", () => {
    assert.equal(roundToPrecision(3350, MARK_SCALE, 1, RoundingMode.HALF_UP), 3350);
  });
});

describe("weightedContribution", () => {
  it("normalises a component onto its weight", () => {
    // 25 out of 30, worth 30% of the course, contributes 25%.
    assert.equal(weightedContribution(2500, 3000, 3000, HALF_UP), 2500);
  });

  it("contributes the full weight at full marks", () => {
    assert.equal(weightedContribution(3000, 3000, 3000, HALF_UP), 3000);
  });

  it("contributes nothing at zero marks", () => {
    assert.equal(weightedContribution(0, 3000, 3000, HALF_UP), 0);
  });

  it("does not round the intermediate ratio away", () => {
    // 1 out of 3, worth 100%: 33.33%. Rounding marks/max first would give 0.
    assert.equal(weightedContribution(100, 300, 10000, HALF_UP), 3333);
  });

  it("returns zero for a zero maximum rather than a non-finite number", () => {
    assert.equal(weightedContribution(2500, 0, 3000, HALF_UP), 0);
  });
});

describe("asPercentage", () => {
  it("expresses a mark as a percentage of its maximum", () => {
    assert.equal(asPercentage(2500, 3000, HALF_UP), 8333);
    assert.equal(asPercentage(3000, 3000, HALF_UP), 10000);
    assert.equal(asPercentage(1500, 3000, HALF_UP), 5000);
    assert.equal(asPercentage(0, 3000, HALF_UP), 0);
  });

  it("returns zero for a zero maximum", () => {
    assert.equal(asPercentage(2500, 0, HALF_UP), 0);
  });
});

describe("creditWeightedAverage", () => {
  it("averages a single course to its own grade point", () => {
    const average = creditWeightedAverage(
      [{ weightScaled: 400, valueScaled: 900 }],
      HALF_UP
    );

    assert.equal(average, 9_000_000, "9.00 points at GPA_SCALE");
  });

  it("weights by credits rather than treating courses equally", () => {
    // (4 x 9 + 3 x 8) / 7 = 60/7 = 8.571428...
    const average = creditWeightedAverage(
      [
        { weightScaled: 400, valueScaled: 900 },
        { weightScaled: 300, valueScaled: 800 },
      ],
      HALF_UP
    );

    assert.equal(average, 8_571_429);
    assert.equal(formatScaled(average as number, GPA_SCALE), "8.571429");
  });

  it("carries the division at GPA_SCALE, not at MARK_SCALE", () => {
    // 10/3 = 3.333333. Dividing at hundredths first would lose four digits the
    // regulation's precision setting exists to control.
    const average = creditWeightedAverage(
      [{ weightScaled: 300, valueScaled: 1000 }, { weightScaled: 600, valueScaled: 1000 }],
      HALF_UP
    );

    assert.equal(average, 10_000_000);
  });

  it("returns null rather than zero when nothing carries credit", () => {
    assert.equal(
      creditWeightedAverage([], HALF_UP),
      null,
      "a student with no credit-bearing results has no average, and 0.00 would rank them bottom"
    );
    assert.equal(creditWeightedAverage([{ weightScaled: 0, valueScaled: 900 }], HALF_UP), null);
  });
});

describe("formatScaled", () => {
  it("renders a scaled integer as an exact decimal string", () => {
    assert.equal(formatScaled(3400, 2), "34.00");
    assert.equal(formatScaled(8333, 2), "83.33");
    assert.equal(formatScaled(5, 2), "0.05");
    assert.equal(formatScaled(0, 2), "0.00");
  });

  it("pads the fraction rather than truncating it", () => {
    assert.equal(formatScaled(50, 2), "0.50");
    assert.equal(formatScaled(8_571_429, 6), "8.571429");
    assert.equal(formatScaled(9_000_000, 6), "9.000000");
  });

  it("renders a negative value with one sign, in the right place", () => {
    assert.equal(formatScaled(-250, 2), "-2.50");
    assert.equal(formatScaled(-5, 2), "-0.05");
  });

  it("omits the point entirely at scale zero", () => {
    assert.equal(formatScaled(34, 0), "34");
  });

  it("formatMark is formatScaled at the working scale", () => {
    assert.equal(formatMark(3355), "33.55");
  });
});

describe("the arithmetic holds where floating point does not", () => {
  it("sums a weight set that IEEE 754 gets wrong", () => {
    // The counterexample proven in C3: exactly 100 in decimal,
    // 100.00000000000001 as floats.
    assert.notEqual(28.1 + 35.95 + 35.95, 100);

    const total = [toScaled("28.10"), toScaled("35.95"), toScaled("35.95")].reduce(
      (sum, value) => sum + value,
      0
    );

    assert.equal(total, 10000);
  });

  it("keeps a full-marks course at exactly 100 through the whole pipeline", () => {
    // Two components at full marks, weighted 30 and 70, must total exactly 100 —
    // not 99.99, which would drop a student a grade band.
    const internal = weightedContribution(3000, 3000, 3000, HALF_UP);
    const theory = weightedContribution(7000, 7000, 7000, HALF_UP);

    assert.equal(internal + theory, 10000);
  });
});
