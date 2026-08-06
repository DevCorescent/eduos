// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Formula Evaluator
// LAYER  : Domain (pure)
// PURPOSE: Evaluate a validated formula AST against bound variables, in exact
//          integer arithmetic.
//
// THE SECURITY POSTURE, RESTATED
//   There is no parser here, no eval, no Function, no template evaluation and
//   no dynamic property access. A formula is a typed tree over a closed
//   whitelist of three node kinds, six operators and four variables — the same
//   whitelist C4's validator enforces on write. Anything outside it is refused
//   rather than filtered, because it cannot be expressed.
//
// WHY IT DOES NOT TRUST THE VALIDATOR
//   C4 bounds an expression when it is STORED. This walks whatever the database
//   hands back, which may predate a tightening, may have been written by a
//   future importer, or may simply be malformed. So it re-checks node kinds,
//   operators, variables, depth and node count itself. A validator that ran
//   once is a claim about the past; this is a guarantee about now.
//
// TRAVERSAL
//   Explicit-stack post-order, never recursion. A recursive evaluator over a
//   ten-thousand-deep tree overflows the stack, and a CYCLIC graph never
//   returns at all.
//
//   Two budgets guarantee termination on any input, and they catch different
//   shapes. DEPTH catches cycles: every expansion along a cyclic path descends
//   one level, so such a path always breaches the depth ceiling. The NODE COUNT
//   catches breadth — a wide tree that never nests deeply and would otherwise
//   run to whatever size the payload chose.
//
//   Neither is identity-based tracking, deliberately: a visited set would also
//   reject legitimately shared subtrees, and counting is both cheaper and more
//   permissive.
//
// ARITHMETIC
//   Every operation goes through the decimal engine. There is no JavaScript
//   floating-point arithmetic in this file: values are scaled integers, ADD and
//   SUBTRACT are integer operations, and MULTIPLY and DIVIDE re-scale through
//   divideRounded with the regulation's own rounding mode.
//
// COMPLEXITY
//   O(n) time and O(n) space in the node count, itself capped at
//   MAX_EVALUATION_NODES — so both are bounded by a constant per evaluation.
//   Each node is expanded once and reduced once; nothing is traversed twice.
// ============================================================================

import {
  MARK_SCALE,
  MAX_CONSTANT_MAGNITUDE,
  MAX_EVALUATION_DEPTH,
  MAX_EVALUATION_NODES,
  RESULT_ENGINE_MESSAGE,
} from "@/lib/constants/resultEngine";
import { divideRounded, toScaled } from "@/lib/domain/result-engine/decimal";
import {
  CONDITION_COMPARATOR,
  FORMULA_NODE_KIND,
  FORMULA_OPERATOR,
  FORMULA_VARIABLE,
  type ConditionComparator,
  type FormulaVariable,
} from "@/lib/domain/result-engine/enums";
import type {
  EngineOutcome,
  EvaluationFailure,
  FormulaContext,
  Scaled,
} from "@/lib/domain/result-engine/types";

/** Machine-readable reasons an evaluation stopped. */
export const EVALUATION_ERROR = {
  MALFORMED_NODE: "MALFORMED_NODE",
  UNKNOWN_NODE_KIND: "UNKNOWN_NODE_KIND",
  UNKNOWN_OPERATOR: "UNKNOWN_OPERATOR",
  UNKNOWN_VARIABLE: "UNKNOWN_VARIABLE",
  UNBOUND_VARIABLE: "UNBOUND_VARIABLE",
  INVALID_CONSTANT: "INVALID_CONSTANT",
  DIVISION_BY_ZERO: "DIVISION_BY_ZERO",
  MISSING_OPERAND: "MISSING_OPERAND",
  MAX_DEPTH_EXCEEDED: "MAX_DEPTH_EXCEEDED",
  MAX_NODES_EXCEEDED: "MAX_NODES_EXCEEDED",
  OVERFLOW: "OVERFLOW",
  MALFORMED_CONDITION: "MALFORMED_CONDITION",
  UNKNOWN_COMPARATOR: "UNKNOWN_COMPARATOR",
} as const;

export type EvaluationErrorCode =
  (typeof EVALUATION_ERROR)[keyof typeof EVALUATION_ERROR];

/** Every operator the whitelist admits, as a Set for O(1) membership. */
const OPERATORS = new Set<string>(Object.values(FORMULA_OPERATOR));

/** Every variable the whitelist admits, as a Set for O(1) membership. */
const VARIABLES = new Set<string>(Object.values(FORMULA_VARIABLE));

/** Every comparator a condition may use. */
const COMPARATORS = new Set<string>(Object.values(CONDITION_COMPARATOR));

/** The re-scaling divisor for a product of two MARK_SCALE values. */
const SCALE_FACTOR = 10 ** MARK_SCALE;

