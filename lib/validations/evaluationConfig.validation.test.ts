// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Rule + Passing Criterion
// LAYER  : Validation — Unit Tests
// PURPOSE: Prove the request contract: what a malformed body is rejected FOR,
//          and what a well-formed one is normalised TO.
//
//          These are the "invalid payload" tests. They exercise the layer a
//          hostile or careless client actually reaches first, before any
//          database work is attempted — which is the point of validating there.
//
//          The two update schemas are asserted to apply NO cross-field rules.
//          That looks like a gap and is a contract: a PATCH may carry `config`
//          without `operation`, or `unit` without `metric`, and a schema that
//          guessed would either pass an incoherent merge or reject a coherent
//          one. The service re-checks against merged state, and its own suite
//          proves it.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createEvaluationRuleSchema,
  updateEvaluationRuleSchema,
} from "@/lib/validations/evaluationRule";
import {
  createPassingCriterionSchema,
  updatePassingCriterionSchema,
} from "@/lib/validations/passingCriterion";

/** A minimal valid course-level rule body. */
const VALID_RULE = {
  code: "CAP100",
  name: "Cap at maximum",
  phase: "COURSE_ADJUSTMENT",
  operation: "CAP",
  sequence: 1,
  config: { limit: 100 },
};

/** A minimal valid component minimum. */
const VALID_CRITERION = {
  code: "MIN-THEORY",
  name: "Minimum theory",
  metric: "COMPONENT_SCORE",
  threshold: 21,
  unit: "MARKS",
  failureOutcome: "FAIL",
  componentId: "component_1",
};

/** The dotted field paths a failure reported, for precise assertions. */
function fieldsOf(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (result.error?.issues ?? []).map((issue) => issue.path.join("."));
}

/**
 * A copy of `source` without one key.
 *
 * Used instead of destructuring-to-discard, which leaves an assigned-but-unused
 * binding that this project's ESLint config reports — it carries no
 * argsIgnorePattern, so the conventional underscore prefix does not silence it.
 */
function omit<T extends Record<string, unknown>>(source: T, key: keyof T): Partial<T> {
  const copy: Partial<T> = { ...source };
  delete copy[key];
  return copy;
}

describe("createEvaluationRuleSchema — accepts and normalises", () => {
  it("accepts a well-formed course-level rule", () => {
    assert.equal(createEvaluationRuleSchema.safeParse(VALID_RULE).success, true);
  });

  it("upper-cases the code so one regulation cannot fork on case", () => {
    const parsed = createEvaluationRuleSchema.safeParse({ ...VALID_RULE, code: "cap100" });

    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.code, "CAP100");
  });

  it("strips server-managed keys rather than rejecting them", () => {
    const parsed = createEvaluationRuleSchema.safeParse({
      ...VALID_RULE,
      id: "injected",
      tenantId: "tenant_other",
      schemeId: "scheme_other",
    });

    assert.equal(parsed.success, true);
    assert.equal("id" in (parsed.data ?? {}), false);
    assert.equal("tenantId" in (parsed.data ?? {}), false);
    assert.equal("schemeId" in (parsed.data ?? {}), false);
  });

  it("accepts a well-formed custom formula", () => {
    const parsed = createEvaluationRuleSchema.safeParse({
      ...VALID_RULE,
      operation: "CUSTOM_FORMULA",
      config: {
        expression: {
          kind: "BINARY",
          operator: "MULTIPLY",
          left: { kind: "VAR", name: "VALUE" },
          right: { kind: "CONST", value: 0.5 },
        },
      },
    });

    assert.equal(parsed.success, true);
  });
});

