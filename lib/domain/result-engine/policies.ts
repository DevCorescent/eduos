// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Configuration Policies
// LAYER  : Domain (pure)
// PURPOSE: The coherence rules that decide whether a rule or a criterion is
//          internally consistent, as pure functions over plain data.
//
// WHY THIS LAYER EXISTS
//   Every rule here has TWO enforcement points. On create, the Zod schema
//   applies it, because the whole body is present and a field-level 400 is the
//   right answer. On update, only the SERVICE can apply it, because a PATCH may
//   supply `unit` without `metric`, or `config` without `operation`, and the
//   merged value is knowable only after the stored row is read.
//
//   Leaving these rules inside the Zod schemas would therefore mean writing
//   each one twice, in two layers, with no mechanism keeping them in step. Here
//   they are defined once and called from both.
//
// THE RETURN SHAPE
//   ValidationDetail — the same { field, message } pair Zod failures already
//   produce through validationDetails(). A client parses one detail format
//   whether the rejection came from the schema layer or the service layer, and
//   AppError.details accepts the array unchanged.
//
// COMPLEXITY
//   Every function is O(1) in the number of fields it inspects, except the
//   variable-scope check, which is O(n) in formula nodes and bounded by
//   MAX_FORMULA_NODES.
// ============================================================================

import {
  PassingMetric,
  RuleOperation,
  RulePhase,
  ThresholdUnit,
} from "@/app/generated/prisma/enums";
import {
  COMPONENT_SCOPED_PHASES,
  COURSE_SCOPED_VARIABLES,
  EVALUATION_RULE_MESSAGE,
  FORMULA_VARIABLE,
  type FormulaVariable,
} from "@/lib/constants/evaluationRule";
import {
  COMPONENT_SCOPED_METRICS,
  METRIC_UNITS,
  PASSING_CRITERION_MESSAGE,
  PERCENT_THRESHOLD_MAX,
} from "@/lib/constants/passingCriterion";
import { collectFormulaVariables } from "@/lib/domain/result-engine/formula";
import type { ValidationDetail } from "@/lib/utils/validation-error";

/** Every whitelisted variable name, as a Set for O(1) membership. */
const VARIABLE_NAMES = new Set<string>(Object.values(FORMULA_VARIABLE));

/** Variables that do not exist before every component has rolled up. */
const COURSE_ONLY = new Set<string>(COURSE_SCOPED_VARIABLES);

/**
 * A component-scoped phase requires a component; a course-scoped one forbids
 * it.
 *
 * SESSION_ADJUSTMENT and COMPONENT_ADJUSTMENT transform one component's
 * figures, so a rule at either without a componentId has nothing to act on.
 * COURSE_ADJUSTMENT transforms the course total, so naming a component there
 * implies a constraint the engine has no way to honour.
 */
export function checkRuleScope(
  phase: RulePhase,
  componentId: string | null | undefined
): ValidationDetail[] {
  const requiresComponent = COMPONENT_SCOPED_PHASES.includes(phase);
  const hasComponent = componentId !== null && componentId !== undefined;

  if (requiresComponent === hasComponent) {
    return [];
  }

  return [
    {
      field: "componentId",
      message: requiresComponent
        ? EVALUATION_RULE_MESSAGE.COMPONENT_REQUIRED
        : EVALUATION_RULE_MESSAGE.COMPONENT_FORBIDDEN,
    },
  ];
}

/**
 * Read the variables named by a rule's condition.
 *
 * Defensive throughout: `condition` is a JSON column, so a value written before
 * a rule tightened may not match the current shape, and a malformed one must
 * yield no variables rather than throw inside a grade computation.
 */
function collectConditionVariables(condition: unknown): FormulaVariable[] {
  if (typeof condition !== "object" || condition === null || Array.isArray(condition)) {
    return [];
  }

  const clauses = (condition as { all?: unknown }).all;

  if (!Array.isArray(clauses)) {
    return [];
  }

  const found = new Set<FormulaVariable>();

  for (const clause of clauses) {
    if (typeof clause !== "object" || clause === null) {
      continue;
    }

    const name = (clause as { variable?: unknown }).variable;

    if (typeof name === "string" && VARIABLE_NAMES.has(name)) {
      found.add(name as FormulaVariable);
    }
  }

  return [...found];
}

