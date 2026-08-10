// ============================================================================
// OWNER      : Gauransh
// MODULE     : Faculty Profile & Performance Analytics (Phase 23)
// LAYER      : Repository
// PURPOSE    : Every read and write the faculty profile module needs, and
//              nothing that decides anything.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • NO averaging, NO rate arithmetic, NO distinct counting, NO truncation
//     decision. Every one of those is a calculation and lives in
//     lib/domain/faculty-analytics/metrics.ts. This file will tell you which
//     attendance rows a member marked; it will never tell you what share were
//     present.
//
// TENANT ISOLATION
//   Every query filters on tenantId. The three new child tables carry their own
//   tenantId column alongside the facultyId foreign key, so a read is scoped
//   without joining through the parent.
//
// THE ANALYTICS READS ARE BOUNDED, AND THE BOUND IS VISIBLE
//   `findAttendanceForFaculty` and `findResultsForCourses` both take a limit and
//   read limit+1 rows. The extra row is how the caller learns the set was
//   truncated WITHOUT a second count query — if limit+1 came back, more exist.
//   The service then reports `truncated: true` rather than presenting a partial
//   aggregate as a total.
//
// THE QUERY BUDGET
//   findProfile          1 statement (child collections travel as nested selects)
//   findAssignments      1
//   findTimetable        1
//   findAttendance...    1
//   findResultsFor...    1
//   findFeedbackRatings  1
//   replaceProfile       up to 7 inside the caller's transaction (1 update +
//                        2 per supplied collection)
//   No method contains a per-row read, so none can become an N+1.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/app/generated/prisma/client";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/** A bounded read, and whether the bound was reached. */
export interface BoundedRows<T> {
  readonly rows: readonly T[];
  readonly truncated: boolean;
}

/** The User columns a profile card shows. */
const PROFILE_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  displayName: true,
  email: true,
  phone: true,
} as const;

/**
 * Everything a faculty profile renders from, in ONE statement.
 *
 * The three child collections are nested rather than read separately: four
 * reads for data always wanted together would be four round trips for one page.
 * Ordering is applied inside each nested select so the service never sorts.
 */
export const FACULTY_PROFILE_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  employeeId: true,
  departmentId: true,
  designation: true,
  qualification: true,
  specialization: true,
  experience: true,
  photoUrl: true,
  status: true,
  joinDate: true,
  createdAt: true,
  updatedAt: true,
  user: { select: PROFILE_USER_SELECT },
  department: { select: { id: true, code: true, name: true } },
  publications: {
    orderBy: [{ publishedOn: "desc" }, { id: "desc" }],
    select: {
      id: true,
      title: true,
      publisher: true,
      identifier: true,
      url: true,
      publishedOn: true,
    },
  },
  certifications: {
    orderBy: [{ issuedOn: "desc" }, { id: "desc" }],
    select: {
      id: true,
      name: true,
      issuer: true,
      url: true,
      issuedOn: true,
      expiresOn: true,
    },
  },
  education: {
    orderBy: [{ endYear: "desc" }, { id: "desc" }],
    select: {
      id: true,
      degree: true,
      institution: true,
      fieldOfStudy: true,
      startYear: true,
      endYear: true,
      grade: true,
    },
  },
} as const satisfies Prisma.FacultyMemberSelect;

export class FacultyProfileRepository {
  /**
   * Resolve the FacultyMember a signed-in user IS.
   *
   * The self-access gate's one read. Scoped by tenant as well as user, so a
   * session carried into the wrong tenant resolves to nothing.
   *
   * COST: one statement, a unique lookup on FacultyMember.userId.
   */
  async findByUserId(tenantId: string, userId: string, client: DbClient = prisma) {
    return client.facultyMember.findFirst({
      where: { userId, tenantId },
      select: { id: true, departmentId: true },
    });
  }

  /**
   * The whole profile — identity, photo, department and the three histories.
   *
   * Scoped by BOTH id and tenantId. Returns null for "no such member in this
   * tenant", which the service turns into the same 404 it uses for "not yours",
   * so neither answer confirms the existence of the other.
   *
   * COST: one statement.
   */
  async findProfile(tenantId: string, facultyId: string, client: DbClient = prisma) {
    return client.facultyMember.findFirst({
      where: { id: facultyId, tenantId },
      select: FACULTY_PROFILE_SELECT,
    });
  }

