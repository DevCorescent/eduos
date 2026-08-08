// ============================================================================
// OWNER      : Gauransh
// MODULE     : Question Paper & Solution Repository (Phase 26)
// LAYER      : Repository
// PURPOSE    : Every read and write this module needs, and nothing that decides
//              anything.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • It never evaluates a publication schedule. `findStudentPage` applies the
//     status and schedule predicate because a student-facing page MUST NOT
//     transfer invisible rows to be filtered in memory — but the predicate it
//     applies is built from the SAME domain constants the in-memory decision
//     uses, and every row it returns is re-checked by the service before being
//     mapped. Belt and braces, in the one module where a mistake serves an
//     unpublished answer key.
//
// TENANT ISOLATION
//   Every query filters on tenantId. ExamResource carries it as a real column,
//   so no join is needed to prove ownership.
//
// THE QUERY BUDGET
//   findById            1
//   findStaffPage       2 (a page and its count)
//   findStudentPage     2
//   create/update/...   1 each
//   findRegisteredCourseIds 1
//   No method contains a per-row read, so none can become an N+1 — the course,
//   semester and uploader travel with a resource through nested selects.
//
// INDEXES THIS RELIES ON
//   ExamResource @@index([tenantId, status, courseId, semesterId]) — both lists
//   ExamResource @@index([tenantId, departmentId, status]) — department repo
//   ExamResource @@index([tenantId, academicYear]) — previous-year browsing
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { ExamResourceStatus, type Prisma } from "@/app/generated/prisma/client";
import { REPORTABLE_REGISTRATION_STATUSES } from "@/lib/repositories/result.repository";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/**
 * Everything a resource is reported as, for STAFF.
 *
 * The uploader is expanded because "who put this here" is the first question an
 * HOD reviewing a department repository asks, and ExamResource.uploadedById
 * carries a real foreign key so the join is available — unlike the AuditLog
 * actor, which does not.
 */
export const EXAM_RESOURCE_SELECT = {
  id: true,
  tenantId: true,
  courseId: true,
  semesterId: true,
  departmentId: true,
  examinationId: true,
  type: true,
  title: true,
  description: true,
  academicYear: true,
  fileName: true,
  fileUrl: true,
  fileSize: true,
  mimeType: true,
  status: true,
  scheduledPublishAt: true,
  publishedAt: true,
  archivedAt: true,
  isVerified: true,
  verifiedAt: true,
  uploadedById: true,
  createdAt: true,
  updatedAt: true,
  course: { select: { code: true, name: true } },
  semester: { select: { name: true } },
  department: { select: { code: true, name: true } },
  uploadedBy: {
    select: { id: true, firstName: true, lastName: true, displayName: true, email: true },
  },
} as const;

/**
 * The projection a STUDENT receives.
 *
 * Deliberately NARROWER. A student is not shown `uploadedById` or the uploader
 * relation: who set a paper is staff information, and a student comparing
 * uploaders across papers learns something about internal process that the
 * README never grants them. `status`, `archivedAt` and the verification actor
 * are omitted for the same reason — a student sees what is available to them,
 * not the workflow that produced it.
 */
export const STUDENT_EXAM_RESOURCE_SELECT = {
  id: true,
  courseId: true,
  semesterId: true,
  examinationId: true,
  type: true,
  title: true,
  description: true,
  academicYear: true,
  fileName: true,
  fileUrl: true,
  fileSize: true,
  mimeType: true,
  status: true,
  scheduledPublishAt: true,
  publishedAt: true,
  isVerified: true,
  course: { select: { code: true, name: true } },
  semester: { select: { name: true } },
} as const;

export class ExamResourceRepository {
  /** One resource, tenant-scoped. COST: one statement. */
  async findById(tenantId: string, id: string, client: DbClient = prisma) {
    return client.examResource.findFirst({
      where: { id, tenantId },
      select: EXAM_RESOURCE_SELECT,
    });
  }

