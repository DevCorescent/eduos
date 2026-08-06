// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Component
// LAYER  : Domain (pure)
// PURPOSE: The rules that decide whether a component tree is a coherent
//          assessment structure, expressed as pure functions over plain data.
//
// WHY THIS IS A SEPARATE LAYER
//   Two services need these rules. The component service applies them so an
//   administrator can see what is still wrong with a draft, and the SCHEME
//   service applies them at activation, where they become binding. Putting them
//   in either service would make the other import it; putting them here means
//   both import a module that touches no database, no framework and no Prisma
//   type, and that can be exhaustively unit-tested on literal input.
//
// ARITHMETIC
//   Every weight is parsed into an integer number of HUNDREDTHS before it is
//   summed. weightage is Decimal(5,2) — exact base-10 — but 33.33 + 33.33 +
//   33.34 is 99.99999999999999 in IEEE 754, so a perfectly legal regulation
//   would be rejected by floating-point noise. Integers make the comparison
//   exact, which is the only acceptable standard for arithmetic that decides
//   whether a student passed.
//
// COMPLEXITY
//   Every function here is a single pass or a single walk over the node set:
//   O(n) time, O(n) space, where n is the number of components in ONE scheme —
//   realistically five to thirty. Nothing recurses without a bound and nothing
//   loops over a pair of nodes.
// ============================================================================

import {
  ComponentAggregation,
  ComponentRollup,
  ComponentSource,
} from "@/app/generated/prisma/enums";
import {
  COMPONENT_FIELD_PREFIX,
  COMPONENT_TREE_VIOLATION,
  DECIMAL_SCALE,
  MAX_TREE_DEPTH,
  TOTAL_WEIGHTAGE_HUNDREDTHS,
  type ComponentTreeViolationCode,
} from "@/lib/constants/evaluationComponent";

/**
 * Anything that renders itself as a decimal string.
 *
 * Structural on purpose: it matches Prisma's Decimal and a plain string alike,
 * so a caller passes repository records straight in and this module still
 * imports no Prisma type.
 */
export interface DecimalLike {
  toString(): string;
}

/** The facts about one component that the tree rules depend on. */
export interface ComponentTreeInput {
  id: string;
  parentComponentId: string | null;
  code: string;
  sequence: number;
  weightage: DecimalLike;
  maxMarks: DecimalLike;
  aggregation: ComponentAggregation | null;
  rollup: ComponentRollup | null;
  sourceType: ComponentSource;
  ruleConfig: unknown;
}

/** One reason a tree is not fit for activation. */
export interface ComponentTreeViolation {
  code: ComponentTreeViolationCode;
  field: string;
  message: string;
}

/** An indexed view of a tree, built once and reused by every rule. */
export interface ComponentTreeIndex {
  byId: Map<string, ComponentTreeInput>;
  childrenOf: Map<string, ComponentTreeInput[]>;
  roots: ComponentTreeInput[];
  /** Depth of each reachable node, roots being 1. Unreachable nodes are absent. */
  depthOf: Map<string, number>;
}

/** The aggregations whose behaviour is parameterised by ruleConfig.count. */
const COUNT_DRIVEN_AGGREGATIONS: readonly ComponentAggregation[] = [
  ComponentAggregation.BEST_N,
  ComponentAggregation.DROP_LOWEST_N,
];

/** Sibling weights must total 100 only when the parent actually weights them. */
const WEIGHTED_ROLLUPS: readonly ComponentRollup[] = [ComponentRollup.WEIGHTED_SUM];

/** Field path identifying a node in a violation, e.g. "components.ST1.weightage". */
function fieldFor(code: string, attribute?: string): string {
  return attribute === undefined
    ? `${COMPONENT_FIELD_PREFIX}.${code}`
    : `${COMPONENT_FIELD_PREFIX}.${code}.${attribute}`;
}