  /**
   * Course assignments, optionally narrowed to one semester.
   *
   * Returns WITHDRAWN assignments too. Which rows count as current workload is
   * `isActive`, and filtering it here would put that rule in two layers — the
   * domain's summariseWorkload already applies it, and the profile view reports
   * both counts.
   *
   * COST: one statement.
   */
  async findAssignments(
    tenantId: string,
    facultyId: string,
    semesterId: string | undefined,
    client: DbClient = prisma
  ) {
    return client.facultyCourseAssignment.findMany({
      where: {
        tenantId,
        facultyId,
        ...(semesterId ? { semesterId } : {}),
      },
      select: {
        id: true,
        courseId: true,
        sectionId: true,
        semesterId: true,
        isActive: true,
        course: { select: { id: true, code: true, name: true, credits: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  /**
   * Scheduled slots, optionally narrowed to one semester.
   *
   * This is the README's "Weekly Timetable". Ordered by day then start time so
   * a client renders a week without sorting.
   *
   * COST: one statement.
   */
  async findTimetable(
    tenantId: string,
    facultyId: string,
    semesterId: string | undefined,
    client: DbClient = prisma
  ) {
    return client.timetable.findMany({
      where: {
        tenantId,
        facultyId,
        ...(semesterId ? { semesterId } : {}),
      },
      select: {
        id: true,
        courseId: true,
        sectionId: true,
        semesterId: true,
        // The column is `day`, not `dayOfWeek` — DayOfWeek is the enum's name.
        day: true,
        startTime: true,
        endTime: true,
        roomNo: true,
        sessionType: true,
        isActive: true,
        course: { select: { code: true, name: true } },
        section: { select: { name: true } },
      },
      orderBy: [{ day: "asc" }, { startTime: "asc" }, { id: "asc" }],
    });
  }

  /**
   * Attendance this member recorded, bounded.
   *
   * Reads `limit + 1` rows so the caller learns the set was truncated without a
   * second count query. Selects only the two columns the statistic needs — this
   * is potentially thousands of rows and every extra column is paid per row.
   *
   * COST: one statement.
   */
  async findAttendanceForFaculty(
    tenantId: string,
    facultyId: string,
    limit: number,
    client: DbClient = prisma
  ): Promise<BoundedRows<{ status: string; studentId: string }>> {
    const rows = await client.attendance.findMany({
      where: { tenantId, facultyId },
      select: { status: true, studentId: true },
      take: limit + 1,
      orderBy: { markedAt: "desc" },
    });

    return {
      rows: rows.slice(0, limit).map((row) => ({ status: row.status, studentId: row.studentId })),
      truncated: rows.length > limit,
    };
  }

  /**
   * Examination results for a set of courses, bounded.
   *
   * The examination's maxMarks and passMark travel with each result because the
   * domain normalises marks to a percentage and cannot do so without the
   * denominator. Reading them per result would be an N+1; they arrive through
   * one nested select.
   *
   * COST: one statement. Returns empty without querying for an empty course set.
   */
  async findResultsForCourses(
    tenantId: string,
    courseIds: readonly string[],
    semesterId: string | undefined,
    limit: number,
    client: DbClient = prisma
  ): Promise<BoundedRows<{ marksObtained: number | null; maxMarks: number; passMark: number | null }>> {
    if (courseIds.length === 0) return { rows: [], truncated: false };

    const rows = await client.examResult.findMany({
      where: {
        examination: {
          tenantId,
          courseId: { in: [...courseIds] },
          ...(semesterId ? { semesterId } : {}),
        },
      },
      select: {
        marksObtained: true,
        examination: { select: { maxMarks: true, passMark: true } },
      },
      take: limit + 1,
      orderBy: { id: "desc" },
    });

    return {
      rows: rows.slice(0, limit).map((row) => ({
        // Decimal -> number at the boundary. The domain works in plain numbers,
        // and a Decimal instance would not survive JSON honestly (TD note in
        // studentProfile.dto.ts records the same conversion obligation).
        marksObtained: row.marksObtained === null ? null : Number(row.marksObtained),
        maxMarks: row.examination.maxMarks,
        passMark: row.examination.passMark,
      })),
      truncated: rows.length > limit,
    };
  }

  /**
   * How many students this member currently teaches.
   *
   * Counted through CourseRegistration on the member's active sections rather
   * than by summing section sizes: a student registered for the course is a
   * student taught, and a section's total includes students taking other
   * courses.
   *
   * COST: one statement. Returns 0 without querying for an empty input.
   */
  async countTaughtStudents(
    tenantId: string,
    pairs: readonly { courseId: string; sectionId: string | null }[],
    client: DbClient = prisma
  ): Promise<number> {
    const scoped = pairs.filter(
      (pair): pair is { courseId: string; sectionId: string } => pair.sectionId !== null
    );

    if (scoped.length === 0) return 0;

    const rows = await client.courseRegistration.findMany({
      where: {
        tenantId,
        OR: scoped.map((pair) => ({ courseId: pair.courseId, sectionId: pair.sectionId })),
      },
      select: { studentId: true },
      distinct: ["studentId"],
    });

    return rows.length;
  }

  /**
   * Replace the profile and, when supplied, its child collections.
   *
   * DELETE-THEN-CREATE per collection, matching the wholesale-replacement
   * contract the validation layer states. A collection the caller omitted is
   * not touched at all — `undefined` means "leave alone", which is distinct
   * from `[]` meaning "empty it".
   *
   * Runs inside the CALLER'S transaction so a partial replacement cannot
   * survive: a profile whose publications were deleted but not recreated is
   * data loss with no error.
   *
   * COST: 1 update, plus 2 statements per supplied collection.
   */
  async replaceProfile(
    input: {
      tenantId: string;
      facultyId: string;
      profile: Prisma.FacultyMemberUpdateInput;
      publications?: readonly Prisma.FacultyPublicationCreateManyInput[];
      certifications?: readonly Prisma.FacultyCertificationCreateManyInput[];
      education?: readonly Prisma.FacultyEducationCreateManyInput[];
    },
    client: DbClient
  ) {
    if (input.publications !== undefined) {
      await client.facultyPublication.deleteMany({
        where: { tenantId: input.tenantId, facultyId: input.facultyId },
      });
      if (input.publications.length > 0) {
        await client.facultyPublication.createMany({ data: [...input.publications] });
      }
    }

    if (input.certifications !== undefined) {
      await client.facultyCertification.deleteMany({
        where: { tenantId: input.tenantId, facultyId: input.facultyId },
      });
      if (input.certifications.length > 0) {
        await client.facultyCertification.createMany({ data: [...input.certifications] });
      }
    }

    if (input.education !== undefined) {
      await client.facultyEducation.deleteMany({
        where: { tenantId: input.tenantId, facultyId: input.facultyId },
      });
      if (input.education.length > 0) {
        await client.facultyEducation.createMany({ data: [...input.education] });
      }
    }

    // Last, so the returned row already carries the replaced collections.
    return client.facultyMember.update({
      where: { id: input.facultyId, tenantId: input.tenantId },
      data: input.profile,
      select: FACULTY_PROFILE_SELECT,
    });
  }

  /**
   * Run a unit of work atomically.
   *
   * The repository owns the Prisma handle; the service decides the BOUNDARY.
   * Same arrangement as evaluationScheme.repository and attendanceLock.
   */
  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }
}

export const facultyProfileRepository = new FacultyProfileRepository();

/** The abstraction the service depends on. Imported as `import type`. */
export type FacultyProfileRepositoryPort = Pick<
  FacultyProfileRepository,
  | "findByUserId"
  | "findProfile"
  | "findAssignments"
  | "findTimetable"
  | "findAttendanceForFaculty"
  | "findResultsForCourses"
  | "countTaughtStudents"
  | "replaceProfile"
  | "transaction"
>;