describe("createEvaluationRuleSchema — rejects", () => {
  it("rejects a config that does not match the operation", () => {
    const parsed = createEvaluationRuleSchema.safeParse({
      ...VALID_RULE,
      operation: "MODERATION",
      config: { limit: 100 },
    });

    assert.equal(parsed.success, false);
    assert.ok(fieldsOf(parsed).some((field) => field.startsWith("config")));
  });

  it("rejects a missing config", () => {
    const parsed = createEvaluationRuleSchema.safeParse(omit(VALID_RULE, "config"));

    assert.equal(parsed.success, false);
    assert.ok(fieldsOf(parsed).includes("config"));
  });

  it("rejects a component-scoped phase without a component", () => {
    const parsed = createEvaluationRuleSchema.safeParse({
      ...VALID_RULE,
      phase: "COMPONENT_ADJUSTMENT",
    });

    assert.equal(parsed.success, false);
    assert.ok(fieldsOf(parsed).includes("componentId"));
  });

  it("rejects a course-scoped phase that names a component", () => {
    const parsed = createEvaluationRuleSchema.safeParse({
      ...VALID_RULE,
      componentId: "component_1",
    });

    assert.equal(parsed.success, false);
    assert.ok(fieldsOf(parsed).includes("componentId"));
  });

  it("rejects a formula reading COURSE_TOTAL before the course total exists", () => {
    const parsed = createEvaluationRuleSchema.safeParse({
      ...VALID_RULE,
      phase: "COMPONENT_ADJUSTMENT",
      componentId: "component_1",
      operation: "CUSTOM_FORMULA",
      config: { expression: { kind: "VAR", name: "COURSE_TOTAL" } },
    });

    assert.equal(parsed.success, false);
  });

  it("rejects a formula containing a node kind outside the whitelist", () => {
    const parsed = createEvaluationRuleSchema.safeParse({
      ...VALID_RULE,
      operation: "CUSTOM_FORMULA",
      config: { expression: { kind: "CALL", name: "process" } },
    });

    assert.equal(parsed.success, false);
  });

  it("rejects a formula supplied as a source string", () => {
    const parsed = createEvaluationRuleSchema.safeParse({
      ...VALID_RULE,
      operation: "CUSTOM_FORMULA",
      config: { expression: "value * 2" },
    });

    assert.equal(parsed.success, false);
  });

  it("rejects a scale factor of zero, which would annihilate a component", () => {
    const parsed = createEvaluationRuleSchema.safeParse({
      ...VALID_RULE,
      phase: "COMPONENT_ADJUSTMENT",
      componentId: "component_1",
      operation: "SCALE",
      config: { factor: 0 },
    });

    assert.equal(parsed.success, false);
  });

  it("rejects a code containing characters outside the pattern", () => {
    for (const code of ["-LEADS", "has space", "semi;colon", ""]) {
      assert.equal(
        createEvaluationRuleSchema.safeParse({ ...VALID_RULE, code }).success,
        false,
        `expected rejection for ${JSON.stringify(code)}`
      );
    }
  });

  it("rejects a sequence outside its bounds", () => {
    for (const sequence of [0, -1, 1000, 1.5]) {
      assert.equal(
        createEvaluationRuleSchema.safeParse({ ...VALID_RULE, sequence }).success,
        false,
        `expected rejection for ${sequence}`
      );
    }
  });

  it("rejects a condition with more clauses than permitted", () => {
    const parsed = createEvaluationRuleSchema.safeParse({
      ...VALID_RULE,
      condition: {
        all: Array.from({ length: 9 }, () => ({
          variable: "VALUE",
          comparator: "GTE",
          value: 1,
        })),
      },
    });

    assert.equal(parsed.success, false);
  });

  it("rejects an unknown condition variable", () => {
    const parsed = createEvaluationRuleSchema.safeParse({
      ...VALID_RULE,
      condition: { all: [{ variable: "process.env", comparator: "GTE", value: 1 }] },
    });

    assert.equal(parsed.success, false);
  });
});

describe("updateEvaluationRuleSchema", () => {
  it("accepts a single-field patch", () => {
    assert.equal(updateEvaluationRuleSchema.safeParse({ name: "Renamed" }).success, true);
  });

  it("rejects an empty body, which would advance updatedAt for nothing", () => {
    assert.equal(updateEvaluationRuleSchema.safeParse({}).success, false);
  });

  it("accepts a config without an operation — the service checks the merge", () => {
    // Deliberate: the stored operation is not visible here, so refusing this
    // would reject a perfectly valid PATCH.
    assert.equal(updateEvaluationRuleSchema.safeParse({ config: { limit: 50 } }).success, true);
  });

  it("permits an explicit null componentId, so a rule can be moved to course scope", () => {
    const parsed = updateEvaluationRuleSchema.safeParse({ componentId: null });

    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.componentId, null);
  });
});

