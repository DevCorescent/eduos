// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Rollup
// LAYER  : Domain — Unit Tests
// PURPOSE: Verify the rule pipeline and the tree fold.
//
//          The properties that matter most are ORDER and IMMUTABILITY: rules
//          must consume each other's output in the order the schema declared,
//          children must be finished before their parent reads them, and no
//          stage may mutate what it was handed — otherwise re-running a
//          computation on the same data could produce a different grade, which
//          is the one thing this engine exists to prevent.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RoundingMode } from "@/app/generated/prisma/enums";
import { formatMark, toScaled } from "@/lib/domain/result-engine/decimal";
import {
  COURSE_SCOPE,
  ROLLUP_ERROR,
  applyRules,
  indexComponents,
  indexRules,
  isLeaf,
  rollupChildren,
  rollupRoots,
  rulesFor,
  unreachableComponents,
} from "@/lib/domain/result-engine/rollup";
import type {
  ComponentDefinition,
  EvaluationContext,
  RuleDefinition,
  Scaled,
} from "@/lib/domain/result-engine/types";

function component(
  id: string,
  overrides: Partial<ComponentDefinition> = {}
): ComponentDefinition {
  return {
    id,
    code: id.toUpperCase(),
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

function rule(
  code: string,
  operation: RuleDefinition["operation"],
  config: unknown,
  overrides: Partial<RuleDefinition> = {}
): RuleDefinition {
  return {
    id: `rule_${code}`,
    code,
    componentId: null,
    phase: "COURSE_ADJUSTMENT",
    operation,
    sequence: 1,
    config,
    condition: null,
    ...overrides,
  };
}

function context(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    rounding: RoundingMode.HALF_UP,
    bindings: { ATTENDANCE_PERCENT: toScaled("80") },
    policy: {
      marksRounding: RoundingMode.HALF_UP,
      marksPrecision: 2,
      gpaRounding: RoundingMode.HALF_UP,
      gpaPrecision: 2,
    },
    passMarkScaled: toScaled("40"),
    ...overrides,
  };
}

/** Apply and assert success, returning the formatted value. */
function applied(
  rules: readonly RuleDefinition[],
  value: string,
  max = "100",
  ctx = context()
): string {
  const outcome = applyRules(rules, toScaled(value), toScaled(max), ctx);
  assert.ok(outcome.ok, outcome.ok ? "" : `failed: ${outcome.failure.code}`);
  return formatMark(outcome.value.valueScaled);
}

describe("indexRules", () => {
  it("groups by scope and phase in ONE pass", () => {
    const rules = [
      rule("A", "CAP", { limit: 100 }, { componentId: "c1", phase: "COMPONENT_ADJUSTMENT" }),
      rule("B", "SCALE", { factor: 2 }, { componentId: "c1", phase: "COMPONENT_ADJUSTMENT" }),
      rule("C", "CAP", { limit: 50 }, { componentId: null, phase: "COURSE_ADJUSTMENT" }),
    ];

    const index = indexRules(rules);

    assert.deepEqual(
      rulesFor(index, "c1", "COMPONENT_ADJUSTMENT").map((entry) => entry.code),
      ["A", "B"]
    );
    assert.deepEqual(
      rulesFor(index, COURSE_SCOPE, "COURSE_ADJUSTMENT").map((entry) => entry.code),
      ["C"]
    );
  });

  it("PRESERVES the order rules arrived in", () => {
    // The repository sorted by (phase, sequence, code). Re-sorting here would
    // replace a decision the schema already made.
    const rules = [
      rule("THIRD", "CAP", { limit: 100 }, { sequence: 3 }),
      rule("FIRST", "CAP", { limit: 100 }, { sequence: 1 }),
      rule("SECOND", "CAP", { limit: 100 }, { sequence: 2 }),
    ];

    assert.deepEqual(
      rulesFor(indexRules(rules), COURSE_SCOPE, "COURSE_ADJUSTMENT").map((e) => e.code),
      ["THIRD", "FIRST", "SECOND"]
    );
  });

  it("returns an empty list for a scope or phase with no rules", () => {
    const index = indexRules([]);

    assert.deepEqual(rulesFor(index, COURSE_SCOPE, "COURSE_ADJUSTMENT"), []);
    assert.deepEqual(rulesFor(index, "nope", "SESSION_ADJUSTMENT"), []);
  });
});

describe("indexComponents", () => {
  it("separates roots from children", () => {
    const index = indexComponents([
      component("internal", { rollup: "WEIGHTED_SUM", aggregation: null }),
      component("st1", { parentComponentId: "internal" }),
      component("theory"),
    ]);

    assert.deepEqual(index.roots.map((entry) => entry.id).sort(), ["internal", "theory"]);
    assert.equal(index.childrenOf.get("internal")?.length, 1);
    assert.equal(isLeaf(index, "st1"), true);
    assert.equal(isLeaf(index, "internal"), false);
  });

  it("orders CHILDREN BEFORE PARENTS, so a fold never reads an unfinished value", () => {
    const index = indexComponents([
      component("root", { rollup: "WEIGHTED_SUM", aggregation: null }),
      component("mid", { parentComponentId: "root", rollup: "WEIGHTED_SUM", aggregation: null }),
      component("leaf", { parentComponentId: "mid" }),
    ]);

    const order = index.evaluationOrder;

    assert.ok(order.indexOf("leaf") < order.indexOf("mid"));
    assert.ok(order.indexOf("mid") < order.indexOf("root"));
  });

  it("is stable: components at one depth keep their declared order", () => {
    const definitions = [
      component("a", { sequence: 1 }),
      component("b", { sequence: 2 }),
      component("c", { sequence: 3 }),
    ];

    assert.deepEqual(indexComponents(definitions).evaluationOrder, ["a", "b", "c"]);
    assert.deepEqual(
      indexComponents(definitions).evaluationOrder,
      indexComponents(definitions).evaluationOrder,
      "two runs must agree"
    );
  });

  it("leaves an ORPHAN out of the order and reports it", () => {
    const definitions = [component("root"), component("lost", { parentComponentId: "missing" })];
    const index = indexComponents(definitions);

    assert.ok(!index.evaluationOrder.includes("lost"));
    assert.deepEqual(unreachableComponents(definitions, index), ["LOST"]);
  });

  it("TERMINATES on a cycle and reports the trapped components", () => {
    const definitions = [
      component("a", { parentComponentId: "b" }),
      component("b", { parentComponentId: "a" }),
    ];

    const index = indexComponents(definitions);

    assert.deepEqual(index.roots, []);
    assert.deepEqual(index.evaluationOrder, []);
    assert.deepEqual([...unreachableComponents(definitions, index)].sort(), ["A", "B"]);
  });
});

describe("applyRules — each operation", () => {
  it("ADD_CONSTANT", () => {
    assert.equal(applied([rule("BONUS", "ADD_CONSTANT", { amount: 5 })], "50"), "55.00");
  });

  it("ADD_CONSTANT with a negative amount is a penalty", () => {
    assert.equal(applied([rule("PEN", "ADD_CONSTANT", { amount: -2.5 })], "50"), "47.50");
  });

  it("ADD_PERCENTAGE", () => {
    assert.equal(applied([rule("UP", "ADD_PERCENTAGE", { percent: 10 })], "50"), "55.00");
  });

  it("ADD_PERCENTAGE with a negative percent is negative moderation", () => {
    assert.equal(applied([rule("MOD", "ADD_PERCENTAGE", { percent: -10 })], "50"), "45.00");
  });

  it("SCALE", () => {
    assert.equal(applied([rule("S", "SCALE", { factor: 1.5 })], "20"), "30.00");
    assert.equal(applied([rule("S", "SCALE", { factor: 0.8 })], "25"), "20.00");
  });

  it("CAP binds only above the ceiling", () => {
    assert.equal(applied([rule("C", "CAP", { limit: 100 })], "105"), "100.00");
    assert.equal(applied([rule("C", "CAP", { limit: 100 })], "95"), "95.00");
  });

  it("FLOOR binds only below the bottom", () => {
    assert.equal(applied([rule("F", "FLOOR", { limit: 0 })], "-5"), "0.00");
    assert.equal(applied([rule("F", "FLOOR", { limit: 0 })], "5"), "5.00");
  });

  it("CUSTOM_FORMULA binds VALUE and MAX_MARKS", () => {
    const expression = {
      kind: "BINARY",
      operator: "DIVIDE",
      left: { kind: "VAR", name: "VALUE" },
      right: { kind: "VAR", name: "MAX_MARKS" },
    };

    // 30/60 = 0.50.
    assert.equal(
      applied([rule("FORM", "CUSTOM_FORMULA", { expression })], "30", "60"),
      "0.50"
    );
  });
});

describe("applyRules — GRACE", () => {
  const grace = [rule("GRACE5", "GRACE", { maxAward: 5 })];

  it("lifts a near miss exactly to the pass mark", () => {
    assert.equal(applied(grace, "38"), "40.00");
  });

  it("awards nothing when the shortfall exceeds the allowance", () => {
    // A partial lift would spend the allowance and still fail the student.
    assert.equal(applied(grace, "30"), "30.00");
  });

  it("awards nothing to a student already passing", () => {
    assert.equal(applied(grace, "55"), "55.00");
  });

  it("does nothing when no pass mark is known", () => {
    assert.equal(applied(grace, "38", "100", context({ passMarkScaled: null })), "38.00");
  });
});

describe("applyRules — ordering and composition", () => {
  it("each rule consumes the previous one's output", () => {
    // 38 -> grace to 40 -> cap at 39 would be perverse, but proves the chain.
    const rules = [
      rule("GRACE", "GRACE", { maxAward: 5 }, { sequence: 1 }),
      rule("CAP", "CAP", { limit: 39 }, { sequence: 2 }),
    ];

    assert.equal(applied(rules, "38"), "39.00");
  });

  it("ORDER CHANGES THE ANSWER, which is why sequence is semantic", () => {
    const scaleThenAdd = [
      rule("S", "SCALE", { factor: 2 }, { sequence: 1 }),
      rule("A", "ADD_CONSTANT", { amount: 10 }, { sequence: 2 }),
    ];
    const addThenScale = [
      rule("A", "ADD_CONSTANT", { amount: 10 }, { sequence: 1 }),
      rule("S", "SCALE", { factor: 2 }, { sequence: 2 }),
    ];

    assert.equal(applied(scaleThenAdd, "20"), "50.00");
    assert.equal(applied(addThenScale, "20"), "60.00");
  });

  it("the classic pairing: add a bonus, then cap at the maximum", () => {
    const rules = [
      rule("BONUS", "ADD_CONSTANT", { amount: 10 }, { sequence: 1 }),
      rule("CAP", "CAP", { limit: 100 }, { sequence: 2 }),
    ];

    assert.equal(applied(rules, "95"), "100.00");
    assert.equal(applied(rules, "50"), "60.00");
  });

  it("reports which rules were applied", () => {
    const outcome = applyRules(
      [rule("A", "ADD_CONSTANT", { amount: 1 }), rule("B", "ADD_CONSTANT", { amount: 1 })],
      toScaled("10"),
      toScaled("100"),
      context()
    );

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.deepEqual(outcome.value.appliedCodes, ["A", "B"]);
    }
  });

  it("an empty rule list returns the value untouched", () => {
    assert.equal(applied([], "42.50"), "42.50");
  });
});

