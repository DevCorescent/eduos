// ============================================================================
// OWNER      : Gauransh
// MODULE     : Evaluation Component
// LAYER      : Repository
// PURPOSE    : Prisma data access for EvaluationComponent, plus the one
//              EvaluationScheme fact the module must verify before it writes.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • No tree building, no cycle detection, no weight arithmetic, no leafness.
//   • No DTO mapping.
//
// THE SHAPE OF EVERY OPERATION
//   One query loads a scheme's ENTIRE tree; every rule is then applied in
//   memory by the domain layer. There is deliberately no findChildren, no
//   findParent and no recursive descent — each would be an N+1 waiting to
//   happen, and a scheme's tree is a handful of rows, so loading all of it once
//   is both simpler and strictly cheaper than walking it.
//
// TENANCY: every query is anchored on tenantId, and every scheme-scoped query
//          on schemeId as well, so a component of another regulation cannot be
//          reached even within the same tenant.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
// The Prisma.DbNull sentinel needed to clear a nullable Json column now lives
// in lib/utils/prisma-json.ts, shared with the rule repository, which needs the
// identical translation for its config and condition columns.
import { toJsonInput } from "@/lib/utils/prisma-json";
import type {
  Prisma,
  ComponentAggregation,
  ComponentRollup,
  ComponentSource,
  EvaluationComponentType,
  EvaluationSchemeStatus,
} from "@/app/generated/prisma/client";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/**
 * Columns returned for a component.
 *
 * Declared once so every read answers with the same shape. No relation is
 * expanded: `children` is reconstructed in memory from the flat list, which
 * costs one pass instead of a nested read whose depth the query would have to
 * guess in advance.
 */
