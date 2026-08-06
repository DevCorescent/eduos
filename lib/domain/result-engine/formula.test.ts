// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Custom Formula
// LAYER  : Domain — Unit Tests
// PURPOSE: Verify the security boundary of the rule engine.
//
//          These tests are written ahead of the Tests layer in the agreed code
//          order, deliberately. This validator is the single point at which
//          tenant-supplied input becomes structure the engine will later
//          execute, and shipping it across a validation gate unverified would
//          make `npm test` pass vacuously for the one file where passing
//          vacuously matters most.
//
//          The adversarial cases matter more than the happy ones: a validator
//          that accepts good input but does not REFUSE hostile input has failed
//          at its only job.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MAX_FORMULA_DEPTH, MAX_FORMULA_NODES } from "@/lib/constants/evaluationRule";
import {
  collectFormulaVariables,
  validateFormulaExpression,
  type FormulaExpression,
} from "@/lib/domain/result-engine/formula";

/** value * 0.5 — the simplest realistic formula. */
const HALVE: FormulaExpression = {
  kind: "BINARY",
  operator: "MULTIPLY",
  left: { kind: "VAR", name: "VALUE" },
  right: { kind: "CONST", value: 0.5 },
};

/** Build a left-leaning chain of the given depth, for the depth guard. */
function chain(depth: number): FormulaExpression {
  let node: FormulaExpression = { kind: "CONST", value: 1 };

  for (let level = 1; level < depth; level += 1) {
    node = {
      kind: "BINARY",
      operator: "ADD",
      left: node,
      right: { kind: "CONST", value: 1 },
    };
  }

  return node;
}

describe("validateFormulaExpression — accepts valid formulas", () => {
  it("accepts a bare constant", () => {
    assert.deepEqual(validateFormulaExpression({ kind: "CONST", value: 10 }), []);
  });

  it("accepts a bare variable", () => {
    assert.deepEqual(validateFormulaExpression({ kind: "VAR", name: "VALUE" }), []);
  });

  it("accepts arithmetic over a variable", () => {
    assert.deepEqual(validateFormulaExpression(HALVE), []);
  });

  it("accepts a clamp expressed with MIN and MAX", () => {
    const clamp: FormulaExpression = {
      kind: "BINARY",
      operator: "MIN",
      left: {
        kind: "BINARY",
        operator: "MAX",
        left: { kind: "VAR", name: "VALUE" },
        right: { kind: "CONST", value: 0 },
      },
      right: { kind: "VAR", name: "MAX_MARKS" },
    };

    assert.deepEqual(validateFormulaExpression(clamp), []);
  });

  it("accepts a formula exactly at the depth limit", () => {
    assert.deepEqual(validateFormulaExpression(chain(MAX_FORMULA_DEPTH)), []);
  });
});

