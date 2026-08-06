// ============================================================================
// OWNER      : Gauransh
// MODULE     : Course Registration
// LAYER      : Repository
// PURPOSE    : Prisma data access for CourseRegistration, plus the reference
//              lookups this module needs and no existing repository owns.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • No attempt arithmetic, no lifecycle rules, no snapshot decisions, no
//     duplicate detection, no DTO mapping.
//
// WHY THE REFERENCE LOOKUPS LIVE HERE
//   Student, Course, Semester and Section have NO repositories in this project
//   — every other module reaches them inline from a route. There is nothing to
//   reuse, so the queries live beside the module that needs them, exactly as C3
//   placed its scheme lookup. EvaluationScheme is the exception: it HAS a
//   repository, so the service injects that as a narrow port rather than a
//   second definition being written here.
//
// TENANCY: every query is anchored on tenantId. The reference lookups are too —
//          a registration must never be created against another tenant's
//          student, and the only way to prove that is to resolve the student
//          tenant-scoped first.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import type {
  Prisma,
  RegistrationStatus,
  RegistrationType,
} from "@/app/generated/prisma/client";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/**
 * Columns returned for a registration.
 *
 * Declared once so every read answers with the same shape. No relation is
 * expanded: a roster consumer holds the course and semester from its own query,
 * and a student portal holds the student. Joining them per row would be a cost
 * paid on the largest table in the phase for columns the caller already has.
 */
export const COURSE_REGISTRATION_SELECT = {
  id: true,
  tenantId: true,
  studentId: true,
  courseId: true,
  semesterId: true,
  sectionId: true,
  programmeId: true,
  evaluationSchemeId: true,
  credits: true,
  registrationType: true,
  attemptNumber: true,
  status: true,
  statusChangedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type CourseRegistrationRecord = Prisma.CourseRegistrationGetPayload<{
  select: typeof COURSE_REGISTRATION_SELECT;
}>;

/**
 * Fixed list ordering.
 *
 * Newest enrolment first, then a stable tiebreak. `id` is a cuid and unique, so
 * the order is TOTAL — which offset pagination requires, or a row could repeat
 * on one page and vanish from the next. createdAt alone would not do it: a bulk
 * registration writes hundreds of rows in one statement and they share an
 * instant.
 */
const LIST_ORDER_BY: Prisma.CourseRegistrationOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  { id: "asc" },
];

/** Index-backed filters accepted by the list query. */
export interface CourseRegistrationFilter {
  studentId?: string;
  courseId?: string;
  semesterId?: string;
  sectionId?: string;
  status?: RegistrationStatus;
  registrationType?: RegistrationType;
}

/** Columns written when a registration is created. */
export interface CreateCourseRegistrationData {
  tenantId: string;
  studentId: string;
  courseId: string;
  semesterId: string;
  sectionId: string | null;
  programmeId: string | null;
  evaluationSchemeId: string;
  credits: number;
  registrationType: RegistrationType;
  attemptNumber: number;
}

/** Columns writable on an existing registration. Omit to leave unchanged. */
export interface UpdateCourseRegistrationData {
  sectionId?: string | null;
  status?: RegistrationStatus;
  statusChangedAt?: Date;
}

/** The facts the service needs about a referenced student. */
export interface StudentReferenceRecord {
  id: string;
  programmeId: string | null;
  sectionId: string | null;
}

/** The facts the service needs about a referenced course. */
export interface CourseReferenceRecord {
  id: string;
  credits: number;
}

/** The prior attempts a student has made at one course. */
export interface AttemptRecord {
  id: string;
  studentId: string;
  attemptNumber: number;
  status: RegistrationStatus;
}

/** Columns a roster consumer needs — the C6 marks-entry contract. */
export interface RosterEntryRecord {
  id: string;
  studentId: string;
  attemptNumber: number;
  evaluationSchemeId: string;
}