export const EVALUATION_COMPONENT_SELECT = {
  id: true,
  tenantId: true,
  schemeId: true,
  parentComponentId: true,
  code: true,
  name: true,
  description: true,
  type: true,
  sourceType: true,
  maxMarks: true,
  weightage: true,
  aggregation: true,
  rollup: true,
  ruleConfig: true,
  sequence: true,
  isMandatory: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type EvaluationComponentRecord = Prisma.EvaluationComponentGetPayload<{
  select: typeof EVALUATION_COMPONENT_SELECT;
}>;

/**
 * Fixed tree ordering.
 *
 * (sequence, code) rather than sequence alone, and that second key is
 * load-bearing rather than defensive. parentComponentId is nullable, so
 * @@unique([schemeId, parentComponentId, sequence]) leaves ROOT components able
 * to share a position — PostgreSQL treats NULL as distinct. Ordering by code as
 * well makes the sequence TOTAL regardless, because code is unique per scheme,
 * so the tree renders identically on every request even in the state the unique
 * index cannot forbid.
 */
const TREE_ORDER_BY: Prisma.EvaluationComponentOrderByWithRelationInput[] = [
  { sequence: "asc" },
  { code: "asc" },
];

/** The two facts the service needs about the owning scheme. */
export interface OwningSchemeRecord {
  id: string;
  status: EvaluationSchemeStatus;
}

/** Columns written when a component is created. */
export interface CreateEvaluationComponentData {
  tenantId: string;
  schemeId: string;
  parentComponentId: string | null;
  code: string;
  name: string;
  description: string | null;
  type: EvaluationComponentType;
  sourceType?: ComponentSource;
  maxMarks: number;
  weightage: number;
  aggregation: ComponentAggregation | null;
  rollup: ComponentRollup | null;
  /** A plain parameters object, or null for "no parameters". */
  ruleConfig: unknown;
  sequence: number;
  isMandatory?: boolean;
}

/** Columns writable on an existing component. */
export interface UpdateEvaluationComponentData {
  parentComponentId?: string | null;
  code?: string;
  name?: string;
  description?: string | null;
  type?: EvaluationComponentType;
  sourceType?: ComponentSource;
  maxMarks?: number;
  weightage?: number;
  aggregation?: ComponentAggregation | null;
  rollup?: ComponentRollup | null;
  /** Omit to leave unchanged; null clears it. */
  ruleConfig?: unknown;
  sequence?: number;
  isMandatory?: boolean;
}

export class EvaluationComponentRepository {
  /**
   * The owning scheme's identity and lifecycle state, tenant-scoped.
   *
   * Selects two columns because two is all the service decides on. Reading the
   * whole regulation to answer "does it exist and is it still a draft" would be
   * bandwidth spent on a question a status column answers.
   *
   * COMPLEXITY : O(log n) on EvaluationScheme's @@unique([tenantId, id]).
   */
  async findScheme(
    tenantId: string,
    schemeId: string,
    client: DbClient = prisma
  ): Promise<OwningSchemeRecord | null> {
    return client.evaluationScheme.findFirst({
      where: { id: schemeId, tenantId },
      select: { id: true, status: true },
    });
  }

  /**
   * One scheme's entire component tree, as a flat ordered list.
   *
   * This is the module's only hot query and every operation begins with it.
   *
   * COMPLEXITY : O(log n + k) where k is the component count of ONE scheme —
   *              five to thirty in practice. Rides @@index([tenantId, schemeId])
   *              and the ordering comes from a sort of k rows, which at this
   *              cardinality is free.
   */
  async findTreeBySchemeId(
    tenantId: string,
    schemeId: string,
    client: DbClient = prisma
  ): Promise<EvaluationComponentRecord[]> {
    return client.evaluationComponent.findMany({
      where: { tenantId, schemeId },
      orderBy: TREE_ORDER_BY,
      select: EVALUATION_COMPONENT_SELECT,
    });
  }

  /**
   * One component, scoped to both its tenant and its scheme.
   *
   * schemeId is part of the predicate, not merely of the URL, so a component id
   * belonging to another regulation of the same tenant resolves to null rather
   * than being served under the wrong scheme.
   *
   * COMPLEXITY : O(log n).
   */
  async findById(
    tenantId: string,
    schemeId: string,
    componentId: string,
    client: DbClient = prisma
  ): Promise<EvaluationComponentRecord | null> {
    return client.evaluationComponent.findFirst({
      where: { id: componentId, tenantId, schemeId },
      select: EVALUATION_COMPONENT_SELECT,
    });
  }

  /**
   * Insert one component.
   *
   * COMPLEXITY : O(log n) — one INSERT plus maintenance of the four unique
   *              indexes and two secondary indexes declared on the model.
   */
  async create(
    data: CreateEvaluationComponentData,
    client: DbClient = prisma
  ): Promise<EvaluationComponentRecord> {
    return client.evaluationComponent.create({
      data: { ...data, ruleConfig: toJsonInput(data.ruleConfig) },
      select: EVALUATION_COMPONENT_SELECT,
    });
  }

  /**
   * Update one component, tenant-scoped in the same statement.
   *
   * Uses the tenantId_id compound selector generated from
   * @@unique([tenantId, id]), so the write itself carries the tenant predicate
   * rather than inheriting it from a preceding read.
   *
   * COMPLEXITY : O(log n).
   */
  async update(
    tenantId: string,
    componentId: string,
    data: UpdateEvaluationComponentData,
    client: DbClient = prisma
  ): Promise<EvaluationComponentRecord> {
    return client.evaluationComponent.update({
      where: { tenantId_id: { tenantId, id: componentId } },
      data: { ...data, ruleConfig: toJsonInput(data.ruleConfig) },
      select: EVALUATION_COMPONENT_SELECT,
    });
  }

  /**
   * Remove a set of components in ONE statement.
   *
   * A whole subtree is deleted together, deliberately, rather than by leaning
   * on a database cascade. Two reasons: the audit entry can then record exactly
   * which nodes were removed, and the parent foreign key is ON DELETE NO ACTION
   * — which PostgreSQL checks at end-of-statement, so parent and children
   * vanishing in the same statement satisfies it while a row-at-a-time deletion
   * would be refused.
   *
   * COMPLEXITY : one DELETE over an id set, O(k log n) for k nodes.
   */
  async deleteMany(
    tenantId: string,
    componentIds: readonly string[],
    client: DbClient = prisma
  ): Promise<number> {
    const result = await client.evaluationComponent.deleteMany({
      where: { tenantId, id: { in: [...componentIds] } },
    });

    return result.count;
  }

  /**
   * Run a unit of work atomically.
   *
   * The repository owns the Prisma handle so the transaction opens here; the
   * service decides the boundary by choosing what goes inside the callback.
   */
  async transaction<T>(
    fn: (tx: DbClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel }
  ): Promise<T> {
    return prisma.$transaction(fn, options);
  }
}

export const evaluationComponentRepository = new EvaluationComponentRepository();

/**
 * The abstraction the component service depends on.
 *
 * Imported with `import type`, so it is erased at compile time and the service
 * module never pulls lib/db/prisma into its runtime graph.
 */
export type EvaluationComponentRepositoryPort = Pick<
  EvaluationComponentRepository,
  "findScheme" | "findTreeBySchemeId" | "findById" | "create" | "update" | "deleteMany" | "transaction"
>;

/**
 * The narrow slice the EVALUATION SCHEME service needs.
 *
 * Activation must verify the component tree, but the scheme service has no
 * business reading or writing individual components — so it receives exactly
 * one method rather than the whole repository. Narrowing the port is what keeps
 * the dependency honest: the type makes it impossible for scheme activation to
 * quietly start mutating components.
 */
export type EvaluationComponentTreePort = Pick<
  EvaluationComponentRepository,
  "findTreeBySchemeId"
>;
