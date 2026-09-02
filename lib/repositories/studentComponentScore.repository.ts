// ============================================================================
// OWNER      : Gauransh
// MODULE     : Student Component Score
// LAYER      : Repository
// PURPOSE    : Prisma data access for the marks table, plus the two lookups
//              this module needs and no existing repository owns.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • No status invariants, no roster validation, no scheme comparison, no
//     change detection, no DTO mapping.
//
// THE QUERY SHAPES THAT MATTER
//   Every read here is SET-BASED. There is deliberately no findByRegistration,
//   no findOne-per-student and no per-row existence check — each would be an
//   N+1 waiting to be written by the next person, and a thousand-row upload is
//   the operation this module exists to serve.
//
//   findExisting takes the whole registration set and answers in one statement;
//   createMany writes every new mark in one more. What is left is one UPDATE per
//   genuinely CHANGED mark, which is discussed in the service.
//
// TENANCY: every query is anchored on tenantId. On the largest table in the
//          phase that is not a convenience — it is what keeps a tenant-scoped
//          read an index seek rather than a join.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import type {
  EvaluationSchemeStatus,
  MarkStatus,
  Prisma,
  RegistrationStatus,
} from "@/app/generated/prisma/client";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/** Columns returned for a mark. Declared once so every read answers alike. */
export const STUDENT_COMPONENT_SCORE_SELECT = {
  id: true,
  tenantId: true,
  assessmentEventId: true,
  courseRegistrationId: true,
  marksObtained: true,
  status: true,
  remarks: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type StudentComponentScoreRecord = Prisma.StudentComponentScoreGetPayload<{
  select: typeof STUDENT_COMPONENT_SCORE_SELECT;
}>;

/**
 * Fixed marks-sheet ordering.
 *
 * By registration id, then row id. Not by student name — this repository has no
 * business joining a student to sort a marks sheet, and the caller that needs
 * names holds them already. `id` last makes the order TOTAL, so two identical
 * requests render identically even though a bulk upload writes every row in one
 * statement and they share a createdAt.
 */
export const MARKS_SHEET_ORDER_BY: Prisma.StudentComponentScoreOrderByWithRelationInput[] = [
  { courseRegistrationId: "asc" },
  { id: "asc" },
];

/** Columns written when a mark is created. */
export interface CreateStudentComponentScoreData {
  tenantId: string;
  assessmentEventId: string;
  courseRegistrationId: string;
  marksObtained: number | null;
  status: MarkStatus;
  remarks: string | null;
}

/** Columns writable on an existing mark. */
export interface UpdateStudentComponentScoreData {
  marksObtained: number | null;
  status: MarkStatus;
  remarks: string | null;
}

/** The facts the service needs about the sitting being marked. */
export interface MarkingEventRecord {
  id: string;
  evaluationComponentId: string;
  courseId: string;
  semesterId: string;
  sectionId: string | null;
  maxMarks: Prisma.Decimal;
  status: string;
  conductedById: string | null;
}

/** The facts the service needs about each registration being marked. */
export interface MarkableRegistrationRecord {
  id: string;
  courseId: string;
  semesterId: string;
  sectionId: string | null;
  evaluationSchemeId: string;
  status: RegistrationStatus;
}

/** The component and the status of the regulation that governs it. */
export interface GoverningSchemeRecord {
  componentId: string;
  schemeId: string;
  schemeStatus: EvaluationSchemeStatus;
}

export class StudentComponentScoreRepository {
  /**
   * Every mark at one sitting.
   *
   * The marks sheet, and the read a result computation consumes for one
   * assessment. Rides the leading column of
   * @@unique([assessmentEventId, courseRegistrationId]).
   *
   * COMPLEXITY : O(log n + k) for a class of k.
   */
  async findByEvent(
    tenantId: string,
    assessmentEventId: string,
    client: DbClient = prisma
  ): Promise<StudentComponentScoreRecord[]> {
    return client.studentComponentScore.findMany({
      where: { tenantId, assessmentEventId },
      orderBy: MARKS_SHEET_ORDER_BY,
      select: STUDENT_COMPONENT_SCORE_SELECT,
    });
  }

  /**
   * The marks that already exist for a SET of registrations at one sitting.
   *
   * The keystone read of the upload path. It answers, for the whole batch in
   * one statement, which marks are new and which are amendments — the question
   * a per-row existence check would ask a thousand times.
   *
   * COMPLEXITY : O(log n + b) for a batch of b. Rides the same unique index.
   */
  async findExisting(
    tenantId: string,
    assessmentEventId: string,
    courseRegistrationIds: readonly string[],
    client: DbClient = prisma
  ): Promise<StudentComponentScoreRecord[]> {
    if (courseRegistrationIds.length === 0) {
      return [];
    }

    return client.studentComponentScore.findMany({
      where: {
        tenantId,
        assessmentEventId,
        courseRegistrationId: { in: [...courseRegistrationIds] },
      },
      select: STUDENT_COMPONENT_SCORE_SELECT,
    });
  }

  /**
   * Insert every new mark in ONE statement.
   *
   * skipDuplicates is deliberately NOT set. The service has already resolved
   * which rows are new from findExisting, so a unique violation surviving to
   * here means a concurrent uploader took the same slot — a real conflict that
   * must surface as a 409 rather than be silently swallowed.
   *
   * COMPLEXITY : O(n log n) for n rows — one statement, index maintenance per
   *              row.
   */
  async createMany(
    data: readonly CreateStudentComponentScoreData[],
    client: DbClient = prisma
  ): Promise<number> {
    if (data.length === 0) {
      return 0;
    }

    const result = await client.studentComponentScore.createMany({ data: [...data] });
    return result.count;
  }

  /**
   * Amend one existing mark, tenant-scoped in the same statement.
   *
   * Selected by the NATURAL key rather than by row id, so the write carries its
   * own tenant, sitting and registration predicate — a mark cannot be moved to
   * another sitting by a stale id.
   *
   * COMPLEXITY : O(log n).
   */
  async updateByNaturalKey(
    tenantId: string,
    assessmentEventId: string,
    courseRegistrationId: string,
    data: UpdateStudentComponentScoreData,
    client: DbClient = prisma
  ): Promise<number> {
    const result = await client.studentComponentScore.updateMany({
      where: { tenantId, assessmentEventId, courseRegistrationId },
      data,
    });

    return result.count;
  }

  // --- Reference lookups ----------------------------------------------------

  /**
   * The sitting being marked, with everything the service must check.
   *
   * One read rather than several: the status decides whether marks are accepted
   * at all, maxMarks bounds every value, the course, term and teaching group
   * decide which registrations are eligible, and conductedById decides whether
   * a lecturer may write here.
   *
   * COMPLEXITY : O(log n) on AssessmentEvent's @@unique([tenantId, id]).
   */
  /**
   * Does this department own the course a sitting belongs to?
   *
   * The predicate behind a head of department's marks-sheet read. It is stated
   * here as well as in assessmentEvent.repository rather than shared, following
   * this project's existing convention that a reference lookup lives beside the
   * module that needs it — the same reason Course, Semester and Section have no
   * repository of their own anywhere in the codebase.
   *
   * tenantId is in the predicate as well as departmentId: a department id is
   * opaque, and pairing the two means a wrong one cannot reach another
   * institution's courses.
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

  async findEvent(
    tenantId: string,
    assessmentEventId: string,
    client: DbClient = prisma
  ): Promise<MarkingEventRecord | null> {
    return client.assessmentEvent.findFirst({
      where: { id: assessmentEventId, tenantId },
      select: {
        id: true,
        evaluationComponentId: true,
        courseId: true,
        semesterId: true,
        sectionId: true,
        maxMarks: true,
        status: true,
        conductedById: true,
      },
    });
  }

  /**
   * The component being assessed, and the status of the regulation governing it.
   *
   * ONE query with a join rather than two round trips. The component alone
   * cannot answer whether marks may be recorded — only the scheme carries a
   * status — and asking for them separately would be a second statement for a
   * fact reachable through a foreign key already declared.
   *
   * COMPLEXITY : O(log n) plus one index join.
   */
  async findGoverningScheme(
    tenantId: string,
    evaluationComponentId: string,
    client: DbClient = prisma
  ): Promise<GoverningSchemeRecord | null> {
    const component = await client.evaluationComponent.findFirst({
      where: { id: evaluationComponentId, tenantId },
      select: { id: true, schemeId: true, scheme: { select: { status: true } } },
    });

    if (component === null) {
      return null;
    }

    return {
      componentId: component.id,
      schemeId: component.schemeId,
      schemeStatus: component.scheme.status,
    };
  }

  /**
   * Every registration named by the batch, resolved in ONE statement.
   *
   * The whole eligibility check runs against this: existence, tenancy, course,
   * term, teaching group, governing regulation and lifecycle status. Resolving
   * them one at a time is the N+1 this method exists to make unnecessary.
   *
   * COMPLEXITY : O(log n + b) for a batch of b.
   */
  async findRegistrations(
    tenantId: string,
    courseRegistrationIds: readonly string[],
    client: DbClient = prisma
  ): Promise<MarkableRegistrationRecord[]> {
    if (courseRegistrationIds.length === 0) {
      return [];
    }

    return client.courseRegistration.findMany({
      where: { tenantId, id: { in: [...courseRegistrationIds] } },
      select: {
        id: true,
        courseId: true,
        semesterId: true,
        sectionId: true,
        evaluationSchemeId: true,
        status: true,
      },
    });
  }

  /**
   * The faculty profile linked to a signed-in account.
   *
   * Needed because a session identifies a USER while a sitting records the
   * FacultyMember who conducts it. FacultyMember.userId is @unique, so this is
   * a single-row lookup rather than a search.
   *
   * COMPLEXITY : O(log n) on the unique userId.
   */
  async findFacultyByUserId(
    tenantId: string,
    userId: string,
    client: DbClient = prisma
  ): Promise<{ id: string } | null> {
    return client.facultyMember.findFirst({
      where: { userId, tenantId },
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

export const studentComponentScoreRepository = new StudentComponentScoreRepository();

/**
 * The abstraction the marks service depends on.
 *
 * Imported with `import type`, so it is erased at compile time and the service
 * module never pulls lib/db/prisma into its runtime graph.
 */
export type StudentComponentScoreRepositoryPort = Pick<
  StudentComponentScoreRepository,
  | "findByEvent"
  | "findExisting"
  | "createMany"
  | "updateByNaturalKey"
  | "findEvent"
  | "courseBelongsToDepartment"
  | "findGoverningScheme"
  | "findRegistrations"
  | "findFacultyByUserId"
  | "transaction"
>;

/**
 * The narrow slice the result engine will depend on.
 *
 * Declared now and narrow on purpose: C7 must READ marks to compute a result
 * and must provably never write one. Marks originate at an assessment and
 * nowhere else.
 */
export type StudentComponentScoreReadPort = Pick<
  StudentComponentScoreRepository,
  "findByEvent"
>;
