// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Engine — Custom Formula
// LAYER  : Domain (pure)
// PURPOSE: Validate a tenant-supplied formula expression. This is the security
//          boundary of the rule engine.
//
// WHY THIS IS NOT A ZOD SCHEMA
//   A formula is recursive, and a recursive Zod schema (z.lazy) recurses during
//   PARSING. A JSON body nested ten thousand deep would therefore overflow the
//   stack before any depth limit could be applied — a denial of service
//   reachable by any authenticated administrator, and one the validation layer
//   would have caused rather than prevented.
//
//   This validator walks ITERATIVELY with an explicit stack and refuses
//   anything past MAX_FORMULA_DEPTH or MAX_FORMULA_NODES, so the work one
//   request can demand is bounded BEFORE any of it is done. The Zod layer calls
//   it through a superRefine and maps what it returns onto issue paths.
//
// WHY THERE IS NO STRING SYNTAX
//   Nothing in this system will ever evaluate tenant-supplied text. A formula
//   is a typed tree over a closed whitelist of node kinds, operators and
//   variables. There is no function-call node, no property access, no
//   assignment and no path to a host object — not because those are filtered,
//   but because they cannot be expressed.
//
// COMPLEXITY
//   O(n) time and O(n) space in the node count, itself capped at
//   MAX_FORMULA_NODES. Both are therefore bounded by a constant per request.
// ============================================================================

import {
  FORMULA_NODE_KIND,
  FORMULA_OPERATOR,
  FORMULA_VARIABLE,
  MAX_FORMULA_DEPTH,
  MAX_FORMULA_NODES,
  type FormulaOperator,
  type FormulaVariable,
} from "@/lib/constants/evaluationRule";

/** A literal number. */
export interface FormulaConstNode {
  kind: typeof FORMULA_NODE_KIND.CONST;
  value: number;
}

/** A value the engine binds at evaluation time. */
export interface FormulaVarNode {
  kind: typeof FORMULA_NODE_KIND.VAR;
  name: FormulaVariable;
}

/** An arithmetic combination of two sub-expressions. */
export interface FormulaBinaryNode {
  kind: typeof FORMULA_NODE_KIND.BINARY;
  operator: FormulaOperator;
  left: FormulaExpression;
  right: FormulaExpression;
}

export type FormulaExpression = FormulaConstNode | FormulaVarNode | FormulaBinaryNode;

/** One reason an expression was rejected, with the path to the offending node. */
export interface FormulaViolation {
  path: string;
  message: string;
}

/** Every operator the whitelist admits, as a Set for O(1) membership. */
const OPERATORS = new Set<string>(Object.values(FORMULA_OPERATOR));

/** Every variable the whitelist admits, as a Set for O(1) membership. */
const VARIABLES = new Set<string>(Object.values(FORMULA_VARIABLE));

/** One frame of the iterative walk. */
interface Frame {
  node: unknown;
  path: string;
  depth: number;
}

/** True for a finite number — rejects NaN and both infinities. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** True for a plain object, which is the only shape a node may take. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a formula expression.
 *
 * Returns EVERY violation rather than the first, so an administrator repairs a
 * malformed formula in one pass instead of discovering the next problem on each
 * save.
 *
 * The node budget is consumed as the walk proceeds and checked before each node
 * is inspected, so an oversized tree is abandoned at the limit rather than
 * fully traversed. Depth is carried per frame rather than tracked globally,
 * which is what makes the check correct for a tree rather than only for a
 * chain.
 *
 * @param root the untrusted value, straight from the request body
 */
export function validateFormulaExpression(root: unknown): FormulaViolation[] {
  const violations: FormulaViolation[] = [];
  const stack: Frame[] = [{ node: root, path: "expression", depth: 1 }];
  let visited = 0;

  while (stack.length > 0) {
    const frame = stack.pop();

    if (frame === undefined) {
      break;
    }

    visited += 1;

    if (visited > MAX_FORMULA_NODES) {
      violations.push({
        path: "expression",
        message: `A formula may contain at most ${MAX_FORMULA_NODES} nodes`,
      });
      break;
    }

    const { node, path, depth } = frame;

    if (depth > MAX_FORMULA_DEPTH) {
      violations.push({
        path,
        message: `A formula may nest at most ${MAX_FORMULA_DEPTH} levels`,
      });
      continue;
    }

    if (!isPlainObject(node)) {
      violations.push({ path, message: "Expected a formula node object" });
      continue;
    }

    if (node.kind === FORMULA_NODE_KIND.CONST) {
      if (!isFiniteNumber(node.value)) {
        violations.push({
          path: `${path}.value`,
          message: "A constant must be a finite number",
        });
      }
      continue;
    }

    if (node.kind === FORMULA_NODE_KIND.VAR) {
      if (typeof node.name !== "string" || !VARIABLES.has(node.name)) {
        violations.push({
          path: `${path}.name`,
          message: `Unknown variable; permitted values are ${[...VARIABLES].join(", ")}`,
        });
      }
      continue;
    }

    if (node.kind === FORMULA_NODE_KIND.BINARY) {
      if (typeof node.operator !== "string" || !OPERATORS.has(node.operator)) {
        violations.push({
          path: `${path}.operator`,
          message: `Unknown operator; permitted values are ${[...OPERATORS].join(", ")}`,
        });
      }

      // A literal zero divisor is the one arithmetic fault detectable without
      // running the formula, so it is refused at save time rather than
      // surfacing as a non-finite grade during a cohort computation.
      if (
        node.operator === FORMULA_OPERATOR.DIVIDE &&
        isPlainObject(node.right) &&
        node.right.kind === FORMULA_NODE_KIND.CONST &&
        node.right.value === 0
      ) {
        violations.push({
          path: `${path}.right`,
          message: "Division by a literal zero",
        });
      }

      stack.push({ node: node.left, path: `${path}.left`, depth: depth + 1 });
      stack.push({ node: node.right, path: `${path}.right`, depth: depth + 1 });
      continue;
    }

    violations.push({
      path: `${path}.kind`,
      message: `Unknown node kind; permitted values are ${Object.values(FORMULA_NODE_KIND).join(", ")}`,
    });
  }

  return violations;
}

/**
 * Every variable an expression reads, without duplicates.
 *
 * The service uses this to reject a formula that reads COURSE_TOTAL at a phase
 * where the course total does not yet exist — a check the shape validator
 * cannot make, because it depends on the rule's phase rather than on the
 * expression alone.
 *
 * Assumes the expression already passed validateFormulaExpression; an unknown
 * node contributes nothing rather than throwing, so a caller that skips
 * validation gets an undercount instead of a crash.
 *
 * COMPLEXITY : O(n) time, O(n) space, both bounded by MAX_FORMULA_NODES.
 */
export function collectFormulaVariables(root: unknown): FormulaVariable[] {
  const found = new Set<FormulaVariable>();
  const stack: unknown[] = [root];
  let visited = 0;

  while (stack.length > 0 && visited <= MAX_FORMULA_NODES) {
    const node = stack.pop();
    visited += 1;

    if (!isPlainObject(node)) {
      continue;
    }

    if (node.kind === FORMULA_NODE_KIND.VAR && typeof node.name === "string") {
      if (VARIABLES.has(node.name)) {
        found.add(node.name as FormulaVariable);
      }
      continue;
    }

    if (node.kind === FORMULA_NODE_KIND.BINARY) {
      stack.push(node.left);
      stack.push(node.right);
    }
  }

  return [...found];
}
