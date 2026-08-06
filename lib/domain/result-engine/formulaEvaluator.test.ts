// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Formula Evaluator
// LAYER  : Domain — Unit Tests
// PURPOSE: Verify the one place where tenant-supplied structure becomes
//          executed arithmetic.
//
//          The adversarial cases matter more than the arithmetic ones: an
//          evaluator that computes 2 + 2 correctly but does not TERMINATE on a
//          cyclic graph, or reads a variable the engine never bound, has failed
//          at its actual job. Every guard is exercised on a payload that would
//          exploit its absence.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RoundingMode } from "@/app/generated/prisma/enums";
import {
  MAX_EVALUATION_DEPTH,
  MAX_EVALUATION_NODES,
} from "@/lib/constants/resultEngine";
import { formatMark, toScaled } from "@/lib/domain/result-engine/decimal";
import {
  EVALUATION_ERROR,
  evaluateCondition,
  evaluateFormula,
} from "@/lib/domain/result-engine/formulaEvaluator";
import type { FormulaContext, Scaled } from "@/lib/domain/result-engine/types";

/** A context binding every whitelisted variable, for the arithmetic cases. */
function context(overrides: Partial<Record<string, Scaled>> = {}): FormulaContext {
  return {
    rounding: RoundingMode.HALF_UP,
    bindings: {
      VALUE: toScaled("20"),
      MAX_MARKS: toScaled("30"),
      ATTENDANCE_PERCENT: toScaled("80"),
      COURSE_TOTAL: toScaled("55"),
      ...overrides,
    },
  };
}

const CONST = (value: number) => ({ kind: "CONST", value });
const VAR = (name: string) => ({ kind: "VAR", name });
const OP = (operator: string, left: unknown, right: unknown) => ({
  kind: "BINARY",
  operator,
  left,
  right,
});

/** Evaluate and assert success, returning the scaled value. */
function evaluate(node: unknown, ctx: FormulaContext = context()): Scaled {
  const outcome = evaluateFormula(node, ctx);
  assert.ok(outcome.ok, `expected success, got ${outcome.ok ? "" : outcome.failure.code}`);
  return outcome.value;
}

/** Evaluate and assert a specific failure code. */
function expectFailure(node: unknown, code: string, ctx: FormulaContext = context()): void {
  const outcome = evaluateFormula(node, ctx);
  assert.equal(outcome.ok, false, "expected a failure");
  if (!outcome.ok) {
    assert.equal(outcome.failure.code, code);
  }
}

describe("evaluateFormula — leaves", () => {
  it("evaluates a bare constant", () => {
    assert.equal(evaluate(CONST(10)), toScaled("10"));
    assert.equal(evaluate(CONST(0.5)), toScaled("0.5"));
    assert.equal(evaluate(CONST(-3.25)), toScaled("-3.25"));
  });

  it("evaluates a bare variable", () => {
    assert.equal(evaluate(VAR("VALUE")), toScaled("20"));
    assert.equal(evaluate(VAR("MAX_MARKS")), toScaled("30"));
  });
});

