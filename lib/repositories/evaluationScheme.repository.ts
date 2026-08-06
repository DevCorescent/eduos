// ============================================================================
// OWNER      : Gauransh
// MODULE     : Evaluation Scheme
// LAYER      : Repository
// PURPOSE    : Prisma data access for EvaluationScheme and the one GradeScale
//              fact the module must verify.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • No version arithmetic.
//   • No status-transition rules.
//   • No immutability enforcement.
//   • No DTO mapping.
//   • Every method takes exactly the arguments its query needs and returns rows
//     unchanged. The service decides what any of it means.
//
// TENANCY: every query is anchored on tenantId. The tenantId_id compound
//          selector used by update() and delete() exists because C2 declared
//          @@unique([tenantId, id]) — added there as a composite-foreign-key
//          target, and reused here so a write is tenant-scoped in the SAME
//          statement rather than by a preceding read the row could outlive.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import type {
  AttemptPolicy,
  EvaluationSchemeStatus,
  Prisma,
  RoundingMode,
} from "@/app/generated/prisma/client";

/**
 * A Prisma client or an interactive transaction handle.
 *
 * Every read and write accepts one so the service can compose several calls
 * into a single atomic unit without the repository knowing where a transaction
 * begins or ends.
 */
export type DbClient = Prisma.TransactionClient;

/**
 * Columns returned for a scheme in a list.
 *
 * Declared once and reused, so the list and detail shapes cannot drift. No
 * relation is expanded: the list renders configuration rows, and joining the
 * grade scale for every row of every page would buy a per-row join for a column
 * the list does not display.
 */