/**
 * Every variable a rule reads, from its formula and from its condition.
 *
 * Exported because the service reports it and a future engine binds it: what a
 * rule reads determines what the engine must have computed before running it.
 *
 * COMPLEXITY : O(n + c) — formula nodes plus condition clauses, both bounded by
 *              their configured maxima, so constant per rule in practice.
 */
export function collectRuleVariables(
  operation: RuleOperation,
  config: unknown,
  condition: unknown
): FormulaVariable[] {
  const found = new Set<FormulaVariable>(collectConditionVariables(condition));

  if (operation === RuleOperation.CUSTOM_FORMULA && typeof config === "object" && config !== null) {
    for (const variable of collectFormulaVariables((config as { expression?: unknown }).expression)) {
      found.add(variable);
    }
  }

  return [...found];
}

/**
 * A rule may not read a value that does not exist yet at its phase.
 *
 * COURSE_TOTAL is only defined once every component has rolled up, so a formula
 * or condition reading it at SESSION_ADJUSTMENT or COMPONENT_ADJUSTMENT would
 * bind an undefined value at computation time — producing a wrong grade rather
 * than an error. Caught here, at configuration time, where it is cheap.
 */
export function checkRuleVariableScope(
  phase: RulePhase,
  operation: RuleOperation,
  config: unknown,
  condition: unknown
): ValidationDetail[] {
  if (phase === RulePhase.COURSE_ADJUSTMENT) {
    return [];
  }

  const offending = collectRuleVariables(operation, config, condition).filter((variable) =>
    COURSE_ONLY.has(variable)
  );

  return offending.map((variable) => ({
    field: "config",
    message: `${EVALUATION_RULE_MESSAGE.COURSE_VARIABLE_TOO_EARLY} (${variable})`,
  }));
}

/**
 * The fields a criterion's coherence depends on.
 *
 * `componentId` is OPTIONAL rather than `string | null` so a validated create
 * body — where an omitted componentId is simply absent — satisfies this
 * directly, while the service can pass an explicit null for a stored row. Both
 * absence and null mean the same thing to these rules: no component.
 */
export interface CriterionCoherenceInput {
  metric: PassingMetric;
  unit: ThresholdUnit;
  threshold: number;
  componentId?: string | null;
}

/**
 * The three ways a criterion can be internally incoherent.
 *
 * All three are reported together rather than short-circuiting, so an
 * administrator repairs a criterion in one pass instead of discovering the next
 * problem on each save.
 */
export function checkCriterionCoherence(input: CriterionCoherenceInput): ValidationDetail[] {
  const violations: ValidationDetail[] = [];

  const requiresComponent = COMPONENT_SCOPED_METRICS.includes(input.metric);
  const hasComponent = input.componentId !== null && input.componentId !== undefined;

  if (requiresComponent !== hasComponent) {
    violations.push({
      field: "componentId",
      message: requiresComponent
        ? PASSING_CRITERION_MESSAGE.COMPONENT_REQUIRED
        : PASSING_CRITERION_MESSAGE.COMPONENT_FORBIDDEN,
    });
  }

  if (!METRIC_UNITS[input.metric].includes(input.unit)) {
    violations.push({
      field: "unit",
      message: PASSING_CRITERION_MESSAGE.UNIT_NOT_PERMITTED,
    });
  }

  // The column permits 9999.99, but a proportion above 100 is not a threshold
  // any student could ever meet — it would silently fail every one of them.
  if (input.unit === ThresholdUnit.PERCENT && input.threshold > PERCENT_THRESHOLD_MAX) {
    violations.push({
      field: "threshold",
      message: PASSING_CRITERION_MESSAGE.PERCENT_OUT_OF_RANGE,
    });
  }

  return violations;
}