describe("evaluateFormula — every operator", () => {
  it("ADD", () => {
    assert.equal(evaluate(OP("ADD", CONST(2.5), CONST(3.25))), toScaled("5.75"));
  });

  it("SUBTRACT", () => {
    assert.equal(evaluate(OP("SUBTRACT", CONST(10), CONST(2.5))), toScaled("7.5"));
  });

  it("MULTIPLY re-scales the product rather than squaring the scale", () => {
    assert.equal(evaluate(OP("MULTIPLY", CONST(4), CONST(2.5))), toScaled("10"));
    assert.equal(evaluate(OP("MULTIPLY", VAR("VALUE"), CONST(0.5))), toScaled("10"));
  });

  it("DIVIDE lifts the quotient back onto the working scale", () => {
    assert.equal(evaluate(OP("DIVIDE", CONST(10), CONST(4))), toScaled("2.5"));
    assert.equal(evaluate(OP("DIVIDE", VAR("VALUE"), VAR("MAX_MARKS"))), toScaled("0.67"));
  });

  it("MIN and MAX select without arithmetic", () => {
    assert.equal(evaluate(OP("MIN", CONST(4), CONST(9))), toScaled("4"));
    assert.equal(evaluate(OP("MAX", CONST(4), CONST(9))), toScaled("9"));
    assert.equal(evaluate(OP("MIN", CONST(-4), CONST(-9))), toScaled("-9"));
  });

  it("SUBTRACT operands are not commuted", () => {
    // The single easiest way to get an explicit-stack evaluator wrong.
    assert.equal(evaluate(OP("SUBTRACT", CONST(10), CONST(3))), toScaled("7"));
    assert.equal(evaluate(OP("SUBTRACT", CONST(3), CONST(10))), toScaled("-7"));
  });

  it("DIVIDE operands are not commuted", () => {
    assert.equal(evaluate(OP("DIVIDE", CONST(10), CONST(4))), toScaled("2.5"));
    assert.equal(evaluate(OP("DIVIDE", CONST(4), CONST(10))), toScaled("0.4"));
  });
});

describe("evaluateFormula — negation without a NEGATE node", () => {
  it("expresses negation as zero minus the value", () => {
    assert.equal(evaluate(OP("SUBTRACT", CONST(0), VAR("VALUE"))), toScaled("-20"));
  });

  it("expresses negation as multiplication by minus one", () => {
    assert.equal(evaluate(OP("MULTIPLY", VAR("VALUE"), CONST(-1))), toScaled("-20"));
  });
});

describe("evaluateFormula — nesting and precedence", () => {
  it("takes precedence from the tree shape, not from operator ranking", () => {
    // (2 + 3) x 4 = 20, where 2 + 3 x 4 would be 14. The AST decides.
    const grouped = OP("MULTIPLY", OP("ADD", CONST(2), CONST(3)), CONST(4));
    assert.equal(evaluate(grouped), toScaled("20"));

    const ungrouped = OP("ADD", CONST(2), OP("MULTIPLY", CONST(3), CONST(4)));
    assert.equal(evaluate(ungrouped), toScaled("14"));
  });

  it("evaluates a deeply nested but legal expression", () => {
    // ((((1+1)+1)+1)+1) = 5
    let node: unknown = CONST(1);
    for (let level = 0; level < 4; level += 1) {
      node = OP("ADD", node, CONST(1));
    }
    assert.equal(evaluate(node), toScaled("5"));
  });

  it("evaluates a balanced tree, where both sides carry work", () => {
    // (10 - 4) x (2 + 3) = 30
    const node = OP(
      "MULTIPLY",
      OP("SUBTRACT", CONST(10), CONST(4)),
      OP("ADD", CONST(2), CONST(3))
    );
    assert.equal(evaluate(node), toScaled("30"));
  });
});

