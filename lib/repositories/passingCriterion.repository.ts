// ============================================================================
// OWNER      : Gauransh
// MODULE     : Passing Criterion
// LAYER      : Repository
// PURPOSE    : Prisma data access for PassingCriterion.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • No metric/unit coherence rules, no scope derivation, no threshold
//     comparison against a component's maximum, no DTO mapping.
//
// WHAT THIS REPOSITORY DELIBERATELY DOES NOT QUERY
//   Neither the owning scheme nor the target component, for the same reason as
//   the rule repository: both already expose findById, and the service injects
//   them as narrow ports. In particular, the threshold <= component.maxMarks
//   check reuses the component repository's existing read rather than adding a
//   maxMarks-only query here — one more definition of a lookup that exists.
//
// TENANCY: every query is anchored on tenantId, and every scheme-scoped query
//          on schemeId as well.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import type {
  CriterionOutcome,
  PassingMetric,
  Prisma,
  ThresholdUnit,
} from "@/app/generated/prisma/client";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/**
 * Columns returned for a criterion.
 *
 * Declared once so every read answers with the same shape. No relation is
 * expanded: the scheme is known from the route and the component is reported as
 * an id the caller already holds from the component tree.
 */
export const PASSING_CRITERION_SELECT = {
  id: true,
  tenantId: true,
  schemeId: true,
  componentId: true,
  code: true,
  name: true,
  description: true,
  metric: true,
  threshold: true,
  unit: true,
  failureOutcome: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type PassingCriterionRecord = Prisma.PassingCriterionGetPayload<{
  select: typeof PASSING_CRITERION_SELECT;
}>;

/**
 * Fixed ordering: metric, then code.
 *
 * PassingMetric is declared COMPONENT_SCORE, ATTENDANCE_PERCENT,
 * SEMESTER_CREDITS_EARNED, and PostgreSQL orders an enum by declaration order,
 * so this groups the per-component requirements ahead of the eligibility ones —
 * the order a regulation reads in.
 *
 * Unlike the rule pipeline, this ordering is PRESENTATIONAL only. Criteria form
 * a conjunction, so evaluating them in a different order cannot change the
 * result; the order exists so two identical requests render identically. `code`
 * makes it total, since it is unique within a scheme.
 */
const CRITERION_ORDER_BY: Prisma.PassingCriterionOrderByWithRelationInput[] = [
  { metric: "asc" },
  { code: "asc" },
];

/** Columns written when a criterion is created. */
export interface CreatePassingCriterionData {
  tenantId: string;
  schemeId: string;
  componentId: string | null;
  code: string;
  name: string;
  description: string | null;
  metric: PassingMetric;
  threshold: number;
  unit: ThresholdUnit;
  failureOutcome: CriterionOutcome;
}

/** Columns writable on an existing criterion. Omit to leave unchanged. */
export interface UpdatePassingCriterionData {
  componentId?: string | null;
  code?: string;
  name?: string;
  description?: string | null;
  metric?: PassingMetric;
  threshold?: number;
  unit?: ThresholdUnit;
  failureOutcome?: CriterionOutcome;
}

export class PassingCriterionRepository {
  /**
   * One scheme's entire criterion set.
   *
   * Every operation begins with this — reads, writes and the duplicate checks
   * alike — so the module never issues a query per criterion.
   *
   * COMPLEXITY : O(log n + p) where p is the criterion count of ONE scheme, two
   *              to six in practice. Rides @@unique([schemeId, code]), whose
   *              leading column is schemeId.
   */
  async findAllBySchemeId(
    tenantId: string,
    schemeId: string,
    client: DbClient = prisma
  ): Promise<PassingCriterionRecord[]> {
    return client.passingCriterion.findMany({
      where: { tenantId, schemeId },
      orderBy: CRITERION_ORDER_BY,
      select: PASSING_CRITERION_SELECT,
    });
  }

  /**
   * One criterion, scoped to both its tenant and its scheme.
   *
   * COMPLEXITY : O(log n).
   */
  async findById(
    tenantId: string,
    schemeId: string,
    criterionId: string,
    client: DbClient = prisma
  ): Promise<PassingCriterionRecord | null> {
    return client.passingCriterion.findFirst({
      where: { id: criterionId, tenantId, schemeId },
      select: PASSING_CRITERION_SELECT,
    });
  }

  /**
   * Insert one criterion.
   *
   * COMPLEXITY : O(log n) — one INSERT plus maintenance of two unique indexes
   *              and one secondary index.
   */
  async create(
    data: CreatePassingCriterionData,
    client: DbClient = prisma
  ): Promise<PassingCriterionRecord> {
    return client.passingCriterion.create({
      data,
      select: PASSING_CRITERION_SELECT,
    });
  }

  /**
   * Update one criterion, tenant-scoped in the same statement.
   *
   * COMPLEXITY : O(log n).
   */
  async update(
    tenantId: string,
    criterionId: string,
    data: UpdatePassingCriterionData,
    client: DbClient = prisma
  ): Promise<PassingCriterionRecord> {
    return client.passingCriterion.update({
      where: { tenantId_id: { tenantId, id: criterionId } },
      data,
      select: PASSING_CRITERION_SELECT,
    });
  }

  /**
   * Remove one criterion, tenant-scoped in the same statement.
   *
   * COMPLEXITY : O(log n).
   */
  async delete(
    tenantId: string,
    criterionId: string,
    client: DbClient = prisma
  ): Promise<void> {
    await client.passingCriterion.delete({
      where: { tenantId_id: { tenantId, id: criterionId } },
      select: { id: true },
    });
  }

  /**
   * Run a unit of work atomically.
   *
   * The repository owns the Prisma handle; the service decides the boundary.
   */
  async transaction<T>(
    fn: (tx: DbClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel }
  ): Promise<T> {
    return prisma.$transaction(fn, options);
  }
}

export const passingCriterionRepository = new PassingCriterionRepository();

/**
 * The abstraction the criterion service depends on.
 *
 * Imported with `import type`, so the service module never pulls lib/db/prisma
 * into its runtime graph.
 */
export type PassingCriterionRepositoryPort = Pick<
  PassingCriterionRepository,
  "findAllBySchemeId" | "findById" | "create" | "update" | "delete" | "transaction"
>;

/**
 * The narrow slice a future calculation engine needs.
 *
 * The engine evaluates criteria and must provably never mutate one.
 */
export type PassingCriterionSetPort = Pick<PassingCriterionRepository, "findAllBySchemeId">;