export const EVALUATION_SCHEME_SELECT = {
  id: true,
  tenantId: true,
  code: true,
  name: true,
  description: true,
  version: true,
  status: true,
  gradeScaleId: true,
  attemptPolicy: true,
  marksRounding: true,
  marksPrecision: true,
  gpaRounding: true,
  gpaPrecision: true,
  supersededById: true,
  activatedAt: true,
  activatedById: true,
  archivedAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Columns returned for a single scheme, with its cited grade scale resolved.
 *
 * One query with a join, never a second round trip — the classic N+1 this
 * module must not introduce. maxGradePoint is selected because the DTO reports
 * it; the scale's bands are not, because they belong to the grade-scale
 * endpoint.
 */
export const EVALUATION_SCHEME_DETAIL_SELECT = {
  ...EVALUATION_SCHEME_SELECT,
  gradeScale: {
    select: {
      id: true,
      code: true,
      name: true,
      version: true,
      status: true,
      method: true,
      maxGradePoint: true,
    },
  },
} as const;

export type EvaluationSchemeRecord = Prisma.EvaluationSchemeGetPayload<{
  select: typeof EVALUATION_SCHEME_SELECT;
}>;

export type EvaluationSchemeDetailRecord = Prisma.EvaluationSchemeGetPayload<{
  select: typeof EVALUATION_SCHEME_DETAIL_SELECT;
}>;

/**
 * Fixed list ordering: regulation family, then newest revision first.
 *
 * Offset pagination over an unordered set can repeat or skip rows between
 * pages, so the order must be total. (code, version) is unique within a tenant
 * by @@unique([tenantId, code, version]), which makes it a complete tiebreak
 * with no third key required — and lets PostgreSQL read the page straight from
 * that index with no sort step.
 */
const LIST_ORDER_BY: Prisma.EvaluationSchemeOrderByWithRelationInput[] = [
  { code: "asc" },
  { version: "desc" },
];

/** The three facts the service needs about a revision to reason about versions. */
export interface EvaluationSchemeVersionRecord {
  id: string;
  version: number;
  status: EvaluationSchemeStatus;
}

/** The only two facts the service needs about a cited grade scale. */
export interface GradeScaleReferenceRecord {
  id: string;
  status: string;
}

/** Index-backed filters accepted by the list query. */
export interface EvaluationSchemeFilter {
  status?: EvaluationSchemeStatus;
  code?: string;
  gradeScaleId?: string;
}

/** Columns written when a revision is created. */
export interface CreateEvaluationSchemeData {
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  version: number;
  gradeScaleId: string;
  attemptPolicy?: AttemptPolicy;
  marksRounding?: RoundingMode;
  marksPrecision?: number;
  gpaRounding?: RoundingMode;
  gpaPrecision?: number;
  createdById: string | null;
}

/**
 * Columns writable on an existing revision.
 *
 * Deliberately wider than the PATCH contract: it also carries the lifecycle
 * columns, because activation and archival are updates too. Which subset any
 * caller may set is a business rule the service enforces — the repository
 * refuses nothing.
 */
export interface UpdateEvaluationSchemeData {
  name?: string;
  description?: string | null;
  gradeScaleId?: string;
  attemptPolicy?: AttemptPolicy;
  marksRounding?: RoundingMode;
  marksPrecision?: number;
  gpaRounding?: RoundingMode;
  gpaPrecision?: number;
  status?: EvaluationSchemeStatus;
  activatedAt?: Date;
  activatedById?: string | null;
  archivedAt?: Date;
  supersededById?: string | null;
}

export class EvaluationSchemeRepository {
  /**
   * One page of schemes, with the total for the same predicate.
   *
   * COMPLEXITY : O(log n + k) for the page — every filter is index-backed:
   *              status rides @@index([tenantId, status]), code rides the
   *              leading columns of @@unique([tenantId, code, version]), and
   *              gradeScaleId rides @@index([tenantId, gradeScaleId]). The
   *              count is O(matching rows) in PostgreSQL, which is why no
   *              free-text filter is offered.
   * ATOMICITY  : both statements run in one transaction so the total cannot
   *              shift between them and report a page that does not exist.
   */
  async listWithCount(
    tenantId: string,
    filter: EvaluationSchemeFilter,
    skip: number,
    take: number
  ): Promise<[EvaluationSchemeRecord[], number]> {
    const where: Prisma.EvaluationSchemeWhereInput = {
      tenantId,
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...(filter.code === undefined ? {} : { code: filter.code }),
      ...(filter.gradeScaleId === undefined ? {} : { gradeScaleId: filter.gradeScaleId }),
    };

    return prisma.$transaction([
      prisma.evaluationScheme.findMany({
        where,
        orderBy: LIST_ORDER_BY,
        skip,
        take,
        select: EVALUATION_SCHEME_SELECT,
      }),
      prisma.evaluationScheme.count({ where }),
    ]);
  }

  /**
   * One scheme, tenant-scoped, without its grade scale.
   *
   * findFirst rather than findUnique so the tenant filter is part of the lookup
   * — another tenant's scheme can never be resolved or acknowledged.
   *
   * COMPLEXITY : O(log n) on the primary key with a tenant predicate.
   */
  async findById(
    tenantId: string,
    id: string,
    client: DbClient = prisma
  ): Promise<EvaluationSchemeRecord | null> {
    return client.evaluationScheme.findFirst({
      where: { id, tenantId },
      select: EVALUATION_SCHEME_SELECT,
    });
  }

  /**
   * One scheme with its cited grade scale, in a single joined query.
   *
   * COMPLEXITY : O(log n) — primary-key lookup plus one index join on the
   *              scale's own key.
   */
  async findDetailById(
    tenantId: string,
    id: string,
    client: DbClient = prisma
  ): Promise<EvaluationSchemeDetailRecord | null> {
    return client.evaluationScheme.findFirst({
      where: { id, tenantId },
      select: EVALUATION_SCHEME_DETAIL_SELECT,
    });
  }

  /**
   * Every revision of one regulation code, newest first.
   *
   * Answers two questions in ONE query that would otherwise be two: what the
   * highest version number is, and whether a draft revision already exists. The
   * service derives both from this array.
   *
   * COMPLEXITY : O(log n + v) where v is the number of revisions of this code —
   *              bounded by how often a university rewrites a regulation, so a
   *              handful in practice and never a scan. Rides the leading
   *              columns of @@unique([tenantId, code, version]), which also
   *              supplies the ordering, so PostgreSQL performs no sort.
   */
  async findVersionsByCode(
    tenantId: string,
    code: string,
    client: DbClient = prisma
  ): Promise<EvaluationSchemeVersionRecord[]> {
    return client.evaluationScheme.findMany({
      where: { tenantId, code },
      orderBy: { version: "desc" },
      select: { id: true, version: true, status: true },
    });
  }

  /**
   * The currently active revision of a regulation code, if any.
   *
   * COMPLEXITY : O(log n) on @@index([tenantId, status]) narrowed by code.
   */
  async findActiveByCode(
    tenantId: string,
    code: string,
    status: EvaluationSchemeStatus,
    client: DbClient = prisma
  ): Promise<{ id: string } | null> {
    return client.evaluationScheme.findFirst({
      where: { tenantId, code, status },
      select: { id: true },
    });
  }

  /**
   * The cited grade scale, tenant-scoped.
   *
   * Selects only what the service must decide on. Reading the whole scale — let
   * alone its bands — to answer "does it exist and is it active" would be
   * bandwidth spent on a question two columns answer.
   *
   * COMPLEXITY : O(log n) on GradeScale's @@unique([tenantId, id]).
   */
  async findGradeScale(
    tenantId: string,
    gradeScaleId: string,
    client: DbClient = prisma
  ): Promise<GradeScaleReferenceRecord | null> {
    return client.gradeScale.findFirst({
      where: { id: gradeScaleId, tenantId },
      select: { id: true, status: true },
    });
  }

  /**
   * Insert one revision.
   *
   * Columns absent from the payload keep their schema defaults — status DRAFT
   * and the four rounding/attempt defaults — so an omitted policy is stored as
   * the declared default rather than as null.
   *
   * COMPLEXITY : O(log n) — one INSERT plus the unique and index maintenance
   *              declared on the model.
   */
  async create(
    data: CreateEvaluationSchemeData,
    client: DbClient = prisma
  ): Promise<EvaluationSchemeDetailRecord> {
    return client.evaluationScheme.create({
      data,
      select: EVALUATION_SCHEME_DETAIL_SELECT,
    });
  }

  /**
   * Update one revision, tenant-scoped in the same statement.
   *
   * The tenantId_id compound selector is generated from C2's
   * @@unique([tenantId, id]). Using it rather than `where: { id }` means the
   * write itself carries the tenant predicate, so a row that changed ownership
   * between a preceding read and this write could not be updated — an
   * impossible state today, and one this selector keeps impossible.
   *
   * COMPLEXITY : O(log n) — single-row update on a unique index.
   */
  async update(
    tenantId: string,
    id: string,
    data: UpdateEvaluationSchemeData,
    client: DbClient = prisma
  ): Promise<EvaluationSchemeDetailRecord> {
    return client.evaluationScheme.update({
      where: { tenantId_id: { tenantId, id } },
      data,
      select: EVALUATION_SCHEME_DETAIL_SELECT,
    });
  }

  /**
   * Remove one revision, tenant-scoped in the same statement.
   *
   * COMPLEXITY : O(log n) plus the cascade to any EvaluationComponent rows the
   *              revision owns.
   */
  async delete(tenantId: string, id: string, client: DbClient = prisma): Promise<void> {
    await client.evaluationScheme.delete({
      where: { tenantId_id: { tenantId, id } },
      select: { id: true },
    });
  }

  /**
   * Run a unit of work atomically.
   *
   * The repository owns the Prisma handle, so the transaction is opened here;
   * the service decides its BOUNDARY by choosing what to put inside the
   * callback. That split is what keeps `import { prisma }` out of the service
   * while leaving the service in charge of atomicity.
   *
   * `isolationLevel` is exposed because the activation path needs SERIALIZABLE:
   * the single-ACTIVE-revision invariant is a write-skew hazard that no row
   * lock can close, since two concurrent activations of two different drafts
   * touch two different rows and contend on nothing.
   */
  async transaction<T>(
    fn: (tx: DbClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel }
  ): Promise<T> {
    return prisma.$transaction(fn, options);
  }
}

export const evaluationSchemeRepository = new EvaluationSchemeRepository();

/**
 * The abstraction the service layer depends on.
 *
 * The service imports this as `import type`, so the dependency is erased at
 * compile time and the service's runtime module graph never reaches
 * lib/db/prisma. That is what lets evaluationScheme.service.test.ts construct
 * the service against a fake with no database, no DATABASE_URL and no network.
 */
export type EvaluationSchemeRepositoryPort = Pick<
  EvaluationSchemeRepository,
  | "listWithCount"
  | "findById"
  | "findDetailById"
  | "findVersionsByCode"
  | "findActiveByCode"
  | "findGradeScale"
  | "create"
  | "update"
  | "delete"
  | "transaction"
>;