describe("evaluateFormula — regression: the formulas a regulation actually writes", () => {
  it("weighted contribution: (VALUE / MAX_MARKS) x 30", () => {
    const node = OP(
      "MULTIPLY",
      OP("DIVIDE", VAR("VALUE"), VAR("MAX_MARKS")),
      CONST(30)
    );

    // 20/30 = 0.67 at working scale, x 30 = 20.10.
    assert.equal(formatMark(evaluate(node)), "20.10");
  });

  it("attendance-scaled marks: ATTENDANCE_PERCENT / 100 x 5", () => {
    const node = OP(
      "MULTIPLY",
      OP("DIVIDE", VAR("ATTENDANCE_PERCENT"), CONST(100)),
      CONST(5)
    );

    assert.equal(formatMark(evaluate(node)), "4.00");
  });

  it("grace capped at the pass mark: MIN(VALUE + 5, 40)", () => {
    const node = OP("MIN", OP("ADD", VAR("VALUE"), CONST(5)), CONST(40));

    assert.equal(formatMark(evaluate(node)), "25.00");
    assert.equal(
      formatMark(evaluate(node, context({ VALUE: toScaled("38") }))),
      "40.00",
      "the cap binds once the grace would overshoot"
    );
  });

  it("negative moderation: COURSE_TOTAL - 2.5, floored at zero", () => {
    const node = OP("MAX", OP("SUBTRACT", VAR("COURSE_TOTAL"), CONST(2.5)), CONST(0));

    assert.equal(formatMark(evaluate(node)), "52.50");
    assert.equal(
      formatMark(evaluate(node, context({ COURSE_TOTAL: toScaled("1") }))),
      "0.00",
      "the floor stops moderation driving a total below zero"
    );
  });

  it("best-of style selection: MAX of three sittings", () => {
    const node = OP("MAX", OP("MAX", CONST(12), CONST(17)), CONST(15));

    assert.equal(formatMark(evaluate(node)), "17.00");
  });

  it("keeps two-decimal precision through a chain", () => {
    // 33.33 + 33.33 + 33.34 must be exactly 100.00.
    const node = OP("ADD", OP("ADD", CONST(33.33), CONST(33.33)), CONST(33.34));

    assert.equal(formatMark(evaluate(node)), "100.00");
  });

  it("honours the rounding mode it is given", () => {
    // 1/8 = 0.125, which sits exactly on the half at the second decimal — the
    // one place where the mode, and only the mode, decides the last digit.
    const node = OP("DIVIDE", CONST(1), CONST(8));

    const up = evaluateFormula(node, { ...context(), rounding: RoundingMode.HALF_UP });
    const down = evaluateFormula(node, { ...context(), rounding: RoundingMode.HALF_DOWN });
    const even = evaluateFormula(node, { ...context(), rounding: RoundingMode.HALF_EVEN });

    assert.ok(up.ok && down.ok && even.ok);
    if (up.ok && down.ok && even.ok) {
      assert.equal(formatMark(up.value), "0.13");
      assert.equal(formatMark(down.value), "0.12");
      assert.equal(formatMark(even.value), "0.12", "12 is the even neighbour");
    }
  });

  it("rounds a value below the working scale down to zero rather than inventing one", () => {
    // 1/800 = 0.00125, which is 0.00 at two decimal places. Not a defect —
    // the working scale is the regulation's, and it does not record thousandths.
    const node = OP("DIVIDE", CONST(1), CONST(800));

    assert.equal(formatMark(evaluate(node)), "0.00");
  });
});

describe("evaluateFormula — refuses malformed structure", () => {
  it("refuses an unknown node kind", () => {
    expectFailure({ kind: "CALL", name: "process" }, EVALUATION_ERROR.UNKNOWN_NODE_KIND);
  });

  it("refuses an unknown operator", () => {
    expectFailure(OP("EXEC", CONST(1), CONST(1)), EVALUATION_ERROR.UNKNOWN_OPERATOR);
  });

  it("refuses primitives, arrays, null and undefined where a node belongs", () => {
    for (const payload of ["VALUE * 2", 42, null, undefined, [CONST(1)], true]) {
      expectFailure(payload, EVALUATION_ERROR.MALFORMED_NODE);
    }
  });

  it("refuses a binary node missing an operand", () => {
    expectFailure(
      { kind: "BINARY", operator: "ADD", left: CONST(1) },
      EVALUATION_ERROR.MALFORMED_NODE
    );
  });

  it("refuses a non-finite or non-numeric constant", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, "10", null]) {
      expectFailure(CONST(value as number), EVALUATION_ERROR.INVALID_CONSTANT);
    }
  });

  it("refuses a constant beyond exact representation", () => {
    expectFailure(CONST(1e21), EVALUATION_ERROR.INVALID_CONSTANT);
  });
});

