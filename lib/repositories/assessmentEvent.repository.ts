// ============================================================================
// OWNER      : Gauransh
// MODULE     : Assessment Event
// LAYER      : Repository
// PURPOSE    : Prisma data access for AssessmentEvent, plus the reference
//              lookups this module needs and no existing repository owns.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • No sequence arithmetic, no lifecycle rules, no maxMarks defaulting, no
//     scheme-activation checks, no DTO mapping.
//
// WHY SOME REFERENCE LOOKUPS LIVE HERE AND OTHERS DO NOT
//   Course, Semester, Section and FacultyMember have no repositories anywhere
//   in this project, so their lookups live beside the module that needs them —
//   the same precedent C3 and C5.5 set. EvaluationComponent DOES have one, so
//   the service injects it as a narrow port instead of a second definition
//   being written here.
//
// TENANCY: every query is anchored on tenantId, reference lookups included. A
//          sitting created against another tenant's course would be a
//          cross-tenant academic record, and resolving the course tenant-scoped
//          is the only thing preventing it.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import type { AssessmentEventStatus, Prisma } from "@/app/generated/prisma/client";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/**
 * Columns returned for a sitting.
 *
 * Declared once so every read answers with the same shape. No relation is
 * expanded: a caller listing an assessment calendar already holds the course
 * and term it filtered by, and joining the component per row would be a cost
 * paid for an id the caller can resolve once.
 */