describe("validateFormulaExpression — refuses hostile or malformed input", () => {
  it("refuses a formula one level past the depth limit", () => {
    const violations = validateFormulaExpression(chain(MAX_FORMULA_DEPTH + 1));

    assert.ok(violations.length > 0);
    assert.ok(violations.some((violation) => violation.message.includes("nest at most")));
  });

  it("terminates on a pathologically deep tree instead of overflowing", () => {
    // The case a recursive validator would die on. Built iteratively so the
    // TEST itself does not recurse either.
    let node: FormulaExpression = { kind: "CONST", value: 1 };
    for (let level = 0; level < 10_000; level += 1) {
      node = { kind: "BINARY", operator: "ADD", left: node, right: { kind: "CONST", value: 1 } };
    }

    const violations = validateFormulaExpression(node);

    assert.ok(violations.length > 0, "must reject rather than accept");
    assert.ok(
      violations.length < MAX_FORMULA_NODES + 2,
      "must abandon the walk rather than report a violation per node"
    );
  });

  it("refuses a tree exceeding the node budget", () => {
    // A balanced tree of 127 nodes: past the budget without being deep.
    function balanced(levels: number): FormulaExpression {
      if (levels === 0) {
        return { kind: "CONST", value: 1 };
      }
      return {
        kind: "BINARY",
        operator: "ADD",
        left: balanced(levels - 1),
        right: balanced(levels - 1),
      };
    }

    const violations = validateFormulaExpression(balanced(6));

    assert.ok(violations.some((violation) => violation.message.includes("at most")));
  });

  it("refuses an unknown node kind", () => {
    const violations = validateFormulaExpression({ kind: "CALL", name: "process" });

    assert.equal(violations.length, 1);
    assert.ok(violations[0].message.includes("Unknown node kind"));
  });

  it("refuses an unknown variable", () => {
    const violations = validateFormulaExpression({ kind: "VAR", name: "process.env" });

    assert.equal(violations.length, 1);
    assert.ok(violations[0].message.includes("Unknown variable"));
  });

  it("refuses an unknown operator", () => {
    const violations = validateFormulaExpression({
      kind: "BINARY",
      operator: "EXEC",
      left: { kind: "CONST", value: 1 },
      right: { kind: "CONST", value: 1 },
    });

    assert.ok(violations.some((violation) => violation.message.includes("Unknown operator")));
  });

  it("refuses a non-finite constant", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, "10", null]) {
      const violations = validateFormulaExpression({ kind: "CONST", value });
      assert.ok(violations.length > 0, `expected rejection for ${String(value)}`);
    }
  });

  it("refuses division by a literal zero", () => {
    const violations = validateFormulaExpression({
      kind: "BINARY",
      operator: "DIVIDE",
      left: { kind: "VAR", name: "VALUE" },
      right: { kind: "CONST", value: 0 },
    });

    assert.ok(violations.some((violation) => violation.message.includes("Division by a literal zero")));
  });

  it("refuses primitives, arrays and null where a node is expected", () => {
    for (const value of ["value * 2", 42, null, undefined, [{ kind: "CONST", value: 1 }]]) {
      assert.ok(
        validateFormulaExpression(value).length > 0,
        `expected rejection for ${JSON.stringify(value) ?? "undefined"}`
      );
    }
  });

  it("reports the path to each offending node", () => {
    const violations = validateFormulaExpression({
      kind: "BINARY",
      operator: "ADD",
      left: { kind: "VAR", name: "NOPE" },
      right: { kind: "CONST", value: 1 },
    });

    assert.equal(violations.length, 1);
    assert.equal(violations[0].path, "expression.left.name");
  });

  it("reports every offending node, not just the first", () => {
    const violations = validateFormulaExpression({
      kind: "BINARY",
      operator: "ADD",
      left: { kind: "VAR", name: "NOPE" },
      right: { kind: "CONST", value: "not-a-number" },
    });

    assert.equal(violations.length, 2);
  });
});

describe("collectFormulaVariables", () => {
  it("returns the variables an expression reads, without duplicates", () => {
    const expression: FormulaExpression = {
      kind: "BINARY",
      operator: "ADD",
      left: { kind: "VAR", name: "VALUE" },
      right: {
        kind: "BINARY",
        operator: "MULTIPLY",
        left: { kind: "VAR", name: "VALUE" },
        right: { kind: "VAR", name: "COURSE_TOTAL" },
      },
    };

    assert.deepEqual(collectFormulaVariables(expression).sort(), ["COURSE_TOTAL", "VALUE"]);
  });

  it("returns nothing for a constant-only expression", () => {
    assert.deepEqual(collectFormulaVariables({ kind: "CONST", value: 1 }), []);
  });

  it("ignores unknown variable names rather than reporting them", () => {
    assert.deepEqual(collectFormulaVariables({ kind: "VAR", name: "NOPE" }), []);
  });

  it("terminates on a corrupted tree", () => {
    const cyclic: Record<string, unknown> = { kind: "BINARY", operator: "ADD" };
    cyclic.left = cyclic;
    cyclic.right = { kind: "VAR", name: "VALUE" };

    assert.deepEqual(collectFormulaVariables(cyclic), ["VALUE"]);
  });
});