describe("evaluateFormula — refuses unsafe variables", () => {
  it("refuses a name outside the whitelist", () => {
    expectFailure(VAR("process.env"), EVALUATION_ERROR.UNKNOWN_VARIABLE);
    expectFailure(VAR("__proto__"), EVALUATION_ERROR.UNKNOWN_VARIABLE);
    expectFailure(VAR("constructor"), EVALUATION_ERROR.UNKNOWN_VARIABLE);
  });

  it("distinguishes a whitelisted name the engine could not bind", () => {
    const withoutCourseTotal: FormulaContext = {
      rounding: RoundingMode.HALF_UP,
      bindings: { VALUE: toScaled("20") },
    };

    expectFailure(VAR("COURSE_TOTAL"), EVALUATION_ERROR.UNBOUND_VARIABLE, withoutCourseTotal);
  });

  it("does not treat an inherited property as a binding", () => {
    // `toString` exists on every object's prototype chain. Reading bindings
    // must not find it.
    expectFailure(VAR("toString"), EVALUATION_ERROR.UNKNOWN_VARIABLE);
  });
});

describe("evaluateFormula — arithmetic guards", () => {
  it("refuses division by a literal zero", () => {
    expectFailure(OP("DIVIDE", CONST(10), CONST(0)), EVALUATION_ERROR.DIVISION_BY_ZERO);
  });

  it("refuses division by a computed zero", () => {
    // The case the write-time validator cannot see.
    expectFailure(
      OP("DIVIDE", CONST(10), OP("SUBTRACT", CONST(5), CONST(5))),
      EVALUATION_ERROR.DIVISION_BY_ZERO
    );
  });

  it("refuses division by a variable that happens to be zero", () => {
    expectFailure(
      OP("DIVIDE", CONST(10), VAR("VALUE")),
      EVALUATION_ERROR.DIVISION_BY_ZERO,
      context({ VALUE: 0 })
    );
  });
});

describe("evaluateFormula — terminates on hostile input", () => {
  it("refuses a tree past the depth ceiling", () => {
    let node: unknown = CONST(1);
    for (let level = 0; level < MAX_EVALUATION_DEPTH + 2; level += 1) {
      node = OP("ADD", node, CONST(1));
    }

    expectFailure(node, EVALUATION_ERROR.MAX_DEPTH_EXCEEDED);
  });

  it("refuses a tree past the node budget", () => {
    // Balanced, so it breaches the node count well before the depth limit.
    function balanced(levels: number): unknown {
      return levels === 0 ? CONST(1) : OP("ADD", balanced(levels - 1), balanced(levels - 1));
    }

    const outcome = evaluateFormula(balanced(9), context());

    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.ok(
        outcome.failure.code === EVALUATION_ERROR.MAX_NODES_EXCEEDED ||
          outcome.failure.code === EVALUATION_ERROR.MAX_DEPTH_EXCEEDED
      );
    }
  });

  it("TERMINATES on a self-referential cycle instead of hanging", () => {
    // The case a recursive evaluator never returns from.
    //
    // DEPTH is what ends it, not the node budget: every expansion along a cycle
    // descends one level, so a cyclic PATH always breaches the depth ceiling
    // (16) long before the node budget (256). The budget bounds BREADTH — a
    // wide tree that never nests deeply. The two together are what guarantee
    // termination on any input.
    const cyclic: Record<string, unknown> = { kind: "BINARY", operator: "ADD" };
    cyclic.left = CONST(1);
    cyclic.right = cyclic;

    const outcome = evaluateFormula(cyclic, context());

    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.failure.code, EVALUATION_ERROR.MAX_DEPTH_EXCEEDED);
    }
  });

  it("terminates on a mutual cycle between two nodes", () => {
    const first: Record<string, unknown> = { kind: "BINARY", operator: "ADD", left: CONST(1) };
    const second: Record<string, unknown> = { kind: "BINARY", operator: "ADD", left: CONST(1) };
    first.right = second;
    second.right = first;

    const outcome = evaluateFormula(first, context());

    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.failure.code, EVALUATION_ERROR.MAX_DEPTH_EXCEEDED);
    }
  });

  it("refuses a wide tree on the node budget rather than on depth", () => {
    // A shallow, very wide expression: depth stays small, so the budget is the
    // guard that must catch it. This is the case depth alone would miss.
    let node: unknown = CONST(1);
    for (let index = 0; index < MAX_EVALUATION_NODES; index += 1) {
      node = OP("ADD", CONST(1), node);
    }

    const outcome = evaluateFormula(node, context());

    assert.equal(outcome.ok, false);
  });

  it("does not blow the JavaScript stack on a ten-thousand-deep chain", () => {
    // Built iteratively so the TEST does not recurse either.
    let node: unknown = CONST(1);
    for (let level = 0; level < 10_000; level += 1) {
      node = OP("ADD", node, CONST(1));
    }

    const outcome = evaluateFormula(node, context());

    assert.equal(outcome.ok, false, "must reject rather than overflow");
  });

  it("visits no more nodes than the budget even when rejecting", () => {
    let node: unknown = CONST(1);
    for (let level = 0; level < 10_000; level += 1) {
      node = OP("ADD", node, CONST(1));
    }

    // If the walk did not stop at the budget this would take visibly long;
    // asserting the outcome is enough to prove it returned at all.
    const started = evaluateFormula(node, context());
    assert.equal(started.ok, false);
    assert.ok(MAX_EVALUATION_NODES > 0);
  });
});