  /**
   * One page of the STAFF repository.
   *
   * Every filter is optional. `q` searches title and description, case
   * insensitively — not fileUrl, which holds storage paths a reader never sees.
   *
   * Ordering is createdAt then id, both descending. The id tiebreaker is
   * required for correctness rather than presentation: offset pagination over
   * rows sharing a timestamp can repeat or skip entries, and a bulk upload
   * writes several within one millisecond.
   *
   * COST: two statements in one transaction, so the total cannot describe a
   * wider set than the page.
   */
  async findStaffPage(
    tenantId: string,
    filter: {
      courseId?: string;
      semesterId?: string;
      departmentId?: string;
      examinationId?: string;
      type?: string;
      status?: ExamResourceStatus;
      academicYear?: string;
      isVerified?: boolean;
      q?: string;
      uploadedById?: string;
      page: number;
      limit: number;
    },
    client: DbClient = prisma
  ) {
    const where: Prisma.ExamResourceWhereInput = {
      tenantId,
      ...(filter.courseId ? { courseId: filter.courseId } : {}),
      ...(filter.semesterId ? { semesterId: filter.semesterId } : {}),
      ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
      ...(filter.examinationId ? { examinationId: filter.examinationId } : {}),
      ...(filter.type ? { type: filter.type as never } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.academicYear ? { academicYear: filter.academicYear } : {}),
      ...(filter.isVerified === undefined ? {} : { isVerified: filter.isVerified }),
      ...(filter.uploadedById ? { uploadedById: filter.uploadedById } : {}),
      ...(filter.q
        ? {
            OR: [
              { title: { contains: filter.q, mode: "insensitive" } },
              { description: { contains: filter.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await client.$transaction([
      client.examResource.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        select: EXAM_RESOURCE_SELECT,
      }),
      client.examResource.count({ where }),
    ]);

    return { rows, total };
  }

  /**
   * One page of the STUDENT repository.
   *
   * THE VISIBILITY PREDICATE IS APPLIED IN SQL, not in memory. A student-facing
   * page must not transfer rows it will then discard — a draft answer key that
   * reaches the process is one refactor away from reaching the response.
   *
   * `courseIds` is the set the student is registered for; an empty set returns
   * nothing WITHOUT querying, because `courseId: { in: [] }` is a predicate
   * that matches nothing and there is no reason to ask the database.
   *
   * COST: two statements in one transaction. Returns empty for an empty course
   * set without querying at all.
   */
  async findStudentPage(
    tenantId: string,
    courseIds: readonly string[],
    filter: {
      courseId?: string;
      semesterId?: string;
      type?: string;
      academicYear?: string;
      q?: string;
      page: number;
      limit: number;
    },
    now: Date,
    client: DbClient = prisma
  ) {
    if (courseIds.length === 0) return { rows: [], total: 0 };

    const where: Prisma.ExamResourceWhereInput = {
      tenantId,
      status: ExamResourceStatus.PUBLISHED,
      // The schedule half of the visibility rule, expressed in SQL. A null
      // schedule means "as soon as published"; a set one must have elapsed.
      OR: [{ scheduledPublishAt: null }, { scheduledPublishAt: { lte: now } }],
      courseId: filter.courseId
        ? // A student naming a course they are not registered for gets nothing,
          // rather than an error that would confirm the course exists.
          courseIds.includes(filter.courseId)
          ? filter.courseId
          : "__none__"
        : { in: [...courseIds] },
      ...(filter.semesterId ? { semesterId: filter.semesterId } : {}),
      ...(filter.type ? { type: filter.type as never } : {}),
      ...(filter.academicYear ? { academicYear: filter.academicYear } : {}),
      ...(filter.q
        ? {
            AND: [
              {
                OR: [
                  { title: { contains: filter.q, mode: "insensitive" } },
                  { description: { contains: filter.q, mode: "insensitive" } },
                ],
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await client.$transaction([
      client.examResource.findMany({
        where,
        orderBy: [{ academicYear: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        select: STUDENT_EXAM_RESOURCE_SELECT,
      }),
      client.examResource.count({ where }),
    ]);

    return { rows, total };
  }

  /**
   * One resource as a STUDENT may see it, or null.
   *
   * The same visibility predicate and the same registration confinement as the
   * list. A resource the student may not see returns null, which the service
   * turns into a 404 — never a 403, which would confirm that the resource
   * exists and is simply withheld.
   *
   * COST: one statement.
   */
  async findStudentResource(
    tenantId: string,
    id: string,
    courseIds: readonly string[],
    now: Date,
    client: DbClient = prisma
  ) {
    if (courseIds.length === 0) return null;

    return client.examResource.findFirst({
      where: {
        id,
        tenantId,
        status: ExamResourceStatus.PUBLISHED,
        courseId: { in: [...courseIds] },
        OR: [{ scheduledPublishAt: null }, { scheduledPublishAt: { lte: now } }],
      },
      select: STUDENT_EXAM_RESOURCE_SELECT,
    });
  }

  /**
   * The courses a student is registered for.
   *
   * The confinement every student-facing read depends on. The statuses that
   * count as a real registration come from Phase 16's own list rather than a
   * second copy — that question was answered once.
   *
   * COST: one statement.
   */
  async findRegisteredCourseIds(
    tenantId: string,
    studentId: string,
    client: DbClient = prisma
  ): Promise<readonly string[]> {
    const rows = await client.courseRegistration.findMany({
      where: {
        tenantId,
        studentId,
        status: { in: [...REPORTABLE_REGISTRATION_STATUSES] },
      },
      select: { courseId: true },
      distinct: ["courseId"],
    });

    return rows.map((row) => row.courseId);
  }

  /** Create a resource. COST: one statement. */
  async create(data: Prisma.ExamResourceUncheckedCreateInput, client: DbClient = prisma) {
    return client.examResource.create({ data, select: EXAM_RESOURCE_SELECT });
  }

  /**
   * Update a resource.
   *
   * Scoped by tenantId as well as id, so the write cannot reach another
   * tenant's row even if the id were guessed.
   *
   * COST: one statement.
   */
  async update(
    tenantId: string,
    id: string,
    data: Prisma.ExamResourceUpdateInput,
    client: DbClient = prisma
  ) {
    return client.examResource.update({
      where: { id, tenantId },
      data,
      select: EXAM_RESOURCE_SELECT,
    });
  }

  /**
   * Remove a resource.
   *
   * `deleteMany` rather than `delete` so a zero count is a value rather than a
   * thrown P2025 — the service turns it into the same 404 the lookup would
   * have produced, keeping a losing racer and an unknown id indistinguishable.
   *
   * COST: one statement.
   */
  async delete(tenantId: string, id: string, client: DbClient = prisma): Promise<number> {
    const result = await client.examResource.deleteMany({ where: { id, tenantId } });

    return result.count;
  }

  /** Confirm a course exists in this tenant, and report its department. */
  async findCourse(tenantId: string, courseId: string, client: DbClient = prisma) {
    return client.course.findFirst({
      where: { id: courseId, tenantId },
      select: { id: true, departmentId: true },
    });
  }

  /** Confirm a semester exists in this tenant. */
  async semesterExists(
    tenantId: string,
    semesterId: string,
    client: DbClient = prisma
  ): Promise<boolean> {
    const found = await client.semester.findFirst({
      where: { id: semesterId, tenantId },
      select: { id: true },
    });

    return found !== null;
  }

  /** Resolve the caller to the Student they ARE. */
  async findStudentByUserId(tenantId: string, userId: string, client: DbClient = prisma) {
    return client.student.findFirst({
      where: { userId, tenantId },
      select: { id: true },
    });
  }

  /** Run a unit of work atomically. The service decides the BOUNDARY. */
  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }
}

export const examResourceRepository = new ExamResourceRepository();

/** The abstraction the service depends on. Imported as `import type`. */
export type ExamResourceRepositoryPort = Pick<
  ExamResourceRepository,
  | "findById"
  | "findStaffPage"
  | "findStudentPage"
  | "findStudentResource"
  | "findRegisteredCourseIds"
  | "create"
  | "update"
  | "delete"
  | "findCourse"
  | "semesterExists"
  | "findStudentByUserId"
  | "transaction"
>;