describe("applyRules — conditions", () => {
  it("skips a rule whose condition does not hold", () => {
    const conditional = rule(
      "BONUS",
      "ADD_CONSTANT",
      { amount: 5 },
      { condition: { all: [{ variable: "ATTENDANCE_PERCENT", comparator: "GTE", value: 90 }] } }
    );

    // Attendance is 80, so the bonus does not apply.
    assert.equal(applied([conditional], "50"), "50.00");
  });

  it("applies a rule whose condition holds", () => {
    const conditional = rule(
      "BONUS",
      "ADD_CONSTANT",
      { amount: 5 },
      { condition: { all: [{ variable: "ATTENDANCE_PERCENT", comparator: "GTE", value: 75 }] } }
    );

    assert.equal(applied([conditional], "50"), "55.00");
  });

  it("evaluates the condition against the CURRENT value, not the original", () => {
    const rules = [
      rule("FIRST", "ADD_CONSTANT", { amount: 20 }, { sequence: 1 }),
      rule(
        "SECOND",
        "ADD_CONSTANT",
        { amount: 5 },
        {
          sequence: 2,
          condition: { all: [{ variable: "VALUE", comparator: "GTE", value: 60 }] },
        }
      ),
    ];

    // 50 -> 70, so the second rule's condition on VALUE now holds.
    assert.equal(applied(rules, "50"), "75.00");
    // 30 -> 50, so it does not.
    assert.equal(applied(rules, "30"), "50.00");
  });
});

