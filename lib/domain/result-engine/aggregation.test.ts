// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Aggregation
// LAYER  : Domain — Unit Tests
// PURPOSE: Verify every strategy, and the status vocabulary that decides what a
//          strategy even sees.
//
//          Two properties carry the most weight and are easiest to get wrong:
//          BEST_N must compare PROPORTIONS (18/25 is worse than 9/10), and ties
//          must resolve DETERMINISTICALLY or two runs of the same computation
//          disagree.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RoundingMode } from "@/app/generated/prisma/enums";
import { formatMark, toScaled } from "@/lib/domain/result-engine/decimal";
import { AGGREGATION_ERROR, aggregateSessions } from "@/lib/domain/result-engine/aggregation";
import type {
  AggregationContext,
  AssessmentValue,
  ComponentDefinition,
} from "@/lib/domain/result-engine/types";

function component(overrides: Partial<ComponentDefinition> = {}): ComponentDefinition {
  return {
    id: "component_1",
    code: "ST",
    parentComponentId: null,
    sequence: 1,
    maxMarksScaled: toScaled("20"),
    weightageScaled: toScaled("100"),
    aggregation: "SUM",
    rollup: null,
    sourceType: "MANUAL_ENTRY",
    isMandatory: true,
    ruleConfig: null,
    ...overrides,
  };
}

function session(
  sequenceNumber: number,
  marks: string | null,
  max = "20",
  status: AssessmentValue["status"] = "RECORDED"
): AssessmentValue {
  return {
    componentId: "component_1",
    sequenceNumber,
    maxMarksScaled: toScaled(max),
    marksScaled: marks === null ? null : toScaled(marks),
    status,
  };
}

function run(
  sessions: readonly AssessmentValue[],
  overrides: Partial<ComponentDefinition> = {}
): AggregationContext {
  return {
    component: component(overrides),
    sessions,
    rounding: RoundingMode.HALF_UP,
  };
}

/** Aggregate and assert success, returning the formatted value. */
function value(context: AggregationContext): string {
  const outcome = aggregateSessions(context);
  assert.ok(outcome.ok, outcome.ok ? "" : `failed: ${outcome.failure.code}`);
  return formatMark(outcome.value.valueScaled);
}

function expectFailure(context: AggregationContext, code: string): void {
  const outcome = aggregateSessions(context);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.failure.code, code);
  }
}

describe("aggregation — SUM", () => {
  it("totals the sittings onto the component's scale", () => {
    // 8 + 7 out of 20 + 20 = 15/40, expressed on a 20-mark component = 7.50.
    assert.equal(value(run([session(1, "8"), session(2, "7")])), "7.50");
  });

  it("returns full marks when every sitting is full", () => {
    assert.equal(value(run([session(1, "20"), session(2, "20")])), "20.00");
  });

  it("handles a single sitting", () => {
    assert.equal(value(run([session(1, "15")])), "15.00");
  });
});

describe("aggregation — AVERAGE", () => {
  it("takes the unweighted mean of the sittings' proportions", () => {
    // 10/20 and 20/20 -> 50% and 100% -> mean 75% of 20 = 15.00.
    assert.equal(
      value(run([session(1, "10"), session(2, "20")], { aggregation: "AVERAGE" })),
      "15.00"
    );
  });

  it("treats each sitting equally regardless of its maximum", () => {
    // 5/10 (50%) and 20/20 (100%) -> mean 75% of 20 = 15.00. A weighted average
    // would give a different answer, which is the next test.
    assert.equal(
      value(
        run([session(1, "5", "10"), session(2, "20", "20")], { aggregation: "AVERAGE" })
      ),
      "15.00"
    );
  });

  it("weights by marks available when configured to", () => {
    // 25/30 rather than the mean of proportions: the 20-mark paper counts for
    // more than the 10-mark quiz.
    assert.equal(
      value(
        run([session(1, "5", "10"), session(2, "20", "20")], {
          aggregation: "AVERAGE",
          ruleConfig: { averageWeighted: true },
        })
      ),
      "16.67"
    );
  });
});

describe("aggregation — MAX and LATEST", () => {
  it("MAX takes the best proportion", () => {
    assert.equal(
      value(run([session(1, "12"), session(2, "17"), session(3, "15")], { aggregation: "MAX" })),
      "17.00"
    );
  });

  it("MAX compares proportions, not raw marks", () => {
    // 18/25 is 72%; 9/10 is 90%. Raw comparison would pick the worse sitting.
    assert.equal(
      value(
        run([session(1, "18", "25"), session(2, "9", "10")], { aggregation: "MAX" })
      ),
      "18.00",
      "90% of a 20-mark component is 18.00"
    );
  });

  it("LATEST takes the highest sitting NUMBER, not the last in the array", () => {
    // Deliberately out of order: the array ends on sitting 1.
    assert.equal(
      value(
        run([session(3, "5"), session(2, "9"), session(1, "20")], { aggregation: "LATEST" })
      ),
      "5.00",
      "sitting 3 is the latest whatever order the rows arrived in"
    );
  });
});

