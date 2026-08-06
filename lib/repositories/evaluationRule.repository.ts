// ============================================================================
// OWNER      : Gauransh
// MODULE     : Evaluation Rule
// LAYER      : Repository
// PURPOSE    : Prisma data access for EvaluationRule.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • No pipeline ordering logic, no config parsing, no phase/scope rules, no
//     cohort-scope derivation, no DTO mapping.
//
// WHAT THIS REPOSITORY DELIBERATELY DOES NOT QUERY
//   Neither the owning scheme nor the target component. Both already have
//   repositories with exactly the reads this module needs — findById on each —
//   so the service injects those as narrow ports instead. Re-declaring either
//   query here would be a second definition of a read that already exists, and
//   the third copy of the scheme-lifecycle lookup in this phase.
//
//   The cost of reusing them is a handful of extra columns on a configuration
//   table read once per mutation. That is not measurable, and the project rule
//   is to optimize only where it is.
//
// TENANCY: every query is anchored on tenantId, and every scheme-scoped query
//          on schemeId as well, so a rule of another regulation cannot be
//          reached even within the same tenant.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { toJsonInput } from "@/lib/utils/prisma-json";
import type { Prisma, RuleOperation, RulePhase } from "@/app/generated/prisma/client";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/**
 * Columns returned for a rule.
 *
 * Declared once so every read answers with the same shape. No relation is
 * expanded: a rule's scheme is already known from the route, and its component
 * is reported as an id the caller already holds from the component tree.
 */
