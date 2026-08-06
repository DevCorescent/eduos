// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Rollup
// LAYER  : Domain (pure)
// PURPOSE: Apply the rule pipeline, and fold the component tree into a course
//          total.
//
// THE PIPELINE, AND WHY ITS ORDER IS NOT NEGOTIABLE
//
//   raw sittings
//     -> [SESSION_ADJUSTMENT rules]      per sitting, before they combine
//     -> aggregation                     owned by EvaluationComponent (C3)
//     -> [COMPONENT_ADJUSTMENT rules]    on the component's own figure
//     -> weighted rollup up the tree     owned by EvaluationComponent (C3)
//     -> course total
//     -> [COURSE_ADJUSTMENT rules]       on the whole
//
//   The three rule phases run in the order C4 declared them, and this module
//   never re-sorts. RulePhase is DECLARED in pipeline order and PostgreSQL
//   orders an enum by declaration, so the repository's ordering already IS the
//   execution order — re-deriving it here would be a second opinion about
//   something the schema already settles.
//
// IMMUTABILITY
//   Nothing here mutates its inputs. Every stage takes readonly definitions and
//   returns new values, so a stage can be re-run on the same data and produce
//   the same answer. That is the reproducibility requirement expressed as code
//   rather than as a promise.
//
// COMPLEXITY
//   Rules are indexed ONCE into a Map keyed by component and phase — O(r) — so
//   no component ever scans the rule list. The tree is indexed once and walked
//   ONCE, deepest level first, so every child is finished before its parent
//   needs it. Total: O(c + r + m) over components, rules and marks. Zero
//   queries: this module never touches a database.
// ============================================================================

import {
  DEFERRED_OPERATIONS,
  MARK_SCALE,
  RESULT_ENGINE_MESSAGE,
} from "@/lib/constants/resultEngine";
import {
  divideRounded,
  weightedContribution,
} from "@/lib/domain/result-engine/decimal";
import { ComponentRollup, RuleOperation, RulePhase } from "@/lib/domain/result-engine/enums";
import { evaluateCondition, evaluateFormula } from "@/lib/domain/result-engine/formulaEvaluator";
import type {
  ComponentDefinition,
  EngineOutcome,
  EvaluationContext,
  RuleDefinition,
  Scaled,
} from "@/lib/domain/result-engine/types";

/** Machine-readable reasons the pipeline stopped. */
export const ROLLUP_ERROR = {
  UNKNOWN_OPERATION: "UNKNOWN_OPERATION",
  MALFORMED_CONFIG: "MALFORMED_CONFIG",
  MISSING_ROLLUP: "MISSING_ROLLUP",
  ORPHANED_COMPONENT: "ORPHANED_COMPONENT",
  CYCLIC_TREE: "CYCLIC_TREE",
  OVERFLOW: "OVERFLOW",
  NOT_FINITE: "NOT_FINITE",
} as const;

export type RollupErrorCode = (typeof ROLLUP_ERROR)[keyof typeof ROLLUP_ERROR];

/** The key used for course-level rules, which name no component. */
export const COURSE_SCOPE = "__COURSE__";

/** The scale a course total sits on: a percentage out of 100. */
export const COURSE_MAX_SCALED: Scaled = 100 * 10 ** MARK_SCALE;

/** Operations the per-student pass recognises but cannot evaluate alone. */
const DEFERRED = new Set<string>(DEFERRED_OPERATIONS);

/** Rules grouped by the component they target and the phase they run at. */
export type RuleIndex = ReadonlyMap<string, ReadonlyMap<RulePhase, readonly RuleDefinition[]>>;

/** An indexed view of the component tree, built once and reused. */
export interface ComponentIndex {
  readonly byId: ReadonlyMap<string, ComponentDefinition>;
  readonly childrenOf: ReadonlyMap<string, readonly ComponentDefinition[]>;
  readonly roots: readonly ComponentDefinition[];
  /** Component ids ordered so every child precedes its parent. */
  readonly evaluationOrder: readonly string[];
}

/** What applying a stage's rules produced. */
export interface RuleApplication {
  readonly valueScaled: Scaled;
  readonly appliedCodes: readonly string[];
  /** Cohort-scoped rules recognised and left for a second pass. */
  readonly deferredCodes: readonly string[];
}

