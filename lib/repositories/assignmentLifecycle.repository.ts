// ============================================================================
// OWNER      : Gauransh
// MODULE     : Assignment Management Enhancement (Phase 24)
// LAYER      : Repository
// PURPOSE    : Every read and write the Phase 24 endpoints need, and nothing
//              that decides anything.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • NO rate arithmetic, NO pending derivation, NO late decision, NO
//     status transition. Every one of those lives in the domain module or the
//     service. This file will tell you which students are registered and which
//     submitted; it will never tell you which are pending, because that is a
//     subtraction.
//
// THE COHORT IS COURSE REGISTRATIONS
//   "Who was supposed to submit" is only answerable from CourseRegistration,
//   and the statuses that count as a real registration come from Phase 16's own
//   REPORTABLE_REGISTRATION_STATUSES rather than a second list here. That
//   question was answered once and is not re-answered.
//
// TENANT ISOLATION
//   Assignment carries tenantId. AssignmentSubmission does NOT — it is one of
//   the two models in the schema storing tenant-owned data without one (TD-A) —
//   so every submission query anchors ownership through `assignment: { tenantId }`.
//   That is a real join rather than a column predicate, and it is the only
//   isolation available until TD-A is resolved.
//
// THE QUERY BUDGET
//   findAssignment            1
//   findCohort                1
//   findSubmissions           1
//   findRosterPage            2 (a page and its count)
//   findAssignmentsForAnalytics 1 (submissions travel as a nested select)
//   countSubmissions          1
//   recordVersionAndReplace   3 inside the caller's transaction
//   No method contains a per-row read, so none can become an N+1.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { SubmissionStatus, type Prisma } from "@/app/generated/prisma/client";
import { REPORTABLE_REGISTRATION_STATUSES } from "@/lib/repositories/result.repository";
import { SUBMITTED_STATUSES } from "@/lib/constants/assignmentLifecycle";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/** A page of rows and the total that satisfied the same predicate. */
export interface Page<T> {
  readonly rows: readonly T[];
  readonly total: number;
}

/** The student columns a roster shows. */
const ROSTER_STUDENT_SELECT = {
  id: true,
  enrollmentNo: true,
  user: { select: { firstName: true, lastName: true, displayName: true, email: true } },
} as const;

/** Everything the lifecycle rules need to know about an assignment. */
export const ASSIGNMENT_LIFECYCLE_SELECT = {
  id: true,
  tenantId: true,
  courseId: true,
  sectionId: true,
  title: true,
  status: true,
  maxMarks: true,
  dueDate: true,
  publishedAt: true,
  createdBy: true,
} as const;

export class AssignmentLifecycleRepository {
  /**
   * One assignment, tenant-scoped.
   *
   * Returns null for "unknown" and for "another tenant's", which the service
   * turns into the same 404 — no id is ever confirmed to exist elsewhere.
   *
   * COST: one statement.
   */
  async findAssignment(tenantId: string, assignmentId: string, client: DbClient = prisma) {
    return client.assignment.findFirst({
      where: { id: assignmentId, tenantId },
      select: ASSIGNMENT_LIFECYCLE_SELECT,
    });
  }

  /**
   * How many students were registered for an assignment's course.
   *
   * THE DENOMINATOR of every rate this phase reports. Narrowed by section when
   * the assignment names one — an assignment set for Section A must not be
   * measured against the whole course's enrolment.
   *
   * Assignment.sectionId carries no foreign key (TD-B), so it is used as a
   * filter value only and nothing is joined through it.
   *
   * COST: one statement.
   */
  async countCohort(
    tenantId: string,
    courseId: string,
    sectionId: string | null,
    client: DbClient = prisma
  ): Promise<number> {
    return client.courseRegistration.count({
      where: {
        tenantId,
        courseId,
        ...(sectionId ? { sectionId } : {}),
        status: { in: [...REPORTABLE_REGISTRATION_STATUSES] },
      },
    });
  }

  /**
   * One page of the students who HAVE submitted.
   *
   * Ordered by submission time then id — the id tiebreaker is required for
   * correctness, not presentation: offset pagination over rows sharing a
   * timestamp can repeat or skip entries, and submittedAt is nullable so a
   * batch of placeholder rows shares a null.
   *
   * COST: two statements in one transaction, so the total cannot describe a
   * wider set than the page.
   */
  async findSubmittedPage(
    tenantId: string,
    assignmentId: string,
    page: number,
    limit: number,
    client: DbClient = prisma
  ) {
    const where: Prisma.AssignmentSubmissionWhereInput = {
      assignmentId,
      assignment: { tenantId },
      status: { in: [...SUBMITTED_STATUSES] },
    };

    const [rows, total] = await client.$transaction([
      client.assignmentSubmission.findMany({
        where,
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          status: true,
          submittedAt: true,
          marks: true,
          feedback: true,
          gradedAt: true,
          attachments: true,
          student: { select: ROSTER_STUDENT_SELECT },
          _count: { select: { versions: true } },
        },
      }),
      client.assignmentSubmission.count({ where }),
    ]);