describe("applyRules — cohort rules are deferred, not guessed", () => {
  it("records MODERATION and CURVE without applying them", () => {
    const outcome = applyRules(
      [
        rule("MOD", "MODERATION", { targetMean: 60, targetStdDev: 10 }),
        rule("CRV", "CURVE", { distribution: [{ grade: "O", topPercent: 10 }] }),
        rule("CAP", "CAP", { limit: 100 }),
      ],
      toScaled("55"),
      toScaled("100"),
      context()
    );

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(formatMark(outcome.value.valueScaled), "55.00", "value untouched");
      assert.deepEqual(outcome.value.deferredCodes, ["MOD", "CRV"]);
      assert.deepEqual(outcome.value.appliedCodes, ["CAP"]);
    }
  });
});

describe("applyRules — refuses bad configuration", () => {
  it("refuses a missing parameter for every operation that needs one", () => {
    const cases: readonly [RuleDefinition["operation"], unknown][] = [
      ["ADD_CONSTANT", {}],
      ["ADD_PERCENTAGE", {}],
      ["SCALE", null],
      ["CAP", { wrong: 1 }],
      ["FLOOR", "nope"],
      ["GRACE", {}],
    ];

    for (const [operation, config] of cases) {
      const outcome = applyRules(
        [rule("R", operation, config)],
        toScaled("50"),
        toScaled("100"),
        context()
      );

      assert.equal(outcome.ok, false, operation);
      if (!outcome.ok) {
        assert.equal(outcome.failure.code, ROLLUP_ERROR.MALFORMED_CONFIG);
        assert.equal(outcome.failure.subject, "R");
      }
    }
  });

  it("propagates a formula failure with the rule that caused it", () => {
    const outcome = applyRules(
      [
        rule("BAD", "CUSTOM_FORMULA", {
          expression: {
            kind: "BINARY",
            operator: "DIVIDE",
            left: { kind: "CONST", value: 1 },
            right: { kind: "CONST", value: 0 },
          },
        }),
      ],
      toScaled("50"),
      toScaled("100"),
      context()
    );

    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.failure.subject, "BAD");
    }
  });

  it("propagates a malformed condition", () => {
    const outcome = applyRules(
      [rule("R", "CAP", { limit: 1 }, { condition: { all: "yes" } })],
      toScaled("50"),
      toScaled("100"),
      context()
    );

    assert.equal(outcome.ok, false);
  });
});