/**
 * Parse an exact decimal string into an integer number of hundredths.
 *
 * "30"     -> 3000
 * "30.5"   -> 3050
 * "33.34"  -> 3334
 *
 * Deliberately not Number(value) * 100: that reintroduces the binary rounding
 * this whole module exists to avoid. The string is split on its decimal point
 * and the fractional part is padded to the column's scale, so the result is the
 * exact value the database holds.
 */
export function parseHundredths(value: DecimalLike): number {
  const text = value.toString().trim();
  const isNegative = text.startsWith("-");
  const unsigned = isNegative ? text.slice(1) : text;

  const separatorIndex = unsigned.indexOf(".");
  const whole = separatorIndex === -1 ? unsigned : unsigned.slice(0, separatorIndex);
  const fraction = separatorIndex === -1 ? "" : unsigned.slice(separatorIndex + 1);

  const scaled = `${fraction}${"0".repeat(DECIMAL_SCALE)}`.slice(0, DECIMAL_SCALE);
  const magnitude = Number(whole || "0") * 10 ** DECIMAL_SCALE + Number(scaled);

  return isNegative ? -magnitude : magnitude;
}

/**
 * Index a flat component list into a navigable tree.
 *
 * One pass builds the id map and the child buckets; a second, breadth-first
 * walk from the roots assigns depths. The walk carries a visited set, so a
 * cycle terminates it rather than hanging — which is what lets validate() below
 * detect cycles by looking for nodes the walk never reached.
 *
 * COMPLEXITY : O(n) time, O(n) space.
 */
export function indexComponentTree(components: readonly ComponentTreeInput[]): ComponentTreeIndex {
  const byId = new Map<string, ComponentTreeInput>();
  const childrenOf = new Map<string, ComponentTreeInput[]>();
  const roots: ComponentTreeInput[] = [];

  for (const component of components) {
    byId.set(component.id, component);
  }

  for (const component of components) {
    const parentId = component.parentComponentId;

    // A node naming a parent that is not present is neither a root nor a child;
    // it is reported as orphaned by validate() and left out of the walk.
    if (parentId === null) {
      roots.push(component);
      continue;
    }

    if (!byId.has(parentId)) {
      continue;
    }

    const bucket = childrenOf.get(parentId);

    if (bucket === undefined) {
      childrenOf.set(parentId, [component]);
    } else {
      bucket.push(component);
    }
  }

  const depthOf = new Map<string, number>();
  const queue: { node: ComponentTreeInput; depth: number }[] = roots.map((node) => ({
    node,
    depth: 1,
  }));

  while (queue.length > 0) {
    const current = queue.pop();

    if (current === undefined) {
      break;
    }

    // Guards against a cycle among non-root nodes: a node already assigned a
    // depth is never expanded twice.
    if (depthOf.has(current.node.id)) {
      continue;
    }

    depthOf.set(current.node.id, current.depth);

    for (const child of childrenOf.get(current.node.id) ?? []) {
      queue.push({ node: child, depth: current.depth + 1 });
    }
  }

  return { byId, childrenOf, roots, depthOf };
}

/** True when a node has no children. Derived, never stored. */
export function isLeafNode(index: ComponentTreeIndex, id: string): boolean {
  return (index.childrenOf.get(id) ?? []).length === 0;
}

/**
 * Read ruleConfig defensively.
 *
 * The column is JSON, so a value written before a rule tightened — or by any
 * future writer — may not match the current shape. Reading through a guard
 * means a malformed config produces a violation rather than a thrown TypeError
 * in the middle of a grade computation.
 */
function readRuleConfig(value: unknown): { count?: unknown; attendanceBands?: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as { count?: unknown; attendanceBands?: unknown };
}

/** Collect the sibling groups whose weights must total exactly 100. */
function weightedGroups(
  index: ComponentTreeIndex
): { owner: string; members: ComponentTreeInput[] }[] {
  const groups: { owner: string; members: ComponentTreeInput[] }[] = [];

  // The root group always carries the course total, whatever any branch does.
  if (index.roots.length > 0) {
    groups.push({ owner: COMPONENT_FIELD_PREFIX, members: index.roots });
  }

  for (const [parentId, members] of index.childrenOf) {
    const parent = index.byId.get(parentId);

    if (parent === undefined || parent.rollup === null) {
      continue;
    }

    if (WEIGHTED_ROLLUPS.includes(parent.rollup)) {
      groups.push({ owner: fieldFor(parent.code), members });
    }
  }

  return groups;
}