function failure(code: EvaluationErrorCode, message: string): EngineOutcome<never> {
  return { ok: false, failure: { code, message } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One frame of the explicit-stack walk. */
interface Frame {
  readonly node: unknown;
  readonly depth: number;
  /** False on the way down, true on the way back up. */
  readonly reduced: boolean;
}

/**
 * Apply one binary operator to two scaled operands.
 *
 * ADD and SUBTRACT are plain integer arithmetic — two values at the same scale
 * add directly. MULTIPLY and DIVIDE are NOT: a product of two MARK_SCALE values
 * sits at MARK_SCALE squared and must come back down, and a quotient of two
 * MARK_SCALE values is dimensionless and must be lifted. Both re-scalings go
 * through divideRounded so the regulation's rounding mode decides the last
 * digit, rather than truncation deciding it silently.
 */
function applyOperator(
  operator: string,
  left: Scaled,
  right: Scaled,
  context: FormulaContext
): EngineOutcome<Scaled> {
  switch (operator) {
    case FORMULA_OPERATOR.ADD:
      return { ok: true, value: left + right };

    case FORMULA_OPERATOR.SUBTRACT:
      return { ok: true, value: left - right };

    case FORMULA_OPERATOR.MULTIPLY:
      // left x right lands at MARK_SCALE squared; divide back to MARK_SCALE.
      return {
        ok: true,
        value: divideRounded(left * right, SCALE_FACTOR, context.rounding),
      };

    case FORMULA_OPERATOR.DIVIDE:
      if (right === 0) {
        return failure(
          EVALUATION_ERROR.DIVISION_BY_ZERO,
          RESULT_ENGINE_MESSAGE.DIVISION_BY_ZERO
        );
      }

      // The quotient is dimensionless, so lift it back onto MARK_SCALE.
      return {
        ok: true,
        value: divideRounded(left * SCALE_FACTOR, right, context.rounding),
      };

    case FORMULA_OPERATOR.MIN:
      return { ok: true, value: left < right ? left : right };

    case FORMULA_OPERATOR.MAX:
      return { ok: true, value: left > right ? left : right };

    default:
      return failure(
        EVALUATION_ERROR.UNKNOWN_OPERATOR,
        `Unknown operator: ${String(operator)}`
      );
  }
}

/** Read a constant node into scaled form, refusing anything unrepresentable. */
function readConstant(value: unknown): EngineOutcome<Scaled> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return failure(
      EVALUATION_ERROR.INVALID_CONSTANT,
      "A formula constant must be a finite number"
    );
  }

  if (Math.abs(value) > MAX_CONSTANT_MAGNITUDE) {
    // Beyond this, toString() switches to exponential form and the exact
    // decimal parser would read a silently wrong value.
    return failure(
      EVALUATION_ERROR.INVALID_CONSTANT,
      "A formula constant exceeds the magnitude the engine can represent exactly"
    );
  }

  return { ok: true, value: toScaled(String(value)) };
}

/** Read a variable node from the bindings, distinguishing unknown from unbound. */
function readVariable(name: unknown, context: FormulaContext): EngineOutcome<Scaled> {
  if (typeof name !== "string" || !VARIABLES.has(name)) {
    return failure(
      EVALUATION_ERROR.UNKNOWN_VARIABLE,
      `Unknown variable: ${String(name)}`
    );
  }

  const bound = context.bindings[name as FormulaVariable];

  if (bound === undefined) {
    // A whitelisted name the engine could not supply — COURSE_TOTAL before the
    // course total exists, say. Reported distinctly from a name that is not in
    // the vocabulary at all, because the two need different fixes.
    return failure(
      EVALUATION_ERROR.UNBOUND_VARIABLE,
      `${RESULT_ENGINE_MESSAGE.UNBOUND_VARIABLE}: ${name}`
    );
  }

  return { ok: true, value: bound };
}

/**
 * Evaluate a formula expression.
 *
 * Returns an outcome rather than throwing, so a batch computing a thousand
 * students records which one could not be computed and carries on.
 *
 * @param root    the stored expression tree, untrusted
 * @param context the bound variables and the rounding mode to use
 */