describe("applyRules — immutability", () => {
  it("does not mutate the rules it was given", () => {
    const rules = [rule("A", "ADD_CONSTANT", { amount: 5 })];
    const snapshot = JSON.stringify(rules);

    applyRules(rules, toScaled("50"), toScaled("100"), context());

    assert.equal(JSON.stringify(rules), snapshot);
  });

  it("does not mutate the context bindings", () => {
    const ctx = context();
    const snapshot = JSON.stringify(ctx.bindings);

    applyRules(
      [rule("A", "ADD_CONSTANT", { amount: 5 })],
      toScaled("50"),
      toScaled("100"),
      ctx
    );

    assert.equal(JSON.stringify(ctx.bindings), snapshot);
  });

  it("returns the same answer when re-run on the same input", () => {
    const rules = [
      rule("G", "GRACE", { maxAward: 5 }, { sequence: 1 }),
      rule("C", "CAP", { limit: 100 }, { sequence: 2 }),
    ];

    const first = applied(rules, "38");
    const second = applied(rules, "38");

    assert.equal(first, second);
  });
});

describe("rollupChildren", () => {
  const parent = component("internal", {
    maxMarksScaled: toScaled("30"),
    rollup: "WEIGHTED_SUM",
    aggregation: null,
  });

  function child(id: string, max: string, weight: string, value: string) {
    return {
      definition: component(id, {
        parentComponentId: "internal",
        maxMarksScaled: toScaled(max),
        weightageScaled: toScaled(weight),
      }),
      valueScaled: toScaled(value) as Scaled,
    };
  }

  it("WEIGHTED_SUM reaches the parent's full scale at full marks", () => {
    const outcome = rollupChildren(
      parent,
      [child("a", "20", "50", "20"), child("b", "10", "50", "10")],
      context()
    );

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(formatMark(outcome.value), "30.00");
    }
  });

  it("WEIGHTED_SUM halves when every child is half", () => {
    const outcome = rollupChildren(
      parent,
      [child("a", "20", "50", "10"), child("b", "10", "50", "5")],
      context()
    );

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(formatMark(outcome.value), "15.00");
    }
  });

  it("SUM adds the children's raw values", () => {
    const outcome = rollupChildren(
      component("p", { rollup: "SUM", aggregation: null }),
      [child("a", "20", "0", "12"), child("b", "10", "0", "6")],
      context()
    );

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(formatMark(outcome.value), "18.00");
    }
  });

  it("AVERAGE takes the unweighted mean of the children's proportions", () => {
    const outcome = rollupChildren(
      component("p", { rollup: "AVERAGE", aggregation: null, maxMarksScaled: toScaled("20") }),
      [child("a", "20", "0", "20"), child("b", "10", "0", "5")],
      context()
    );

    // 100% and 50% -> mean 75% of 20 = 15.00.
    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(formatMark(outcome.value), "15.00");
    }
  });

  it("refuses a branch with no declared rollup", () => {
    const outcome = rollupChildren(
      component("p", { rollup: null }),
      [child("a", "20", "100", "10")],
      context()
    );

    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.failure.code, ROLLUP_ERROR.MISSING_ROLLUP);
    }
  });

  it("returns zero for a branch with no children", () => {
    const outcome = rollupChildren(parent, [], context());

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(outcome.value, 0);
    }
  });
});