/**
 * Every reason this tree cannot be activated.
 *
 * Returns ALL violations rather than the first, so an administrator fixes a
 * misconfigured regulation once instead of discovering the next problem on
 * every retry.
 *
 * These are the WHOLE-TREE rules, checked at activation. Per-node rules that
 * hold regardless of position — a component declaring both an aggregation and a
 * rollup, a mark out of range — are enforced on write by the validation layer
 * and the service, because they can never become valid later. Sibling totals
 * and leaf/branch coherence deliberately are NOT enforced on write: a draft is
 * legitimately incomplete while it is being built, and refusing the first
 * component of a pair that must total 100 would make the tree impossible to
 * enter.
 *
 * COMPLEXITY : O(n) time and O(n) space — one index build, then one pass per
 *              rule family over the same node set.
 */
export function validateComponentTree(
  components: readonly ComponentTreeInput[]
): ComponentTreeViolation[] {
  const violations: ComponentTreeViolation[] = [];

  if (components.length === 0) {
    return [
      {
        code: COMPONENT_TREE_VIOLATION.EMPTY_TREE,
        field: COMPONENT_FIELD_PREFIX,
        message: "The scheme has no evaluation components",
      },
    ];
  }

  const index = indexComponentTree(components);

  for (const component of components) {
    const parentId = component.parentComponentId;

    if (parentId !== null && !index.byId.has(parentId)) {
      violations.push({
        code: COMPONENT_TREE_VIOLATION.ORPHANED_NODE,
        field: fieldFor(component.code, "parentComponentId"),
        message: "Parent component does not belong to this scheme",
      });
      continue;
    }

    const depth = index.depthOf.get(component.id);

    if (depth === undefined) {
      violations.push({
        code: COMPONENT_TREE_VIOLATION.CYCLE,
        field: fieldFor(component.code, "parentComponentId"),
        message: "Component is part of a parent cycle and is unreachable from any root",
      });
      continue;
    }

    if (depth > MAX_TREE_DEPTH) {
      violations.push({
        code: COMPONENT_TREE_VIOLATION.MAX_DEPTH_EXCEEDED,
        field: fieldFor(component.code),
        message: `Component nests deeper than the permitted ${MAX_TREE_DEPTH} levels`,
      });
    }

    const leaf = isLeafNode(index, component.id);
    const config = readRuleConfig(component.ruleConfig);

    if (leaf) {
      if (component.aggregation === null) {
        violations.push({
          code: COMPONENT_TREE_VIOLATION.LEAF_MISSING_AGGREGATION,
          field: fieldFor(component.code, "aggregation"),
          message: "A component with no children must declare how its sessions aggregate",
        });
      }

      if (component.rollup !== null) {
        violations.push({
          code: COMPONENT_TREE_VIOLATION.LEAF_HAS_ROLLUP,
          field: fieldFor(component.code, "rollup"),
          message: "A component with no children has nothing to roll up",
        });
      }

      if (
        component.aggregation !== null &&
        COUNT_DRIVEN_AGGREGATIONS.includes(component.aggregation) &&
        typeof config.count !== "number"
      ) {
        violations.push({
          code: COMPONENT_TREE_VIOLATION.RULE_CONFIG_MISSING_COUNT,
          field: fieldFor(component.code, "ruleConfig.count"),
          message: `${component.aggregation} requires a numeric ruleConfig.count`,
        });
      }

      if (
        component.sourceType === ComponentSource.ATTENDANCE_DERIVED &&
        !Array.isArray(config.attendanceBands)
      ) {
        violations.push({
          code: COMPONENT_TREE_VIOLATION.RULE_CONFIG_MISSING_BANDS,
          field: fieldFor(component.code, "ruleConfig.attendanceBands"),
          message: "An attendance-derived component requires ruleConfig.attendanceBands",
        });
      }

      continue;
    }

    if (component.rollup === null) {
      violations.push({
        code: COMPONENT_TREE_VIOLATION.BRANCH_MISSING_ROLLUP,
        field: fieldFor(component.code, "rollup"),
        message: "A component with children must declare how those children combine",
      });
    }

    if (component.aggregation !== null) {
      violations.push({
        code: COMPONENT_TREE_VIOLATION.BRANCH_HAS_AGGREGATION,
        field: fieldFor(component.code, "aggregation"),
        message: "A component with children takes its value from them, not from its own sessions",
      });
    }

    if (component.sourceType !== ComponentSource.COMPUTED) {
      violations.push({
        code: COMPONENT_TREE_VIOLATION.BRANCH_HAS_MARK_SOURCE,
        field: fieldFor(component.code, "sourceType"),
        message: "A component with children is COMPUTED; marks are never entered against it",
      });
    }
  }

  const rootSequences = new Set<number>();

  for (const root of index.roots) {
    if (rootSequences.has(root.sequence)) {
      violations.push({
        code: COMPONENT_TREE_VIOLATION.DUPLICATE_ROOT_SEQUENCE,
        field: fieldFor(root.code, "sequence"),
        message: "Two top-level components occupy the same position",
      });
      continue;
    }

    rootSequences.add(root.sequence);
  }

  for (const group of weightedGroups(index)) {
    const total = group.members.reduce(
      (sum, member) => sum + parseHundredths(member.weightage),
      0
    );

    if (total !== TOTAL_WEIGHTAGE_HUNDREDTHS) {
      const actual = (total / 10 ** DECIMAL_SCALE).toFixed(DECIMAL_SCALE);

      violations.push({
        code: COMPONENT_TREE_VIOLATION.WEIGHTAGE_TOTAL,
        field: `${group.owner}.weightage`,
        message: `Weighted components must total 100.00 but total ${actual}`,
      });
    }
  }

  return violations;
}