describe("aggregation — BEST_N", () => {
  it("keeps the best one", () => {
    assert.equal(
      value(
        run([session(1, "12"), session(2, "17"), session(3, "15")], {
          aggregation: "BEST_N",
          maxMarksScaled: toScaled("20"),
          ruleConfig: { count: 1 },
        })
      ),
      "17.00"
    );
  });

  it("keeps and totals the best two", () => {
    // 17 + 15 out of 40, on a 20-mark component = 16.00.
    assert.equal(
      value(
        run([session(1, "12"), session(2, "17"), session(3, "15")], {
          aggregation: "BEST_N",
          ruleConfig: { count: 2 },
        })
      ),
      "16.00"
    );
  });

  it("keeping all three is the same as SUM", () => {
    const sessions = [session(1, "12"), session(2, "17"), session(3, "15")];

    assert.equal(
      value(run(sessions, { aggregation: "BEST_N", ruleConfig: { count: 3 } })),
      value(run(sessions, { aggregation: "SUM" }))
    );
  });

  it("clamps a count larger than the sittings that happened", () => {
    // "Best 3 of however many sat" is coherent when only two sat.
    assert.equal(
      value(
        run([session(1, "12"), session(2, "18")], {
          aggregation: "BEST_N",
          ruleConfig: { count: 3 },
        })
      ),
      "15.00"
    );
  });

  it("selects by proportion across different maxima", () => {
    // 18/25 (72%) vs 9/10 (90%) vs 10/20 (50%): the best one is the quiz.
    assert.equal(
      value(
        run([session(1, "18", "25"), session(2, "9", "10"), session(3, "10", "20")], {
          aggregation: "BEST_N",
          ruleConfig: { count: 1 },
        })
      ),
      "18.00"
    );
  });

  it("resolves ties deterministically toward the earlier sitting", () => {
    // Both sittings score identically; the result must not depend on order.
    const forward = value(
      run([session(1, "15"), session(2, "15"), session(3, "9")], {
        aggregation: "BEST_N",
        ruleConfig: { count: 2 },
      })
    );

    const reversed = value(
      run([session(3, "9"), session(2, "15"), session(1, "15")], {
        aggregation: "BEST_N",
        ruleConfig: { count: 2 },
      })
    );

    assert.equal(forward, reversed);
    assert.equal(forward, "15.00");
  });

  it("refuses a missing or invalid count", () => {
    for (const ruleConfig of [null, {}, { count: 0 }, { count: -1 }, { count: 1.5 }, { count: "2" }]) {
      expectFailure(
        run([session(1, "10")], { aggregation: "BEST_N", ruleConfig }),
        AGGREGATION_ERROR.INVALID_COUNT
      );
    }
  });
});

describe("aggregation — DROP_LOWEST_N", () => {
  it("drops the worst one", () => {
    // 17 + 15 survive out of 40, on a 20-mark component = 16.00.
    assert.equal(
      value(
        run([session(1, "12"), session(2, "17"), session(3, "15")], {
          aggregation: "DROP_LOWEST_N",
          ruleConfig: { count: 1 },
        })
      ),
      "16.00"
    );
  });

  it("drops the worst two", () => {
    assert.equal(
      value(
        run([session(1, "12"), session(2, "17"), session(3, "15")], {
          aggregation: "DROP_LOWEST_N",
          ruleConfig: { count: 2 },
        })
      ),
      "17.00"
    );
  });

  it("REJECTS dropping everything rather than returning zero", () => {
    // Unlike BEST_N this cannot be clamped into something sensible: a component
    // that discarded all its own marks is a misconfiguration, not a result.
    expectFailure(
      run([session(1, "12"), session(2, "17")], {
        aggregation: "DROP_LOWEST_N",
        ruleConfig: { count: 2 },
      }),
      AGGREGATION_ERROR.IMPOSSIBLE_SELECTION
    );

    expectFailure(
      run([session(1, "12")], { aggregation: "DROP_LOWEST_N", ruleConfig: { count: 5 } }),
      AGGREGATION_ERROR.IMPOSSIBLE_SELECTION
    );
  });

  it("resolves ties deterministically", () => {
    const forward = value(
      run([session(1, "9"), session(2, "9"), session(3, "18")], {
        aggregation: "DROP_LOWEST_N",
        ruleConfig: { count: 1 },
      })
    );

    const reversed = value(
      run([session(3, "18"), session(2, "9"), session(1, "9")], {
        aggregation: "DROP_LOWEST_N",
        ruleConfig: { count: 1 },
      })
    );

    assert.equal(forward, reversed);
  });
});