export function evaluateFormula(
  root: unknown,
  context: FormulaContext
): EngineOutcome<Scaled> {
  const work: Frame[] = [{ node: root, depth: 1, reduced: false }];
  const values: Scaled[] = [];
  let visited = 0;

  while (work.length > 0) {
    const frame = work.pop();

    if (frame === undefined) {
      break;
    }

    const { node, depth, reduced } = frame;

    // Reduction frames are bookkeeping rather than nodes, so they are neither
    // counted nor depth-checked — only expansions are.
    if (!reduced) {
      visited += 1;

      if (visited > MAX_EVALUATION_NODES) {
        // The BREADTH guard. Cycles are caught by depth below, since every
        // expansion along a cyclic path descends a level.
        return failure(
          EVALUATION_ERROR.MAX_NODES_EXCEEDED,
          `A formula may contain at most ${MAX_EVALUATION_NODES} nodes`
        );
      }

      if (depth > MAX_EVALUATION_DEPTH) {
        return failure(EVALUATION_ERROR.MAX_DEPTH_EXCEEDED, RESULT_ENGINE_MESSAGE.MAX_DEPTH);
      }

      if (!isPlainObject(node)) {
        return failure(
          EVALUATION_ERROR.MALFORMED_NODE,
          "Expected a formula node object"
        );
      }

      if (node.kind === FORMULA_NODE_KIND.CONST) {
        const constant = readConstant(node.value);
        if (!constant.ok) return constant;
        values.push(constant.value);
        continue;
      }

      if (node.kind === FORMULA_NODE_KIND.VAR) {
        const variable = readVariable(node.name, context);
        if (!variable.ok) return variable;
        values.push(variable.value);
        continue;
      }

      if (node.kind === FORMULA_NODE_KIND.BINARY) {
        if (typeof node.operator !== "string" || !OPERATORS.has(node.operator)) {
          return failure(
            EVALUATION_ERROR.UNKNOWN_OPERATOR,
            `Unknown operator: ${String(node.operator)}`
          );
        }

        // Reduction frame first so it is popped last; then right, then left, so
        // the left operand is evaluated first and the value stack reads in
        // source order.
        work.push({ node, depth, reduced: true });
        work.push({ node: node.right, depth: depth + 1, reduced: false });
        work.push({ node: node.left, depth: depth + 1, reduced: false });
        continue;
      }

      return failure(
        EVALUATION_ERROR.UNKNOWN_NODE_KIND,
        `Unknown node kind: ${String(node.kind)}`
      );
    }

    // Reduction: both operands are on the value stack, right on top.
    const right = values.pop();
    const left = values.pop();

    if (left === undefined || right === undefined) {
      return failure(
        EVALUATION_ERROR.MISSING_OPERAND,
        "A binary node was reduced without both operands"
      );
    }

    const operatorNode = node as Record<string, unknown>;
    const applied = applyOperator(String(operatorNode.operator), left, right, context);

    if (!applied.ok) {
      return applied;
    }

    if (!Number.isSafeInteger(applied.value)) {
      // Past 2^53 a JavaScript number stops being an exact integer, and every
      // guarantee this engine makes rests on exactness.
      return failure(
        EVALUATION_ERROR.OVERFLOW,
        "A formula produced a value beyond exact integer range"
      );
    }

    values.push(applied.value);
  }

  const result = values.pop();

  if (result === undefined || values.length > 0) {
    // Either nothing was produced, or operands were left unconsumed — both mean
    // the tree was not a single well-formed expression.
    return failure(
      EVALUATION_ERROR.MALFORMED_NODE,
      "The expression did not reduce to exactly one value"
    );
  }

  return { ok: true, value: result };
}

/**
 * Evaluate a rule's condition — a FLAT conjunction of comparisons.
 *
 * Lives beside the formula evaluator rather than in its own module because it
 * is the same concern: reducing a stored structure against the same bindings,
 * with the same untrusted input and the same whitelist discipline. Splitting
 * them would put two halves of "evaluate an expression against a context" in
 * two files.
 *
 * A null or absent condition means the rule applies unconditionally, which is
 * what the nullable column means — so it is `true` rather than an error.
 *
 * COMPLEXITY : O(c) in the clause count, with no recursion at all: the shape is
 *              deliberately flat, which is why it needs no depth budget.
 */
export function evaluateCondition(
  condition: unknown,
  context: FormulaContext
): EngineOutcome<boolean> {
  if (condition === null || condition === undefined) {
    return { ok: true, value: true };
  }

  if (!isPlainObject(condition)) {
    return failure(EVALUATION_ERROR.MALFORMED_CONDITION, "Expected a condition object");
  }

  const clauses = condition.all;

  if (!Array.isArray(clauses)) {
    return failure(
      EVALUATION_ERROR.MALFORMED_CONDITION,
      "A condition must carry an `all` array of comparisons"
    );
  }

  for (const clause of clauses) {
    if (!isPlainObject(clause)) {
      return failure(EVALUATION_ERROR.MALFORMED_CONDITION, "Expected a comparison object");
    }

    const variable = readVariable(clause.variable, context);

    if (!variable.ok) {
      return variable;
    }

    const comparator = clause.comparator;

    if (typeof comparator !== "string" || !COMPARATORS.has(comparator)) {
      return failure(
        EVALUATION_ERROR.UNKNOWN_COMPARATOR,
        `Unknown comparator: ${String(comparator)}`
      );
    }

    const threshold = readConstant(clause.value);

    if (!threshold.ok) {
      return threshold;
    }

    if (!compare(variable.value, comparator as ConditionComparator, threshold.value)) {
      // A conjunction fails on its first false clause; the remaining ones
      // cannot change the answer.
      return { ok: true, value: false };
    }
  }

  return { ok: true, value: true };
}

/** One comparison, on exact integers. */
function compare(
  left: Scaled,
  comparator: ConditionComparator,
  right: Scaled
): boolean {
  switch (comparator) {
    case CONDITION_COMPARATOR.GT:
      return left > right;
    case CONDITION_COMPARATOR.GTE:
      return left >= right;
    case CONDITION_COMPARATOR.LT:
      return left < right;
    case CONDITION_COMPARATOR.LTE:
      return left <= right;
    default:
      return left === right;
  }
}

/** Narrow an outcome to its failure, for callers that have already checked. */
export function failureOf<T>(outcome: EngineOutcome<T>): EvaluationFailure | null {
  return outcome.ok ? null : outcome.failure;
}