export const ASSESSMENT_EVENT_SELECT = {
  id: true,
  tenantId: true,
  evaluationComponentId: true,
  courseId: true,
  semesterId: true,
  sectionId: true,
  title: true,
  maxMarks: true,
  sequenceNumber: true,
  scheduledAt: true,
  conductedById: true,
  status: true,
  statusChangedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type AssessmentEventRecord = Prisma.AssessmentEventGetPayload<{
  select: typeof ASSESSMENT_EVENT_SELECT;
}>;

/**
 * Fixed list ordering: the assessment calendar, in the order it is read.
 *
 * Scheduled date first — an assessment calendar is a timeline — then the
 * sitting number, then `id`. The last key makes the order TOTAL, which offset
 * pagination requires: without it a row could repeat on one page and vanish
 * from the next. `scheduledAt` alone cannot do it, because it is nullable and
 * because a whole term's sittings are often created in one batch.
 */
export const ASSESSMENT_EVENT_LIST_ORDER_BY: Prisma.AssessmentEventOrderByWithRelationInput[] = [
  { scheduledAt: "asc" },
  { sequenceNumber: "asc" },
  { id: "asc" },
];

/** Index-backed filters accepted by the list query. */
export interface AssessmentEventFilter {
  courseId?: string;
  semesterId?: string;
  sectionId?: string;
  evaluationComponentId?: string;
  status?: AssessmentEventStatus;
}

/** Columns written when a sitting is created. */
export interface CreateAssessmentEventData {
  tenantId: string;
  evaluationComponentId: string;
  courseId: string;
  semesterId: string;
  sectionId: string | null;
  title: string;
  maxMarks: number;
  sequenceNumber: number;
  scheduledAt: Date | null;
  conductedById: string | null;
}

/** Columns writable on an existing sitting. Omit to leave unchanged. */
export interface UpdateAssessmentEventData {
  title?: string;
  maxMarks?: number;
  scheduledAt?: Date;
  conductedById?: string | null;
  status?: AssessmentEventStatus;
  statusChangedAt?: Date;
}

export class AssessmentEventRepository {
  /**
   * One page of sittings, with the total for the same predicate.
   *
   * COMPLEXITY : O(log n + k) for the page. A calendar filter (semesterId +
   *              courseId) rides @@index([tenantId, semesterId, courseId]).
   * ATOMICITY  : both statements run in one transaction so the total cannot
   *              shift between them and describe a page that does not exist.
   */
  async listWithCount(
    tenantId: string,
    filter: AssessmentEventFilter,
    skip: number,
    take: number,
    departmentId: string | null = null
  ): Promise<[AssessmentEventRecord[], number]> {
    const where: Prisma.AssessmentEventWhereInput = {
      tenantId,
      // AUTHORIZATION, not a filter. `departmentId` is resolved from the
      // authenticated subject by resolveDepartmentScope and is null for every
      // caller who is not narrowed. It sits on `course`, a DIFFERENT key from
      // the caller's own `courseId` filter below, so the two INTERSECT rather
      // than one replacing the other — a head asking for another department's
      // course matches nothing instead of escaping the restriction.
      ...(departmentId === null ? {} : { course: { departmentId } }),
      ...(filter.courseId === undefined ? {} : { courseId: filter.courseId }),
      ...(filter.semesterId === undefined ? {} : { semesterId: filter.semesterId }),
      ...(filter.sectionId === undefined ? {} : { sectionId: filter.sectionId }),
      ...(filter.evaluationComponentId === undefined
        ? {}
        : { evaluationComponentId: filter.evaluationComponentId }),
      ...(filter.status === undefined ? {} : { status: filter.status }),
    };

    return prisma.$transaction([
      prisma.assessmentEvent.findMany({
        where,
        orderBy: ASSESSMENT_EVENT_LIST_ORDER_BY,
        skip,
        take,
        select: ASSESSMENT_EVENT_SELECT,
      }),
      prisma.assessmentEvent.count({ where }),
    ]);
  }

  /**
   * One sitting, tenant-scoped.
   *
   * COMPLEXITY : O(log n) on the primary key with a tenant predicate.
   */
  /**
   * Does this department own the course a sitting belongs to?
   *
   * Kept apart from findById rather than folded into its `where` because
   * findById is also the read half of the write paths, which pass a transaction
   * client positionally. Adding an authorization parameter there would have
   * meant either reordering that signature or importing prisma into the
   * service, which the port exists to prevent.
   *
   * tenantId is in the predicate as well: a department id is opaque, and
   * pairing the two means a wrong one cannot reach another institution.
   */
  async courseBelongsToDepartment(
    tenantId: string,
    courseId: string,
    departmentId: string
  ): Promise<boolean> {
    const course = await prisma.course.findFirst({
      where: { id: courseId, tenantId, departmentId },
      select: { id: true },
    });

    return course !== null;
  }

  async findById(
    tenantId: string,
    id: string,
    client: DbClient = prisma
  ): Promise<AssessmentEventRecord | null> {
    return client.assessmentEvent.findFirst({
      where: { id, tenantId },
      select: ASSESSMENT_EVENT_SELECT,
    });
  }

  /**
   * The highest sitting number already used for one component, course, term and
   * teaching group.
   *
   * An aggregate rather than a findMany: the service needs one number, and
   * pulling every sibling row to compute a maximum in Node would move work the
   * database does with an index scan. Returns null when no sitting exists yet.
   *
   * The sectionId predicate is EXACT, including the null case — a cohort-wide
   * sitting and a section-scoped one are separate series, which is what the
   * unique constraint says too.
   *
   * COMPLEXITY : O(log n) — an index-backed max over the sibling set.
   */
  async findMaxSequence(
    tenantId: string,
    evaluationComponentId: string,
    courseId: string,
    semesterId: string,
    sectionId: string | null,
    client: DbClient = prisma
  ): Promise<number | null> {
    const result = await client.assessmentEvent.aggregate({
      where: { tenantId, evaluationComponentId, courseId, semesterId, sectionId },
      _max: { sequenceNumber: true },
    });

    return result._max.sequenceNumber;
  }

  /**
   * Insert one sitting.
   *
   * COMPLEXITY : O(log n) — one INSERT plus maintenance of two unique indexes
   *              and one secondary index.
   */
  async create(
    data: CreateAssessmentEventData,
    client: DbClient = prisma
  ): Promise<AssessmentEventRecord> {
    return client.assessmentEvent.create({
      data,
      select: ASSESSMENT_EVENT_SELECT,
    });
  }

  /**
   * Update one sitting, tenant-scoped in the same statement.
   *
   * Uses the tenantId_id compound selector generated from
   * @@unique([tenantId, id]), so the write carries its own tenant predicate
   * rather than inheriting one from a preceding read.
   *
   * COMPLEXITY : O(log n).
   */
  async update(
    tenantId: string,
    id: string,
    data: UpdateAssessmentEventData,
    client: DbClient = prisma
  ): Promise<AssessmentEventRecord> {
    return client.assessmentEvent.update({
      where: { tenantId_id: { tenantId, id } },
      data,
      select: ASSESSMENT_EVENT_SELECT,
    });
  }

  // --- Reference lookups ----------------------------------------------------

  /**
   * An evaluation component, resolved by id alone within the tenant.
   *
   * EvaluationComponent HAS a repository, and this is deliberately not a
   * duplicate of its findById: that one is scheme-scoped, because every caller
   * there already knows the regulation it is editing. A sitting does not — the
   * scheme is precisely what it learns FROM the component — so a scheme-scoped
   * lookup cannot serve it.
   *
   * `schemeId` is selected because the service needs it to check that the
   * regulation is ACTIVE; `maxMarks` because it is the default this sitting is
   * marked out of.
   *
   * COMPLEXITY : O(log n) on EvaluationComponent's @@unique([tenantId, id]).
   */
  async findComponent(
    tenantId: string,
    componentId: string,
    client: DbClient = prisma
  ): Promise<{ id: string; schemeId: string; maxMarks: Prisma.Decimal } | null> {
    return client.evaluationComponent.findFirst({
      where: { id: componentId, tenantId },
      select: { id: true, schemeId: true, maxMarks: true },
    });
  }

  /**
   * A course, tenant-scoped.
   *
   * COMPLEXITY : O(log n).
   */
  async findCourse(
    tenantId: string,
    courseId: string,
    client: DbClient = prisma
  ): Promise<{ id: string } | null> {
    return client.course.findFirst({
      where: { id: courseId, tenantId },
      select: { id: true },
    });
  }

  /**
   * A semester, tenant-scoped.
   *
   * COMPLEXITY : O(log n).
   */
  async findSemester(
    tenantId: string,
    semesterId: string,
    client: DbClient = prisma
  ): Promise<{ id: string } | null> {
    return client.semester.findFirst({
      where: { id: semesterId, tenantId },
      select: { id: true },
    });
  }

  /**
   * A section, tenant-scoped.
   *
   * COMPLEXITY : O(log n).
   */
  async findSection(
    tenantId: string,
    sectionId: string,
    client: DbClient = prisma
  ): Promise<{ id: string } | null> {
    return client.section.findFirst({
      where: { id: sectionId, tenantId },
      select: { id: true },
    });
  }

  /**
   * A faculty member, tenant-scoped.
   *
   * COMPLEXITY : O(log n).
   */
  async findFaculty(
    tenantId: string,
    facultyId: string,
    client: DbClient = prisma
  ): Promise<{ id: string } | null> {
    return client.facultyMember.findFirst({
      where: { id: facultyId, tenantId },
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

export const assessmentEventRepository = new AssessmentEventRepository();

/**
 * The abstraction the assessment-event service depends on.
 *
 * Imported with `import type`, so it is erased at compile time and the service
 * module never pulls lib/db/prisma into its runtime graph.
 */
export type AssessmentEventRepositoryPort = Pick<
  AssessmentEventRepository,
  | "listWithCount"
  | "findById"
  | "courseBelongsToDepartment"
  | "findMaxSequence"
  | "create"
  | "update"
  | "findComponent"
  | "findCourse"
  | "findSemester"
  | "findSection"
  | "findFaculty"
  | "transaction"
>;

/**
 * The narrow slice the marks engine will depend on.
 *
 * Declared now and narrow on purpose: C6.2 must read a sitting to decide
 * whether it accepts marks, and must provably never create one or move it
 * through its lifecycle.
 */
export type AssessmentEventLookupPort = Pick<AssessmentEventRepository, "findById">;