    return { rows, total };
  }

  /**
   * One page of the students who have NOT submitted.
   *
   * Expressed as a registration query with a NOT-EXISTS on submissions, rather
   * than by loading the cohort and subtracting in memory. A five-hundred-student
   * course would otherwise transfer five hundred rows to compute one page of
   * fifty.
   *
   * "Has not submitted" includes a student holding a PENDING placeholder row,
   * because PENDING is the column default and means exactly that.
   *
   * COST: two statements in one transaction.
   */
  async findPendingPage(
    tenantId: string,
    assignment: { id: string; courseId: string; sectionId: string | null },
    page: number,
    limit: number,
    client: DbClient = prisma
  ) {
    const where: Prisma.CourseRegistrationWhereInput = {
      tenantId,
      courseId: assignment.courseId,
      ...(assignment.sectionId ? { sectionId: assignment.sectionId } : {}),
      status: { in: [...REPORTABLE_REGISTRATION_STATUSES] },
      student: {
        submissions: {
          none: {
            assignmentId: assignment.id,
            status: { in: [...SUBMITTED_STATUSES] },
          },
        },
      },
    };

    const [rows, total] = await client.$transaction([
      client.courseRegistration.findMany({
        where,
        orderBy: [{ studentId: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: { student: { select: ROSTER_STUDENT_SELECT } },
      }),
      client.courseRegistration.count({ where }),
    ]);

    return { rows, total };
  }

  /**
   * Assignments matching a filter, with their submissions, for analytics.
   *
   * Submissions travel as a NESTED SELECT so an aggregate over fifty
   * assignments costs one statement rather than fifty-one. Reads `limit + 1`
   * assignments so truncation is detected without a second count query.
   *
   * COST: one statement.
   */
  async findAssignmentsForAnalytics(
    tenantId: string,
    filter: {
      readonly assignmentId?: string;
      readonly courseId?: string;
      readonly sectionId?: string;
    },
    limit: number,
    client: DbClient = prisma
  ) {
    const rows = await client.assignment.findMany({
      where: {
        tenantId,
        ...(filter.assignmentId ? { id: filter.assignmentId } : {}),
        ...(filter.courseId ? { courseId: filter.courseId } : {}),
        ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        title: true,
        courseId: true,
        sectionId: true,
        status: true,
        maxMarks: true,
        dueDate: true,
        submissions: {
          select: { studentId: true, status: true, marks: true, submittedAt: true },
        },
      },
    });

    return { rows: rows.slice(0, limit), truncated: rows.length > limit };
  }

  /**
   * The caller's own submission for one assignment, if any.
   *
   * COST: one statement, on the (assignmentId, studentId) unique index.
   */
  async findOwnSubmission(
    assignmentId: string,
    studentId: string,
    client: DbClient = prisma
  ) {
    return client.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId } },
      select: {
        id: true,
        status: true,
        attachments: true,
        submittedAt: true,
        marks: true,
        feedback: true,
        gradedAt: true,
        gradedBy: true,
      },
    });
  }

  /** How many versions a submission already has. Drives the attempt number. */
  async countVersions(submissionId: string, client: DbClient = prisma): Promise<number> {
    return client.assignmentSubmissionVersion.count({ where: { submissionId } });
  }

  /**
   * Snapshot the outgoing submission, then overwrite it.
   *
   * THE RESUBMISSION PATH. The version row is written FIRST and the update
   * second, both inside the caller's transaction: reversed, a crash between
   * them would lose the previous attempt entirely, which is the one thing the
   * version table exists to prevent.
   *
   * The attempt number is supplied by the caller, which has counted existing
   * versions inside the SAME transaction. @@unique([submissionId, attempt]) is
   * what makes that safe under concurrency — a second resubmission racing the
   * first fails the constraint rather than silently reusing an attempt number.
   *
   * COST: two statements.
   */
  async recordVersionAndReplace(
    input: {
      submissionId: string;
      attempt: number;
      previous: {
        status: SubmissionStatus;
        attachments: Prisma.InputJsonValue | undefined;
        submittedAt: Date | null;
        marks: number | null;
        feedback: string | null;
        gradedAt: Date | null;
        gradedBy: string | null;
      };
      next: {
        status: SubmissionStatus;
        attachments: Prisma.InputJsonValue | undefined;
        submittedAt: Date;
      };
    },
    client: DbClient
  ) {
    await client.assignmentSubmissionVersion.create({
      data: {
        submissionId: input.submissionId,
        attempt: input.attempt,
        status: input.previous.status,
        attachments: input.previous.attachments,
        submittedAt: input.previous.submittedAt,
        marks: input.previous.marks,
        feedback: input.previous.feedback,
        gradedAt: input.previous.gradedAt,
        gradedBy: input.previous.gradedBy,
      },
      select: { id: true },
    });

    return client.assignmentSubmission.update({
      where: { id: input.submissionId },
      data: {
        status: input.next.status,
        attachments: input.next.attachments,
        submittedAt: input.next.submittedAt,
        // A resubmission supersedes the previous grade: the marks awarded were
        // for work that has just been replaced. They are preserved on the
        // version row, which is what makes clearing them here safe.
        marks: null,
        feedback: null,
        gradedAt: null,
        gradedBy: null,
      },
      select: {
        id: true,
        status: true,
        attachments: true,
        submittedAt: true,
        marks: true,
        feedback: true,
        gradedAt: true,
      },
    });
  }

  /** Create a first submission. COST: one statement. */
  async createSubmission(
    input: {
      assignmentId: string;
      studentId: string;
      status: SubmissionStatus;
      attachments: Prisma.InputJsonValue | undefined;
      submittedAt: Date;
    },
    client: DbClient = prisma
  ) {
    return client.assignmentSubmission.create({
      data: input,
      select: {
        id: true,
        status: true,
        attachments: true,
        submittedAt: true,
        marks: true,
        feedback: true,
        gradedAt: true,
      },
    });
  }

  /**
   * Apply a grade.
   *
   * Anchored through `assignment: { tenantId }` because AssignmentSubmission
   * carries no tenantId of its own (TD-A). `updateMany` rather than `update` so
   * the relation predicate is expressible; a zero count means the submission
   * does not belong to this tenant's assignment and the service raises 404.
   *
   * COST: one statement.
   */
  async gradeSubmission(
    input: {
      tenantId: string;
      assignmentId: string;
      submissionId: string;
      marks: number;
      feedback: string | null;
      gradedBy: string;
      gradedAt: Date;
    },
    client: DbClient = prisma
  ): Promise<number> {
    const result = await client.assignmentSubmission.updateMany({
      where: {
        id: input.submissionId,
        assignmentId: input.assignmentId,
        assignment: { tenantId: input.tenantId },
      },
      data: {
        status: SubmissionStatus.GRADED,
        marks: input.marks,
        ...(input.feedback === null ? {} : { feedback: input.feedback }),
        gradedBy: input.gradedBy,
        gradedAt: input.gradedAt,
      },
    });

    return result.count;
  }

  /** The submission as it stands after grading. COST: one statement. */
  async findSubmissionById(submissionId: string, client: DbClient = prisma) {
    return client.assignmentSubmission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        assignmentId: true,
        status: true,
        submittedAt: true,
        marks: true,
        feedback: true,
        gradedAt: true,
        attachments: true,
        student: { select: ROSTER_STUDENT_SELECT },
      },
    });
  }

  /** How many submissions an assignment holds. Drives the DELETE guard. */
  async countSubmissions(assignmentId: string, client: DbClient = prisma): Promise<number> {
    return client.assignmentSubmission.count({ where: { assignmentId } });
  }

  /**
   * Remove an assignment.
   *
   * Scoped by tenantId as well as id, so the write cannot reach another
   * tenant's row even if the id were guessed. A hard delete: the schema has no
   * deletedAt column for this model and no archive to soft-delete into, and the
   * service refuses the operation entirely once submissions exist.
   *
   * COST: one statement.
   */
  async deleteAssignment(
    tenantId: string,
    assignmentId: string,
    client: DbClient = prisma
  ): Promise<number> {
    const result = await client.assignment.deleteMany({
      where: { id: assignmentId, tenantId },
    });

    return result.count;
  }

  /** The versions of one submission, newest attempt first. COST: one statement. */
  async findVersions(submissionId: string, client: DbClient = prisma) {
    return client.assignmentSubmissionVersion.findMany({
      where: { submissionId },
      orderBy: [{ attempt: "desc" }],
      select: {
        id: true,
        attempt: true,
        status: true,
        attachments: true,
        submittedAt: true,
        marks: true,
        feedback: true,
        recordedAt: true,
      },
    });
  }

  /** Run a unit of work atomically. The service decides the BOUNDARY. */
  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }
}

export const assignmentLifecycleRepository = new AssignmentLifecycleRepository();

/** The abstraction the service depends on. Imported as `import type`. */
export type AssignmentLifecycleRepositoryPort = Pick<
  AssignmentLifecycleRepository,
  | "findAssignment"
  | "countCohort"
  | "findSubmittedPage"
  | "findPendingPage"
  | "findAssignmentsForAnalytics"
  | "findOwnSubmission"
  | "countVersions"
  | "recordVersionAndReplace"
  | "createSubmission"
  | "gradeSubmission"
  | "findSubmissionById"
  | "countSubmissions"
  | "deleteAssignment"
  | "findVersions"
  | "transaction"
>;