export const EVALUATION_RULE_SELECT = {
  id: true,
  tenantId: true,
  schemeId: true,
  componentId: true,
  code: true,
  name: true,
  description: true,
  phase: true,
  operation: true,
  sequence: true,
  config: true,
  condition: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type EvaluationRuleRecord = Prisma.EvaluationRuleGetPayload<{
  select: typeof EVALUATION_RULE_SELECT;
}>;

/**
 * Fixed ordering: pipeline execution order.
 *
 * This relies on a property of the schema that is deliberate rather than
 * accidental: RulePhase is DECLARED in pipeline order — SESSION_ADJUSTMENT,
 * COMPONENT_ADJUSTMENT, COURSE_ADJUSTMENT — and PostgreSQL orders an enum by
 * its declaration order. So sorting by phase in the database yields exactly the
 * order the engine must execute in, and no application-side sort is needed.
 *
 * The coupling is stated here because it is invisible otherwise: reordering the
 * RulePhase enum would silently reorder the pipeline. `sequence` then orders
 * within a phase, and `code` makes the order TOTAL — necessary because
 * componentId is nullable, so @@unique([schemeId, componentId, phase, sequence])
 * leaves course-level rules able to share a sequence.
 */
const PIPELINE_ORDER_BY: Prisma.EvaluationRuleOrderByWithRelationInput[] = [
  { phase: "asc" },
  { sequence: "asc" },
  { code: "asc" },
];

/** Columns written when a rule is created. */
export interface CreateEvaluationRuleData {
  tenantId: string;
  schemeId: string;
  componentId: string | null;
  code: string;
  name: string;
  description: string | null;
  phase: RulePhase;
  operation: RuleOperation;
  sequence: number;
  /** A plain parameters object, or null for "no parameters". */
  config: unknown;
  /** A plain condition object, or null for "applies unconditionally". */
  condition: unknown;
}

/** Columns writable on an existing rule. Omit to leave unchanged. */
export interface UpdateEvaluationRuleData {
  componentId?: string | null;
  code?: string;
  name?: string;
  description?: string | null;
  phase?: RulePhase;
  operation?: RuleOperation;
  sequence?: number;
  config?: unknown;
  condition?: unknown;
}

export class EvaluationRuleRepository {
  /**
   * One scheme's entire rule set, in pipeline execution order.
   *
   * This is the module's only hot query, and every operation begins with it —
   * reads, writes and the position check alike. Loading the whole set once and
   * answering every question against it in memory is what keeps this module
   * free of per-rule queries.
   *
   * COMPLEXITY : O(log n + r) where r is the rule count of ONE scheme, zero to
   *              twenty in practice. Rides @@unique([schemeId, code]), whose
   *              leading column is schemeId. The sort is over r rows, which at
   *              this cardinality costs nothing.
   */
  async findAllBySchemeId(
    tenantId: string,
    schemeId: string,
    client: DbClient = prisma
  ): Promise<EvaluationRuleRecord[]> {
    return client.evaluationRule.findMany({
      where: { tenantId, schemeId },
      orderBy: PIPELINE_ORDER_BY,
      select: EVALUATION_RULE_SELECT,
    });
  }

  /**
   * One rule, scoped to both its tenant and its scheme.
   *
   * schemeId is part of the predicate, not merely of the URL, so a rule id
   * belonging to another regulation of the same tenant resolves to null rather
   * than being served under the wrong scheme.
   *
   * COMPLEXITY : O(log n).
   */
  async findById(
    tenantId: string,
    schemeId: string,
    ruleId: string,
    client: DbClient = prisma
  ): Promise<EvaluationRuleRecord | null> {
    return client.evaluationRule.findFirst({
      where: { id: ruleId, tenantId, schemeId },
      select: EVALUATION_RULE_SELECT,
    });
  }

  /**
   * Insert one rule.
   *
   * COMPLEXITY : O(log n) — one INSERT plus maintenance of the three unique
   *              indexes declared on the model.
   */
  async create(
    data: CreateEvaluationRuleData,
    client: DbClient = prisma
  ): Promise<EvaluationRuleRecord> {
    return client.evaluationRule.create({
      data: {
        ...data,
        config: toJsonInput(data.config),
        condition: toJsonInput(data.condition),
      },
      select: EVALUATION_RULE_SELECT,
    });
  }

  /**
   * Update one rule, tenant-scoped in the same statement.
   *
   * Uses the tenantId_id compound selector generated from
   * @@unique([tenantId, id]), so the write itself carries the tenant predicate
   * rather than inheriting it from a preceding read.
   *
   * COMPLEXITY : O(log n).
   */
  async update(
    tenantId: string,
    ruleId: string,
    data: UpdateEvaluationRuleData,
    client: DbClient = prisma
  ): Promise<EvaluationRuleRecord> {
    return client.evaluationRule.update({
      where: { tenantId_id: { tenantId, id: ruleId } },
      data: {
        ...data,
        config: toJsonInput(data.config),
        condition: toJsonInput(data.condition),
      },
      select: EVALUATION_RULE_SELECT,
    });
  }

  /**
   * Remove one rule, tenant-scoped in the same statement.
   *
   * A rule owns nothing, so there is no subtree to gather as there is for a
   * component — a single delete is the whole operation.
   *
   * COMPLEXITY : O(log n).
   */
  async delete(tenantId: string, ruleId: string, client: DbClient = prisma): Promise<void> {
    await client.evaluationRule.delete({
      where: { tenantId_id: { tenantId, id: ruleId } },
      select: { id: true },
    });
  }

  /**
   * Run a unit of work atomically.
   *
   * The repository owns the Prisma handle, so the transaction opens here; the
   * service decides its BOUNDARY by choosing what goes inside the callback.
   */
  async transaction<T>(
    fn: (tx: DbClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel }
  ): Promise<T> {
    return prisma.$transaction(fn, options);
  }
}

export const evaluationRuleRepository = new EvaluationRuleRepository();

/**
 * The abstraction the rule service depends on.
 *
 * Imported with `import type`, so it is erased at compile time and the service
 * module never pulls lib/db/prisma into its runtime graph — which is what lets
 * it be unit-tested with no database and no environment.
 */
export type EvaluationRuleRepositoryPort = Pick<
  EvaluationRuleRepository,
  "findAllBySchemeId" | "findById" | "create" | "update" | "delete" | "transaction"
>;

/**
 * The narrow slice a future calculation engine needs.
 *
 * Declared now because the engine will read rule sets and must provably never
 * mutate one — the same narrowing already used for EvaluationComponentTreePort.
 */
export type EvaluationRuleSetPort = Pick<EvaluationRuleRepository, "findAllBySchemeId">;