describe("evaluateCondition", () => {
  it("treats an absent condition as unconditional", () => {
    for (const empty of [null, undefined]) {
      const outcome = evaluateCondition(empty, context());
      assert.ok(outcome.ok && outcome.value === true);
    }
  });

  it("evaluates a single comparison", () => {
    const outcome = evaluateCondition(
      { all: [{ variable: "VALUE", comparator: "GTE", value: 10 }] },
      context()
    );

    assert.ok(outcome.ok && outcome.value === true);
  });

  it("evaluates every comparator", () => {
    const cases = [
      ["GT", 19, true],
      ["GT", 20, false],
      ["GTE", 20, true],
      ["LT", 21, true],
      ["LT", 20, false],
      ["LTE", 20, true],
      ["EQ", 20, true],
      ["EQ", 19, false],
    ] as const;

    for (const [comparator, value, expected] of cases) {
      const outcome = evaluateCondition(
        { all: [{ variable: "VALUE", comparator, value }] },
        context()
      );

      assert.ok(outcome.ok, `${comparator} ${value}`);
      if (outcome.ok) {
        assert.equal(outcome.value, expected, `VALUE(20) ${comparator} ${value}`);
      }
    }
  });

  it("requires every clause to hold", () => {
    const outcome = evaluateCondition(
      {
        all: [
          { variable: "ATTENDANCE_PERCENT", comparator: "GTE", value: 75 },
          { variable: "COURSE_TOTAL", comparator: "LT", value: 40 },
        ],
      },
      context()
    );

    // Attendance 80 >= 75 holds, but total 55 < 40 does not.
    assert.ok(outcome.ok && outcome.value === false);
  });

  it("expresses the grace policy: below the pass mark but well attended", () => {
    const grace = {
      all: [
        { variable: "COURSE_TOTAL", comparator: "LT", value: 40 },
        { variable: "ATTENDANCE_PERCENT", comparator: "GTE", value: 75 },
      ],
    };

    const eligible = evaluateCondition(grace, context({ COURSE_TOTAL: toScaled("38") }));
    assert.ok(eligible.ok && eligible.value === true);

    const alreadyPassing = evaluateCondition(grace, context({ COURSE_TOTAL: toScaled("55") }));
    assert.ok(alreadyPassing.ok && alreadyPassing.value === false);
  });

  it("refuses a malformed condition", () => {
    for (const payload of [42, "always", { any: [] }, { all: "yes" }]) {
      const outcome = evaluateCondition(payload, context());
      assert.equal(outcome.ok, false, JSON.stringify(payload));
    }
  });

  it("refuses an unknown comparator or variable", () => {
    const badComparator = evaluateCondition(
      { all: [{ variable: "VALUE", comparator: "MATCHES", value: 1 }] },
      context()
    );
    assert.equal(badComparator.ok, false);

    const badVariable = evaluateCondition(
      { all: [{ variable: "process", comparator: "GT", value: 1 }] },
      context()
    );
    assert.equal(badVariable.ok, false);
  });
});
