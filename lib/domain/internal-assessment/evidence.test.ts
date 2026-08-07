// ============================================================================
// OWNER  : Gauransh
// MODULE : AI Assisted Internal Assessment (Phase 25)
// LAYER  : Domain — Unit Tests
// PURPOSE: Pin the two properties that decide whether this feature is fair:
//          that a MISSING input never counts as a zero, and that confidence
//          reports data completeness rather than certainty.
//
//          A student whose course ran no quizzes must not be marked down by the
//          quiz weight. Every test below exists because the alternative
//          silently under-marks somebody.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  blend,
  proportion,
  toMarks,
  toSignals,
  type EvidenceSignals,
  type WeightedInput,
} from "@/lib/domain/internal-assessment/evidence";

const allPresent: EvidenceSignals = {
  attendance: 0.9,
  assignment: 0.8,
  quiz: 0.7,
  practical: 0.6,
  priorPerformance: 0.75,
};

describe("proportion", () => {
  it("returns NULL for a zero denominator, never 0", () => {
    // "Had nothing to score on" is not "scored nothing".
    assert.equal(proportion(0, 0), null);
  });

  it("clamps above 1, so bonus marks cannot exceed a full score", () => {
    assert.equal(proportion(11, 10), 1);
  });

  it("clamps below 0", () => {
    assert.equal(proportion(-5, 10), 0);
  });

  it("computes an ordinary proportion", () => {
    assert.equal(proportion(3, 4), 0.75);
  });
});

describe("toSignals", () => {
  it("reports null for every input the student has no data for", () => {
    const signals = toSignals({
      attendance: { held: 0, attended: 0 },
      assignment: { graded: 0, obtained: 0, available: 0 },
      quiz: { graded: 0, obtained: 0, available: 0 },
      practical: { graded: 0, obtained: 0, available: 0 },
      priorPerformance: { graded: 0, obtained: 0, available: 0 },
    });

    assert.deepEqual(signals, {
      attendance: null,
      assignment: null,
      quiz: null,
      practical: null,
      priorPerformance: null,
    });
  });

  it("normalises prior performance against the marks that were available", () => {
    const signals = toSignals({
      attendance: { held: 10, attended: 9 },
      assignment: { graded: 2, obtained: 40, available: 50 },
      quiz: { graded: 0, obtained: 0, available: 0 },
      practical: { graded: 0, obtained: 0, available: 0 },
      priorPerformance: { graded: 4, obtained: 320, available: 400 },
    });

    assert.equal(signals.attendance, 0.9);
    assert.equal(signals.assignment, 0.8);
    assert.equal(signals.priorPerformance, 0.8);
  });
});

describe("blend", () => {
  const inputs: readonly WeightedInput[] = [
    { key: "attendance", weight: 20 },
    { key: "assignment", weight: 50 },
    { key: "quiz", weight: 30 },
  ];

  it("weights the present inputs as the university configured them", () => {
    const result = blend(allPresent, inputs);

    // (0.9*20 + 0.8*50 + 0.7*30) / 100 = 0.79
    assert.equal(result.score, 0.79);
    assert.equal(result.confidence, 1);
    assert.deepEqual(result.missing, []);
  });

  it("RENORMALISES when an input is missing, rather than scoring it zero", () => {
    // The quiz weight is 30. Treating a missing quiz as zero would cap this
    // student at 70% for a reason that has nothing to do with their work.
    const result = blend({ ...allPresent, quiz: null }, inputs);

    // (0.9*20 + 0.8*50) / 70 = 0.8285714...
    assert.ok(result.score !== null);
    assert.ok(Math.abs(result.score - 0.82857) < 0.0001);
    assert.deepEqual(result.missing, ["quiz"]);
  });

  it("proves the missing input was not treated as zero", () => {
    const renormalised = blend({ ...allPresent, quiz: null }, inputs);
    const asZero = blend({ ...allPresent, quiz: 0 }, inputs);

    assert.ok(renormalised.score !== null && asZero.score !== null);
    assert.ok(renormalised.score > asZero.score);
  });

  it("reports confidence as the share of inputs that had DATA", () => {
    const result = blend({ ...allPresent, quiz: null }, inputs);

    // Two of three inputs present.
    assert.equal(result.confidence, 0.667);
  });

  it("counts inputs rather than weight when reporting confidence", () => {
    // One heavily-weighted present input must not report high confidence while
    // two others are missing entirely.
    const result = blend(
      { ...allPresent, attendance: null, quiz: null },
      inputs
    );

    assert.equal(result.confidence, 0.333);
    assert.deepEqual(result.used, ["assignment"]);
  });

  it("returns a NULL score when no configured input has data", () => {
    // Returning 0 would recommend awarding zero marks to a student the system
    // knows nothing about.
    const result = blend(
      { attendance: null, assignment: null, quiz: null, practical: null, priorPerformance: null },
      inputs
    );

    assert.equal(result.score, null);
    assert.equal(result.confidence, 0);
    assert.deepEqual(result.used, []);
    assert.equal(result.missing.length, 3);
  });

  it("returns a null score and zero confidence when nothing is configured", () => {
    const result = blend(allPresent, []);

    assert.equal(result.score, null);
    assert.equal(result.confidence, 0);
  });

  it("does not produce NaN when every present input carries zero weight", () => {
    // NaN would serialise as null and be indistinguishable from "no data".
    const result = blend(allPresent, [{ key: "attendance", weight: 0 }]);

    assert.equal(result.score, null);
    assert.equal(Number.isNaN(result.score as unknown as number), false);
  });
});

describe("toMarks", () => {
  it("scales a score onto the component maximum", () => {
    assert.equal(toMarks(0.79, 40), 31.6);
  });

  it("rounds to two decimals, matching the Decimal(6,2) column", () => {
    // More precision than the column holds would be silently rounded by
    // PostgreSQL, and the stored figure would differ from the one shown.
    assert.equal(toMarks(1 / 3, 40), 13.33);
  });

  it("returns null for a null score", () => {
    assert.equal(toMarks(null, 40), null);
  });

  it("returns null for a non-positive maximum rather than dividing by it", () => {
    assert.equal(toMarks(0.5, 0), null);
  });

  it("awards the full maximum for a perfect score", () => {
    assert.equal(toMarks(1, 40), 40);
  });
});