describe("rollupRoots", () => {
  function root(id: string, max: string, weight: string, value: string) {
    return {
      definition: component(id, {
        maxMarksScaled: toScaled(max),
        weightageScaled: toScaled(weight),
      }),
      valueScaled: toScaled(value) as Scaled,
    };
  }

  it("full marks on every root is exactly 100.00", () => {
    // The University A shape: internal 30 / theory 70.
    const outcome = rollupRoots(
      [root("internal", "30", "30", "30"), root("theory", "70", "70", "70")],
      context()
    );

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(
        formatMark(outcome.value),
        "100.00",
        "99.99 would drop a student a grade band"
      );
    }
  });

  it("computes a partial total as a percentage", () => {
    // 24/30 internal (80% of 30 = 24) and 35/70 theory (50% of 70 = 35).
    const outcome = rollupRoots(
      [root("internal", "30", "30", "24"), root("theory", "70", "70", "35")],
      context()
    );

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(formatMark(outcome.value), "59.00");
    }
  });

  it("zero marks everywhere is zero", () => {
    const outcome = rollupRoots(
      [root("internal", "30", "30", "0"), root("theory", "70", "70", "0")],
      context()
    );

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(formatMark(outcome.value), "0.00");
    }
  });

  it("holds exactness across an awkward weight set", () => {
    // 28.10 + 35.95 + 35.95 totals exactly 100 in decimal and not in floats.
    const outcome = rollupRoots(
      [
        root("a", "10", "28.10", "10"),
        root("b", "10", "35.95", "10"),
        root("c", "10", "35.95", "10"),
      ],
      context()
    );

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(formatMark(outcome.value), "100.00");
    }
  });

  it("handles a large component set without drift", () => {
    // Twenty roots at 5% each, all at full marks.
    const roots = Array.from({ length: 20 }, (_value, index) =>
      root(`c${index}`, "10", "5", "10")
    );

    const outcome = rollupRoots(roots, context());

    assert.ok(outcome.ok);
    if (outcome.ok) {
      assert.equal(formatMark(outcome.value), "100.00");
    }
  });
});
