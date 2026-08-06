// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Component
// LAYER  : Domain — Unit Tests
// PURPOSE: Exhaustively exercise the tree rules on literal input.
//
//          These are the highest-value tests in the module. The domain layer is
//          pure — no database, no framework, no Prisma type — so every rule can
//          be driven directly with the exact shape that triggers it, including
//          the shapes a database constraint would normally prevent from ever
//          reaching production. A cycle cannot be created through the API, but
//          the validator must still diagnose one rather than hang.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { COMPONENT_TREE_VIOLATION, MAX_TREE_DEPTH } from "@/lib/constants/evaluationComponent";
import {
  collectSubtreeIds,
  indexComponentTree,
  isLeafNode,
  parseHundredths,
  validateComponentTree,
  wouldCreateCycle,
  type ComponentTreeInput,
} from "@/lib/domain/evaluationComponentTree";

/** A leaf carrying an explicit weight. */
function leaf(
  id: string,
  weightage: string,
  overrides: Partial<ComponentTreeInput> = {}
): ComponentTreeInput {
  return {
    id,
    parentComponentId: null,
    code: id.toUpperCase(),
    sequence: 1,
    weightage,
    maxMarks: "100.00",
    aggregation: "SUM",
    rollup: null,
    sourceType: "MANUAL_ENTRY",
    ruleConfig: null,
    ...overrides,
  };
}

/** A branch that weights its children. */
function branch(
  id: string,
  weightage: string,
  overrides: Partial<ComponentTreeInput> = {}
): ComponentTreeInput {
  return {
    ...leaf(id, weightage),
    aggregation: null,
    rollup: "WEIGHTED_SUM",
    sourceType: "COMPUTED",
    ...overrides,
  };
}

function codesOf(violations: { code: string }[]): string[] {
  return violations.map((violation) => violation.code);
}

describe("parseHundredths", () => {
  it("parses whole numbers, one place and two places exactly", () => {
    assert.equal(parseHundredths("30"), 3000);
    assert.equal(parseHundredths("30.5"), 3050);
    assert.equal(parseHundredths("33.34"), 3334);
    assert.equal(parseHundredths("0"), 0);
    assert.equal(parseHundredths("0.07"), 7);
  });

  it("handles a negative value", () => {
    assert.equal(parseHundredths("-12.50"), -1250);
  });

  it("sums a real float-hazard weight set to exactly 100.00", () => {
    // 28.10 + 35.95 + 35.95 is exactly 100 in decimal but 100.00000000000001
    // in IEEE 754. A naive float comparison rejects this perfectly legal
    // regulation; integer hundredths accept it. This triple was found by
    // exhaustive search over two-decimal triples, so it is a genuine failure
    // case rather than an illustrative one.
    const naive = 28.1 + 35.95 + 35.95;
    assert.notEqual(naive, 100, "guard: this triple must actually be a float hazard");

    const exact =
      parseHundredths("28.10") + parseHundredths("35.95") + parseHundredths("35.95");
    assert.equal(exact, 10_000);
  });
});

describe("indexComponentTree", () => {
  it("separates roots from children and assigns depths", () => {
    const components = [
      branch("internal", "30.00"),
      leaf("st1", "100.00", { parentComponentId: "internal" }),
      leaf("theory", "70.00", { sequence: 2 }),
    ];

    const index = indexComponentTree(components);

    assert.equal(index.roots.length, 2);
    assert.equal(index.depthOf.get("internal"), 1);
    assert.equal(index.depthOf.get("st1"), 2);
    assert.equal(isLeafNode(index, "internal"), false);
    assert.equal(isLeafNode(index, "st1"), true);
  });

  it("terminates on a cycle instead of hanging, leaving cycled nodes undepthed", () => {
    const components = [
      leaf("a", "100.00", { parentComponentId: "b" }),
      leaf("b", "100.00", { parentComponentId: "a" }),
    ];

    const index = indexComponentTree(components);

    assert.equal(index.roots.length, 0);
    assert.equal(index.depthOf.size, 0);
  });
});