/**
 * Every id in the subtree rooted at `rootId`, including the root itself.
 *
 * Used to delete a branch in ONE bulk statement instead of relying on a
 * database cascade, so the audit entry can record exactly which nodes went.
 *
 * COMPLEXITY : O(n) time and O(n) space. The visited guard means a corrupted
 *              tree bounds the walk instead of hanging it.
 */
export function collectSubtreeIds(
  components: readonly ComponentTreeInput[],
  rootId: string
): string[] {
  const index = indexComponentTree(components);
  const collected: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];

  while (stack.length > 0) {
    const currentId = stack.pop();

    if (currentId === undefined || seen.has(currentId)) {
      continue;
    }

    seen.add(currentId);
    collected.push(currentId);

    for (const child of index.childrenOf.get(currentId) ?? []) {
      stack.push(child.id);
    }
  }

  return collected;
}

/**
 * Would re-parenting `nodeId` beneath `newParentId` create a cycle?
 *
 * Walks upward from the proposed parent. If the walk reaches the node being
 * moved, the node would become its own ancestor. A node cannot be its own
 * parent either, which the first comparison covers.
 *
 * COMPLEXITY : O(depth), bounded to O(n) by the visited guard, which also stops
 *              the walk if the stored tree is already corrupted.
 */
export function wouldCreateCycle(
  components: readonly ComponentTreeInput[],
  nodeId: string,
  newParentId: string
): boolean {
  const index = indexComponentTree(components);
  const seen = new Set<string>();

  let cursor: string | null = newParentId;

  while (cursor !== null) {
    if (cursor === nodeId) {
      return true;
    }

    if (seen.has(cursor)) {
      return false;
    }

    seen.add(cursor);
    cursor = index.byId.get(cursor)?.parentComponentId ?? null;
  }

  return false;
}