describe("createPassingCriterionSchema — accepts and rejects", () => {
  it("accepts a well-formed component minimum", () => {
    assert.equal(createPassingCriterionSchema.safeParse(VALID_CRITERION).success, true);
  });

  it("accepts an attendance eligibility rule", () => {
    const parsed = createPassingCriterionSchema.safeParse({
      code: "ATT75",
      name: "Attendance",
      metric: "ATTENDANCE_PERCENT",
      threshold: 75,
      unit: "PERCENT",
      failureOutcome: "INELIGIBLE",
    });

    assert.equal(parsed.success, true);
  });

  it("rejects a component metric with no component", () => {
    const parsed = createPassingCriterionSchema.safeParse(omit(VALID_CRITERION, "componentId"));

    assert.equal(parsed.success, false);
    assert.ok(fieldsOf(parsed).includes("componentId"));
  });

  it("rejects a non-component metric that names a component", () => {
    const parsed = createPassingCriterionSchema.safeParse({
      ...VALID_CRITERION,
      metric: "ATTENDANCE_PERCENT",
      unit: "PERCENT",
    });

    assert.equal(parsed.success, false);
    assert.ok(fieldsOf(parsed).includes("componentId"));
  });

  it("rejects a unit the metric does not permit", () => {
    const parsed = createPassingCriterionSchema.safeParse({
      ...VALID_CRITERION,
      unit: "CREDITS",
    });

    assert.equal(parsed.success, false);
    assert.ok(fieldsOf(parsed).includes("unit"));
  });

  it("rejects a percentage threshold above 100", () => {
    const parsed = createPassingCriterionSchema.safeParse({
      code: "ATT",
      name: "Attendance",
      metric: "ATTENDANCE_PERCENT",
      threshold: 101,
      unit: "PERCENT",
      failureOutcome: "INELIGIBLE",
    });

    assert.equal(parsed.success, false);
    assert.ok(fieldsOf(parsed).includes("threshold"));
  });

  it("rejects a threshold with more decimal places than the column stores", () => {
    // PostgreSQL would SILENTLY ROUND 21.335 to 21.34 — the figure entered
    // would not be the figure enforced. This is the only place that is visible.
    const parsed = createPassingCriterionSchema.safeParse({
      ...VALID_CRITERION,
      threshold: 21.335,
    });

    assert.equal(parsed.success, false);
    assert.ok(fieldsOf(parsed).includes("threshold"));
  });

  it("accepts a two-decimal threshold", () => {
    assert.equal(
      createPassingCriterionSchema.safeParse({ ...VALID_CRITERION, threshold: 21.33 }).success,
      true
    );
  });

  it("rejects a negative threshold", () => {
    assert.equal(
      createPassingCriterionSchema.safeParse({ ...VALID_CRITERION, threshold: -1 }).success,
      false
    );
  });

  it("rejects an unknown enum member", () => {
    assert.equal(
      createPassingCriterionSchema.safeParse({ ...VALID_CRITERION, metric: "COURSE_TOTAL" })
        .success,
      false,
      "COURSE_TOTAL is deliberately not a metric — GradeBand.isPass owns overall pass"
    );
  });
});

describe("updatePassingCriterionSchema", () => {
  it("accepts a single-field patch", () => {
    assert.equal(updatePassingCriterionSchema.safeParse({ name: "Renamed" }).success, true);
  });

  it("rejects an empty body", () => {
    assert.equal(updatePassingCriterionSchema.safeParse({}).success, false);
  });

  it("accepts a unit without a metric — the service checks the merge", () => {
    assert.equal(updatePassingCriterionSchema.safeParse({ unit: "PERCENT" }).success, true);
  });

  it("still enforces single-field bounds", () => {
    assert.equal(updatePassingCriterionSchema.safeParse({ threshold: -5 }).success, false);
    assert.equal(updatePassingCriterionSchema.safeParse({ threshold: 1.234 }).success, false);
  });
});