export class CourseRegistrationRepository {
  /**
   * One page of registrations, with the total for the same predicate.
   *
   * COMPLEXITY : O(log n + k) for the page. A roster filter (semesterId +
   *              courseId) rides @@index([tenantId, semesterId, courseId]); a
   *              student filter rides the leading column of
   *              @@unique([studentId, courseId, attemptNumber]). The count is
   *              O(matching) in PostgreSQL, which is why no free-text filter is
   *              offered on this table.
   * ATOMICITY  : both statements run in one transaction so the total cannot
   *              shift between them and describe a page that does not exist.
   */
  async listWithCount(
    tenantId: string,
    filter: CourseRegistrationFilter,
    skip: number,
    take: number
  ): Promise<[CourseRegistrationRecord[], number]> {
    const where: Prisma.CourseRegistrationWhereInput = {
      tenantId,
      ...(filter.studentId === undefined ? {} : { studentId: filter.studentId }),
      ...(filter.courseId === undefined ? {} : { courseId: filter.courseId }),
      ...(filter.semesterId === undefined ? {} : { semesterId: filter.semesterId }),
      ...(filter.sectionId === undefined ? {} : { sectionId: filter.sectionId }),
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...(filter.registrationType === undefined
        ? {}
        : { registrationType: filter.registrationType }),
    };

    return prisma.$transaction([
      prisma.courseRegistration.findMany({
        where,
        orderBy: LIST_ORDER_BY,
        skip,
        take,
        select: COURSE_REGISTRATION_SELECT,
      }),
      prisma.courseRegistration.count({ where }),
    ]);
  }

  /**
   * One registration, tenant-scoped.
   *
   * COMPLEXITY : O(log n) on the primary key with a tenant predicate.
   */
  async findById(
    tenantId: string,
    id: string,
    client: DbClient = prisma
  ): Promise<CourseRegistrationRecord | null> {
    return client.courseRegistration.findFirst({
      where: { id, tenantId },
      select: COURSE_REGISTRATION_SELECT,
    });
  }

  /**
   * Every attempt a set of students has made at ONE course.
   *
   * The keystone read of this module. It answers both questions the service
   * asks before creating anything — what attempt number comes next, and whether
   * an active enrolment already exists — for the WHOLE batch in one statement.
   * A per-student version of this query is what would make bulk registration an
   * N+1.
   *
   * COMPLEXITY : O(log n + a) where a is the number of prior attempts across
   *              the batch. Rides @@unique([studentId, courseId, attemptNumber]).
   */
  async findAttempts(
    tenantId: string,
    courseId: string,
    studentIds: readonly string[],
    client: DbClient = prisma
  ): Promise<AttemptRecord[]> {
    if (studentIds.length === 0) {
      return [];
    }

    return client.courseRegistration.findMany({
      where: { tenantId, courseId, studentId: { in: [...studentIds] } },
      select: { id: true, studentId: true, attemptNumber: true, status: true },
    });
  }

  /**
   * The active roster for a course in a term, optionally narrowed to a section.
   *
   * This is the contract every downstream engine reads instead of deriving a
   * roster from Student.sectionId. It returns the registration id, because a
   * mark or a result must cite the ENROLMENT rather than the student — that is
   * what carries the attempt number and the governing regulation.
   *
   * COMPLEXITY : O(log n + r) where r is the class size. Rides
   *              @@index([tenantId, semesterId, courseId]); a section filter
   *              narrows an already-bounded set.
   */
  async findRoster(
    tenantId: string,
    courseId: string,
    semesterId: string,
    statuses: readonly RegistrationStatus[],
    sectionId?: string,
    client: DbClient = prisma
  ): Promise<RosterEntryRecord[]> {
    return client.courseRegistration.findMany({
      where: {
        tenantId,
        courseId,
        semesterId,
        status: { in: [...statuses] },
        ...(sectionId === undefined ? {} : { sectionId }),
      },
      orderBy: [{ studentId: "asc" }],
      select: { id: true, studentId: true, attemptNumber: true, evaluationSchemeId: true },
    });
  }

  /**
   * Insert one registration.
   *
   * COMPLEXITY : O(log n) — one INSERT plus maintenance of two unique indexes
   *              and one secondary index.
   */
  async create(
    data: CreateCourseRegistrationData,
    client: DbClient = prisma
  ): Promise<CourseRegistrationRecord> {
    return client.courseRegistration.create({
      data,
      select: COURSE_REGISTRATION_SELECT,
    });
  }