describe("validateComponentTree", () => {
  it("accepts a well-formed two-level tree", () => {
    const components = [
      branch("internal", "30.00"),
      leaf("st1", "50.00", { parentComponentId: "internal" }),
      leaf("st2", "50.00", { parentComponentId: "internal", sequence: 2 }),
      leaf("theory", "70.00", { sequence: 2 }),
    ];

    assert.deepEqual(validateComponentTree(components), []);
  });

  it("rejects an empty tree", () => {
    assert.deepEqual(codesOf(validateComponentTree([])), [COMPONENT_TREE_VIOLATION.EMPTY_TREE]);
  });

  it("rejects roots that do not total 100", () => {
    const violations = validateComponentTree([leaf("theory", "70.00")]);

    assert.ok(codesOf(violations).includes(COMPONENT_TREE_VIOLATION.WEIGHTAGE_TOTAL));
  });

  it("reports the actual total in the message", () => {
    const violations = validateComponentTree([leaf("theory", "70.00")]);
    const total = violations.find(
      (violation) => violation.code === COMPONENT_TREE_VIOLATION.WEIGHTAGE_TOTAL
    );

    assert.ok(total?.message.includes("70.00"));
  });

  it("accepts thirds that total 100 exactly", () => {
    const components = [
      leaf("a", "33.33"),
      leaf("b", "33.33", { sequence: 2 }),
      leaf("c", "33.34", { sequence: 3 }),
    ];

    assert.deepEqual(validateComponentTree(components), []);
  });

  it("accepts a weight set that naive float summation would reject", () => {
    // The payoff of integer arithmetic: these three total 100.00000000000001
    // as floats, so a float comparison would refuse to activate a regulation
    // that is entirely correct.
    const components = [
      leaf("a", "28.10"),
      leaf("b", "35.95", { sequence: 2 }),
      leaf("c", "35.95", { sequence: 3 }),
    ];

    assert.deepEqual(validateComponentTree(components), []);
  });

  it("does not require children of a SUM branch to total 100", () => {
    const components = [
      branch("internal", "100.00", { rollup: "SUM" }),
      leaf("st1", "0.00", { parentComponentId: "internal" }),
      leaf("st2", "0.00", { parentComponentId: "internal", sequence: 2 }),
    ];

    assert.deepEqual(validateComponentTree(components), []);
  });

  it("requires a leaf to declare an aggregation", () => {
    const violations = validateComponentTree([leaf("theory", "100.00", { aggregation: null })]);

    assert.ok(codesOf(violations).includes(COMPONENT_TREE_VIOLATION.LEAF_MISSING_AGGREGATION));
  });

  it("rejects a leaf that declares a rollup", () => {
    const violations = validateComponentTree([
      leaf("theory", "100.00", { rollup: "WEIGHTED_SUM" }),
    ]);

    assert.ok(codesOf(violations).includes(COMPONENT_TREE_VIOLATION.LEAF_HAS_ROLLUP));
  });

  it("requires a branch to declare a rollup and refuse an aggregation", () => {
    const components = [
      branch("internal", "100.00", { rollup: null, aggregation: "SUM" }),
      leaf("st1", "100.00", { parentComponentId: "internal" }),
    ];

    const codes = codesOf(validateComponentTree(components));

    assert.ok(codes.includes(COMPONENT_TREE_VIOLATION.BRANCH_MISSING_ROLLUP));
    assert.ok(codes.includes(COMPONENT_TREE_VIOLATION.BRANCH_HAS_AGGREGATION));
  });

  it("rejects a branch that claims marks are entered against it", () => {
    const components = [
      branch("internal", "100.00", { sourceType: "MANUAL_ENTRY" }),
      leaf("st1", "100.00", { parentComponentId: "internal" }),
    ];

    assert.ok(
      codesOf(validateComponentTree(components)).includes(
        COMPONENT_TREE_VIOLATION.BRANCH_HAS_MARK_SOURCE
      )
    );
  });

  it("requires ruleConfig.count for a count-driven aggregation", () => {
    const violations = validateComponentTree([
      leaf("st", "100.00", { aggregation: "BEST_N", ruleConfig: null }),
    ]);

    assert.ok(codesOf(violations).includes(COMPONENT_TREE_VIOLATION.RULE_CONFIG_MISSING_COUNT));
  });

  it("accepts a count-driven aggregation once count is supplied", () => {
    const violations = validateComponentTree([
      leaf("st", "100.00", { aggregation: "BEST_N", ruleConfig: { count: 2 } }),
    ]);

    assert.deepEqual(violations, []);
  });

  it("requires attendance bands for an attendance-derived component", () => {
    const violations = validateComponentTree([
      leaf("att", "100.00", { sourceType: "ATTENDANCE_DERIVED", ruleConfig: {} }),
    ]);

    assert.ok(codesOf(violations).includes(COMPONENT_TREE_VIOLATION.RULE_CONFIG_MISSING_BANDS));
  });

  it("accepts an attendance-derived component with bands", () => {
    const violations = validateComponentTree([
      leaf("att", "100.00", {
        sourceType: "ATTENDANCE_DERIVED",
        ruleConfig: { attendanceBands: [{ minPercent: 75, marks: 5 }] },
      }),
    ]);

    assert.deepEqual(violations, []);
  });

  it("treats a malformed ruleConfig as missing rather than throwing", () => {
    const violations = validateComponentTree([
      leaf("st", "100.00", { aggregation: "BEST_N", ruleConfig: "not-an-object" }),
    ]);

    assert.ok(codesOf(violations).includes(COMPONENT_TREE_VIOLATION.RULE_CONFIG_MISSING_COUNT));
  });

  it("diagnoses a cycle instead of hanging", () => {
    const components = [
      leaf("a", "100.00", { parentComponentId: "b" }),
      leaf("b", "100.00", { parentComponentId: "a" }),
    ];

    const codes = codesOf(validateComponentTree(components));

    assert.equal(codes.filter((code) => code === COMPONENT_TREE_VIOLATION.CYCLE).length, 2);
  });

  it("reports a node whose parent is not in the scheme", () => {
    const violations = validateComponentTree([
      leaf("orphan", "100.00", { parentComponentId: "missing" }),
    ]);

    assert.ok(codesOf(violations).includes(COMPONENT_TREE_VIOLATION.ORPHANED_NODE));
  });

  it("reports two top-level components sharing a position", () => {
    const components = [
      leaf("a", "50.00", { sequence: 1 }),
      leaf("b", "50.00", { sequence: 1 }),
    ];

    assert.ok(
      codesOf(validateComponentTree(components)).includes(
        COMPONENT_TREE_VIOLATION.DUPLICATE_ROOT_SEQUENCE
      )
    );
  });

  it("rejects nesting deeper than the permitted limit", () => {
    const components: ComponentTreeInput[] = [branch("n1", "100.00")];

    for (let level = 2; level <= MAX_TREE_DEPTH + 1; level += 1) {
      const isDeepest = level === MAX_TREE_DEPTH + 1;
      const node = isDeepest
        ? leaf(`n${level}`, "100.00", { parentComponentId: `n${level - 1}` })
        : branch(`n${level}`, "100.00", { parentComponentId: `n${level - 1}` });

      components.push(node);
    }

    assert.ok(
      codesOf(validateComponentTree(components)).includes(
        COMPONENT_TREE_VIOLATION.MAX_DEPTH_EXCEEDED
      )
    );
  });
});