function failure(code: RollupErrorCode, message: string, subject?: string): EngineOutcome<never> {
  return { ok: false, failure: { code, message, subject } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a numeric parameter from a rule's JSON config, defensively. */
function readNumber(config: unknown, key: string): number | null {
  if (!isPlainObject(config)) {
    return null;
  }

  const value = config[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Index every rule by component and phase, in ONE pass.
 *
 * The order rules arrive in is preserved verbatim within each bucket. That is
 * the whole contract: the repository sorted them by (phase, sequence, code) and
 * re-sorting here would replace a decision the schema already made.
 *
 * COMPLEXITY : O(r) time and space.
 */
export function indexRules(rules: readonly RuleDefinition[]): RuleIndex {
  const index = new Map<string, Map<RulePhase, RuleDefinition[]>>();

  for (const rule of rules) {
    const scope = rule.componentId ?? COURSE_SCOPE;

    let byPhase = index.get(scope);

    if (byPhase === undefined) {
      byPhase = new Map<RulePhase, RuleDefinition[]>();
      index.set(scope, byPhase);
    }

    const bucket = byPhase.get(rule.phase);

    if (bucket === undefined) {
      byPhase.set(rule.phase, [rule]);
    } else {
      bucket.push(rule);
    }
  }

  return index;
}

/** The rules for one scope and phase, or an empty list. */
export function rulesFor(
  index: RuleIndex,
  scope: string,
  phase: RulePhase
): readonly RuleDefinition[] {
  return index.get(scope)?.get(phase) ?? [];
}

/**
 * Index the component tree, and compute the order it must be evaluated in.
 *
 * Children must be finished before their parent can roll them up, so the order
 * is deepest level first. Depths are assigned by a breadth-first walk from the
 * roots, then bucketed — O(c) rather than the O(c log c) a sort would cost, and
 * more importantly it is STABLE: components at the same depth keep their
 * declared order, so two runs agree.
 *
 * A component unreachable from any root is left out of the order and reported
 * by evaluateTree, which is how a cycle or an orphan surfaces.
 */
export function indexComponents(
  definitions: readonly ComponentDefinition[]
): ComponentIndex {
  const byId = new Map<string, ComponentDefinition>();
  const childrenOf = new Map<string, ComponentDefinition[]>();
  const roots: ComponentDefinition[] = [];

  for (const definition of definitions) {
    byId.set(definition.id, definition);
  }

  for (const definition of definitions) {
    const parentId = definition.parentComponentId;

    if (parentId === null) {
      roots.push(definition);
      continue;
    }

    if (!byId.has(parentId)) {
      // Orphaned: neither a root nor a child. Reported by evaluateTree.
      continue;
    }

    const bucket = childrenOf.get(parentId);

    if (bucket === undefined) {
      childrenOf.set(parentId, [definition]);
    } else {
      bucket.push(definition);
    }
  }

  const levels: string[][] = [];
  const seen = new Set<string>();
  let frontier = roots;
  let depth = 0;

  while (frontier.length > 0) {
    const ids: string[] = [];
    const next: ComponentDefinition[] = [];

    for (const definition of frontier) {
      // Guards a cyclic graph: a node already placed is never expanded again.
      if (seen.has(definition.id)) {
        continue;
      }

      seen.add(definition.id);
      ids.push(definition.id);
      next.push(...(childrenOf.get(definition.id) ?? []));
    }

    if (ids.length > 0) {
      levels[depth] = ids;
      depth += 1;
    }

    frontier = next;
  }

  // Deepest first, so a parent is always reached after its children.
  const evaluationOrder: string[] = [];

  for (let level = levels.length - 1; level >= 0; level -= 1) {
    evaluationOrder.push(...levels[level]);
  }

  return { byId, childrenOf, roots, evaluationOrder };
}

/** Reject a value that has left exact-integer territory. */
function guard(value: number, subject: string): EngineOutcome<Scaled> {
  if (!Number.isFinite(value)) {
    return failure(ROLLUP_ERROR.NOT_FINITE, "A rule produced a non-finite value", subject);
  }

  if (!Number.isSafeInteger(value)) {
    return failure(
      ROLLUP_ERROR.OVERFLOW,
      "A rule produced a value beyond exact integer range",
      subject
    );
  }

  return { ok: true, value };
}

/**
 * Apply one rule to one value.
 *
 * Every operation is a pure numeric transform. None reads a threshold except
 * GRACE, and GRACE does not own the one it reads — the engine supplies the pass
 * mark from the lowest passing grade band, so the rule stays arithmetic.
 */
function applyOperation(
  rule: RuleDefinition,
  valueScaled: Scaled,
  maxScaled: Scaled,
  context: EvaluationContext
): EngineOutcome<Scaled> {
  const rounding = context.rounding;

  switch (rule.operation) {
    case RuleOperation.ADD_CONSTANT: {
      const amount = readNumber(rule.config, "amount");

      if (amount === null) {
        return failure(ROLLUP_ERROR.MALFORMED_CONFIG, "ADD_CONSTANT needs an amount", rule.code);
      }

      return guard(valueScaled + Math.round(amount * 10 ** MARK_SCALE), rule.code);
    }

    case RuleOperation.ADD_PERCENTAGE: {
      const percent = readNumber(rule.config, "percent");

      if (percent === null) {
        return failure(
          ROLLUP_ERROR.MALFORMED_CONFIG,
          "ADD_PERCENTAGE needs a percent",
          rule.code
        );
      }

      const uplift = divideRounded(
        valueScaled * Math.round(percent * 10 ** MARK_SCALE),
        100 * 10 ** MARK_SCALE,
        rounding
      );

      return guard(valueScaled + uplift, rule.code);
    }

    case RuleOperation.SCALE: {
      const factor = readNumber(rule.config, "factor");

      if (factor === null) {
        return failure(ROLLUP_ERROR.MALFORMED_CONFIG, "SCALE needs a factor", rule.code);
      }

      return guard(
        divideRounded(
          valueScaled * Math.round(factor * 10 ** MARK_SCALE),
          10 ** MARK_SCALE,
          rounding
        ),
        rule.code
      );
    }

    case RuleOperation.CAP: {
      const limit = readNumber(rule.config, "limit");

      if (limit === null) {
        return failure(ROLLUP_ERROR.MALFORMED_CONFIG, "CAP needs a limit", rule.code);
      }

      const ceiling = Math.round(limit * 10 ** MARK_SCALE);

      return { ok: true, value: valueScaled > ceiling ? ceiling : valueScaled };
    }

    case RuleOperation.FLOOR: {
      const limit = readNumber(rule.config, "limit");

      if (limit === null) {
        return failure(ROLLUP_ERROR.MALFORMED_CONFIG, "FLOOR needs a limit", rule.code);
      }

      const bottom = Math.round(limit * 10 ** MARK_SCALE);

      return { ok: true, value: valueScaled < bottom ? bottom : valueScaled };
    }

    case RuleOperation.GRACE: {
      const maxAward = readNumber(rule.config, "maxAward");

      if (maxAward === null) {
        return failure(ROLLUP_ERROR.MALFORMED_CONFIG, "GRACE needs a maxAward", rule.code);
      }

      const passMark = context.passMarkScaled;

      if (passMark === null || valueScaled >= passMark) {
        // Nothing to lift toward, or already there. Grace is not a bonus.
        return { ok: true, value: valueScaled };
      }

      const shortfall = passMark - valueScaled;
      const award = Math.round(maxAward * 10 ** MARK_SCALE);

      // Awarded only if it actually reaches the threshold. A partial lift would
      // spend the allowance and still fail the student.
      return { ok: true, value: shortfall <= award ? passMark : valueScaled };
    }

    case RuleOperation.CUSTOM_FORMULA: {
      const expression = isPlainObject(rule.config) ? rule.config.expression : undefined;

      const evaluated = evaluateFormula(expression, {
        rounding,
        bindings: { ...context.bindings, VALUE: valueScaled, MAX_MARKS: maxScaled },
      });

      if (!evaluated.ok) {
        return { ok: false, failure: { ...evaluated.failure, subject: rule.code } };
      }

      return guard(evaluated.value, rule.code);
    }

    default:
      return failure(
        ROLLUP_ERROR.UNKNOWN_OPERATION,
        `Unsupported operation: ${String(rule.operation)}`,
        rule.code
      );
  }
}

/**
 * Run an ordered list of rules over one value.
 *
 * Each rule consumes the previous one's output — that is what makes "add grace,
 * then cap at the maximum" two rows rather than one combined operator.
 *
 * A rule whose condition does not hold is skipped silently; a cohort-scoped
 * operation is recorded as deferred rather than guessed at, because applying a
 * curve from one student's marks would be meaningless.
 *
 * COMPLEXITY : O(k) in the rules for this stage, each O(1) except a formula,
 *              which is bounded by its own node budget.
 */
export function applyRules(
  rules: readonly RuleDefinition[],
  valueScaled: Scaled,
  maxScaled: Scaled,
  context: EvaluationContext
): EngineOutcome<RuleApplication> {
  let current = valueScaled;
  const appliedCodes: string[] = [];
  const deferredCodes: string[] = [];

  for (const rule of rules) {
    if (DEFERRED.has(rule.operation)) {
      deferredCodes.push(rule.code);
      continue;
    }

    const bindings = { ...context.bindings, VALUE: current, MAX_MARKS: maxScaled };
    const applies = evaluateCondition(rule.condition, { rounding: context.rounding, bindings });

    if (!applies.ok) {
      return { ok: false, failure: { ...applies.failure, subject: rule.code } };
    }

    if (!applies.value) {
      continue;
    }

    const applied = applyOperation(rule, current, maxScaled, { ...context, bindings });

    if (!applied.ok) {
      return applied;
    }

    current = applied.value;
    appliedCodes.push(rule.code);
  }

  return { ok: true, value: { valueScaled: current, appliedCodes, deferredCodes } };
}

/**
 * Combine a branch's children into its own figure.
 *
 * WEIGHTED_SUM is the ordinary case and the only one whose siblings must total
 * 100 — each child contributes its weightage percent of the parent's scale.
 * SUM adds the children's raw values; AVERAGE takes their unweighted mean.
 *
 * COMPLEXITY : O(k) in the children.
 */
export function rollupChildren(
  parent: ComponentDefinition,
  childValues: readonly { readonly definition: ComponentDefinition; readonly valueScaled: Scaled }[],
  context: EvaluationContext
): EngineOutcome<Scaled> {
  if (parent.rollup === null) {
    return failure(
      ROLLUP_ERROR.MISSING_ROLLUP,
      "A component with children declares no rollup",
      parent.code
    );
  }

  if (childValues.length === 0) {
    return { ok: true, value: 0 };
  }

  switch (parent.rollup) {
    case ComponentRollup.WEIGHTED_SUM: {
      let total = 0;

      for (const child of childValues) {
        // The child's value sits on its own scale; its weightage says what
        // share of the PARENT's scale that is worth.
        total += weightedContribution(
          child.valueScaled,
          child.definition.maxMarksScaled,
          divideRounded(
            child.definition.weightageScaled * parent.maxMarksScaled,
            100 * 10 ** MARK_SCALE,
            context.rounding
          ),
          context.rounding
        );
      }

      return guard(total, parent.code);
    }

    case ComponentRollup.SUM: {
      let total = 0;

      for (const child of childValues) {
        total += child.valueScaled;
      }

      return guard(total, parent.code);
    }

    default: {
      // AVERAGE: the unweighted mean of the children's proportions, expressed
      // on the parent's scale.
      let total = 0;

      for (const child of childValues) {
        total += weightedContribution(
          child.valueScaled,
          child.definition.maxMarksScaled,
          parent.maxMarksScaled,
          context.rounding
        );
      }

      return guard(divideRounded(total, childValues.length, context.rounding), parent.code);
    }
  }
}

/**
 * Combine the root components into the course total, as a percentage.
 *
 * Root weightages total 100 by the tree rule C3 enforces at activation, so the
 * result is already a percentage — no further normalisation, and no second
 * definition of what a course total means.
 *
 * COMPLEXITY : O(k) in the roots.
 */
export function rollupRoots(
  roots: readonly { readonly definition: ComponentDefinition; readonly valueScaled: Scaled }[],
  context: EvaluationContext
): EngineOutcome<Scaled> {
  let total = 0;

  for (const root of roots) {
    total += weightedContribution(
      root.valueScaled,
      root.definition.maxMarksScaled,
      root.definition.weightageScaled,
      context.rounding
    );
  }

  return guard(total, RESULT_ENGINE_MESSAGE.UNKNOWN_COMPONENT);
}

/** True when a component has no children in this tree. */
export function isLeaf(index: ComponentIndex, componentId: string): boolean {
  return (index.childrenOf.get(componentId) ?? []).length === 0;
}

/** Every component the evaluation order could not reach — orphans and cycles. */
export function unreachableComponents(
  definitions: readonly ComponentDefinition[],
  index: ComponentIndex
): readonly string[] {
  const reached = new Set(index.evaluationOrder);

  return definitions
    .filter((definition) => !reached.has(definition.id))
    .map((definition) => definition.code);
}