describe("aggregation — absence policy comes from configuration", () => {
  const sessions = [session(1, "20"), session(2, null, "20", "ABSENT")];

  it("ZERO is the default: the sitting occupies its place, scoring nothing", () => {
    // 20 + 0 out of 40 = 10.00. The absence still divides the total.
    assert.equal(value(run(sessions)), "10.00");
  });

  it("ZERO stated explicitly behaves identically", () => {
    assert.equal(value(run(sessions, { ruleConfig: { absentPolicy: "ZERO" } })), "10.00");
  });

  it("IGNORE discounts the sitting entirely", () => {
    // 20 out of 20 = 20.00. An average over three with one absence would
    // divide by two, not three.
    assert.equal(value(run(sessions, { ruleConfig: { absentPolicy: "IGNORE" } })), "20.00");
  });

  it("IGNORE changes an average's divisor", () => {
    const withAbsence = [session(1, "20"), session(2, "10"), session(3, null, "20", "ABSENT")];

    assert.equal(
      value(run(withAbsence, { aggregation: "AVERAGE", ruleConfig: { absentPolicy: "ZERO" } })),
      "10.00",
      "(100% + 50% + 0%) / 3 = 50% of 20"
    );

    assert.equal(
      value(run(withAbsence, { aggregation: "AVERAGE", ruleConfig: { absentPolicy: "IGNORE" } })),
      "15.00",
      "(100% + 50%) / 2 = 75% of 20"
    );
  });

  it("FAIL refuses to compute the component at all", () => {
    expectFailure(
      run(sessions, { ruleConfig: { absentPolicy: "FAIL" } }),
      AGGREGATION_ERROR.ABSENT_FAILS
    );
  });

  it("falls back to the default for an unrecognised policy", () => {
    assert.equal(value(run(sessions, { ruleConfig: { absentPolicy: "WHATEVER" } })), "10.00");
  });
});

describe("aggregation — withheld policy comes from configuration", () => {
  const sessions = [session(1, "20"), session(2, "10", "20", "WITHHELD")];

  it("BLOCK is the default: no result may be stated", () => {
    expectFailure(run(sessions), AGGREGATION_ERROR.WITHHELD_BLOCKED);
  });

  it("IGNORE discounts the withheld sitting and computes the rest", () => {
    assert.equal(value(run(sessions, { ruleConfig: { withheldPolicy: "IGNORE" } })), "20.00");
  });
});

describe("aggregation — nothing to aggregate", () => {
  it("fails a MANDATORY component with no sittings", () => {
    expectFailure(run([], { isMandatory: true }), AGGREGATION_ERROR.MANDATORY_MISSING);
  });

  it("scores an OPTIONAL component with no sittings as nothing", () => {
    assert.equal(value(run([], { isMandatory: false })), "0.00");
  });

  it("scores nothing when every sitting was discounted by policy", () => {
    const outcome = aggregateSessions(
      run([session(1, null, "20", "ABSENT")], { ruleConfig: { absentPolicy: "IGNORE" } })
    );

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(formatMark(outcome.value.valueScaled), "0.00");
      assert.equal(outcome.value.sessionsUsed, 0);
      assert.equal(outcome.value.sessionsIgnored, 1);
    }
  });

  it("refuses a component with sittings but no declared aggregation", () => {
    expectFailure(
      run([session(1, "10")], { aggregation: null }),
      AGGREGATION_ERROR.MISSING_AGGREGATION
    );
  });
});

describe("aggregation — reporting and scale", () => {
  it("reports how many sittings were used and discounted", () => {
    const outcome = aggregateSessions(
      run([session(1, "12"), session(2, "17"), session(3, "15")], {
        aggregation: "BEST_N",
        ruleConfig: { count: 2 },
      })
    );

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(outcome.value.sessionsUsed, 2);
      assert.equal(outcome.value.sessionsIgnored, 1);
    }
  });

  it("never exceeds the component's own scale", () => {
    const outcome = aggregateSessions(run([session(1, "20"), session(2, "20")]));

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.ok(outcome.value.valueScaled <= toScaled("20"));
    }
  });

  it("handles a large sitting count without loss", () => {
    const sessions = Array.from({ length: 200 }, (_value, index) =>
      session(index + 1, "10", "20")
    );

    // Every sitting at 50%, so the total is 50% of the component whatever the count.
    assert.equal(value(run(sessions, { aggregation: "AVERAGE" })), "10.00");
    assert.equal(value(run(sessions, { aggregation: "SUM" })), "10.00");
  });
});