describe("collectSubtreeIds", () => {
  it("returns the node and every descendant", () => {
    const components = [
      branch("internal", "30.00"),
      branch("tests", "100.00", { parentComponentId: "internal" }),
      leaf("st1", "50.00", { parentComponentId: "tests" }),
      leaf("st2", "50.00", { parentComponentId: "tests", sequence: 2 }),
      leaf("theory", "70.00", { sequence: 2 }),
    ];

    const collected = collectSubtreeIds(components, "internal").sort();

    assert.deepEqual(collected, ["internal", "st1", "st2", "tests"]);
  });

  it("returns just the node for a leaf", () => {
    assert.deepEqual(collectSubtreeIds([leaf("theory", "100.00")], "theory"), ["theory"]);
  });

  it("terminates on a corrupted tree", () => {
    const components = [
      leaf("a", "100.00", { parentComponentId: "b" }),
      leaf("b", "100.00", { parentComponentId: "a" }),
    ];

    assert.deepEqual(collectSubtreeIds(components, "a").sort(), ["a", "b"]);
  });
});

describe("wouldCreateCycle", () => {
  const components = [
    branch("internal", "100.00"),
    branch("tests", "100.00", { parentComponentId: "internal" }),
    leaf("st1", "100.00", { parentComponentId: "tests" }),
  ];

  it("detects moving a node beneath its own descendant", () => {
    assert.equal(wouldCreateCycle(components, "internal", "st1"), true);
  });

  it("detects a node made its own parent", () => {
    assert.equal(wouldCreateCycle(components, "internal", "internal"), true);
  });

  it("permits a legitimate move", () => {
    assert.equal(wouldCreateCycle(components, "st1", "internal"), false);
  });

  it("terminates when the stored tree is already corrupted", () => {
    const corrupted = [
      leaf("a", "100.00", { parentComponentId: "b" }),
      leaf("b", "100.00", { parentComponentId: "a" }),
    ];

    assert.equal(wouldCreateCycle(corrupted, "c", "a"), false);
  });
});