  /**
   * Insert a whole cohort in ONE statement.
   *
   * createMany rather than a loop of creates: a 500-student batch is one round
   * trip and one index-maintenance pass instead of five hundred. It returns a
   * count rather than rows, which is why the service reports counts and skips
   * rather than echoing a payload proportional to the cohort.
   *
   * skipDuplicates is deliberately NOT set. The service has already resolved
   * every collision in memory from findAttempts, so a unique violation here
   * would mean a concurrent writer took the same attempt — a real conflict that
   * must surface as a 409, not be silently swallowed.
   *
   * COMPLEXITY : O(n log n) for n rows — one statement, index maintenance per
   *              row.
   */
  async createMany(
    data: readonly CreateCourseRegistrationData[],
    client: DbClient = prisma
  ): Promise<number> {
    const result = await client.courseRegistration.createMany({ data: [...data] });
    return result.count;
  }

  /**
   * Update one registration, tenant-scoped in the same statement.
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
    data: UpdateCourseRegistrationData,
    client: DbClient = prisma
  ): Promise<CourseRegistrationRecord> {
    return client.courseRegistration.update({
      where: { tenantId_id: { tenantId, id } },
      data,
      select: COURSE_REGISTRATION_SELECT,
    });
  }

  // --- Reference lookups ----------------------------------------------------

  /**
   * A student, tenant-scoped, with the two facts a registration snapshots.
   *
   * programmeId is selected because it is COPIED onto the registration:
   * Student.programmeId is overwritten on transfer, so the programme a course
   * was taken under is unrecoverable afterwards.
   *
   * COMPLEXITY : O(log n).
   */
  async findStudent(
    tenantId: string,
    studentId: string,
    client: DbClient = prisma
  ): Promise<StudentReferenceRecord | null> {
    return client.student.findFirst({
      where: { id: studentId, tenantId },
      select: { id: true, programmeId: true, sectionId: true },
    });
  }

  /**
   * Several students at once, tenant-scoped.
   *
   * The bulk counterpart of findStudent: one statement validates the whole
   * batch's existence and tenancy, and supplies every programme snapshot.
   *
   * COMPLEXITY : O(log n + b) for a batch of b.
   */
  async findStudents(
    tenantId: string,
    studentIds: readonly string[],
    client: DbClient = prisma
  ): Promise<StudentReferenceRecord[]> {
    if (studentIds.length === 0) {
      return [];
    }

    return client.student.findMany({
      where: { id: { in: [...studentIds] }, tenantId },
      select: { id: true, programmeId: true, sectionId: true },
    });
  }

  /**
   * A course, tenant-scoped, with the credits a registration snapshots.
   *
   * COMPLEXITY : O(log n).
   */
  async findCourse(
    tenantId: string,
    courseId: string,
    client: DbClient = prisma
  ): Promise<CourseReferenceRecord | null> {
    return client.course.findFirst({
      where: { id: courseId, tenantId },
      select: { id: true, credits: true },
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

export const courseRegistrationRepository = new CourseRegistrationRepository();

/**
 * The abstraction the registration service depends on.
 *
 * Imported with `import type`, so it is erased at compile time and the service
 * module never pulls lib/db/prisma into its runtime graph.
 */
export type CourseRegistrationRepositoryPort = Pick<
  CourseRegistrationRepository,
  | "listWithCount"
  | "findById"
  | "findAttempts"
  | "findRoster"
  | "create"
  | "createMany"
  | "update"
  | "findStudent"
  | "findStudents"
  | "findCourse"
  | "findSemester"
  | "findSection"
  | "transaction"
>;

/**
 * The narrow slice the assessment and result engines will depend on.
 *
 * Declared now, and narrow on purpose: those engines must READ the roster and
 * prove an enrolment before recording a mark, and must provably never create,
 * amend or withdraw one. The type makes that impossible rather than merely
 * discouraged.
 */
export type CourseRegistrationLookupPort = Pick<
  CourseRegistrationRepository,
  "findRoster" | "findById"
>;
