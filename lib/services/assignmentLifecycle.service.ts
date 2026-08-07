// ============================================================================
// OWNER      : Gauransh
// MODULE     : Assignment Management Enhancement (Phase 24)
// LAYER      : Service
// PURPOSE    : Own every rule the Phase 24 endpoints have — who may submit,
//              what a resubmission does to an existing grade, when an
//              assignment may be deleted, and what the rosters mean.
// ARCHITECTURE:
//   • Service owns ALL orchestration and every decision.
//   • It calculates NOTHING. Rates, pending derivation and the late boundary
//     all come from lib/domain/assignment-analytics/metrics.ts, so the roster
//     endpoints and the analytics endpoint provably agree about what "pending"
//     means.
//
// THIS SERVICE IS THE SINGLE HOME OF THE RULES, AND PHASE 10 IS UNTOUCHED
//   Phase 10's two submission routes continue to work exactly as they did.
//   Phase 24's /submit and /grade are new SURFACES over new rules — self-service
//   submission and assignment-level grading — not reimplementations of Phase
//   10's administrative paths.
//
// A RESUBMISSION SUPERSEDES ITS GRADE, AND PRESERVES IT
//   Overwriting a graded submission clears marks, feedback and gradedAt on the
//   live row: those marks were awarded for work that has just been replaced,
//   and leaving them would attribute a grade to a submission nobody assessed.
//   The outgoing state is snapshotted into AssignmentSubmissionVersion FIRST,
//   inside the same transaction, so nothing is lost — that is the whole point
//   of the version table.
//
// QUERY BUDGET, STATED HONESTLY
//   submit          3-5 (assignment, student, registration, existing, then the
//                   transaction's 2-3)
//   grade           2 (assignment, then the update) + 1 read-back
//   getPending      1 (assignment) + 2 (page and count)
//   getSubmitted    1 (assignment) + 2
//   getAnalytics    1 (assignments with nested submissions) + 1 per DISTINCT
//                   (course, section) pair for the cohort counts
//   deleteAssignment 3 (assignment, submission count, delete)
//   No call is inside a per-row loop.
// ============================================================================

import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import { AssignmentStatus, SubmissionStatus } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  ASSIGNMENT_ANALYTICS_LIMIT,
  ASSIGNMENT_LIFECYCLE_MESSAGE,
  SUBMITTABLE_ASSIGNMENT_STATUSES,
} from "@/lib/constants/assignmentLifecycle";
import {
  computeAssignmentStats,
  isLate,
  rollUpAssignmentStats,
} from "@/lib/domain/assignment-analytics/metrics";
import {
  toRosterPageDto,
  toRosterStudentDto,
  toSubmissionVersionDto,
  toSubmittedRowDto,
  type AssignmentAnalyticsDto,
  type RosterPageDto,
  type RosterStudentDto,
  type SubmissionResultDto,
  type SubmittedRowDto,
} from "@/lib/dto/assignmentLifecycle.dto";
import type { AssignmentLifecycleRepositoryPort } from "@/lib/repositories/assignmentLifecycle.repository";
import type {
  AssignmentAnalyticsQuery,
  AssignmentRosterQuery,
  GradeAssignmentInput,
  SubmitAssignmentInput,
} from "@/lib/validations/assignmentLifecycle.validation";

/**
 * Resolves a signed-in user to the Student they ARE, and confirms they are
 * registered for a course.
 *
 * A NARROW PORT rather than a repository: two projections no existing
 * repository exposes in this shape. Both decide nothing — that an unregistered
 * student is refused is this service's rule.
 */
export interface AssignmentStudentPort {
  findStudentByUserId(tenantId: string, userId: string): Promise<{ id: string } | null>;
  isRegistered(
    tenantId: string,
    studentId: string,
    courseId: string,
    sectionId: string | null
  ): Promise<boolean>;
}

export class AssignmentLifecycleService {
  constructor(
    private readonly repository: AssignmentLifecycleRepositoryPort,
    private readonly students: AssignmentStudentPort
  ) {}

  /**
   * POST /api/assignments/[id]/submit — the student's own submission.
   *
   * RULES   : The caller must own a Student row in this tenant (403 otherwise,
   *           same message as "no such student"), the assignment must be
   *           PUBLISHED (409 otherwise — a DRAFT is invisible to students and
   *           CLOSED or GRADED would silently invalidate marks already awarded
   *           to the cohort), and the student must be registered for its course
   *           (403 otherwise).
   *
   *           LATE is DERIVED from Assignment.dueDate, never accepted from the
   *           client. An assignment with no due date can never be late.
   *
   *           A resubmission snapshots the outgoing state and CLEARS the live
   *           row's grade — see the module header.
   *
   * ATOMICITY: the version write and the overwrite share ONE transaction, and
   *           the attempt number is counted inside it. @@unique([submissionId,
   *           attempt]) turns a concurrent second resubmission into a
   *           constraint failure rather than two attempts sharing a number.
   */
  async submit(
    tenantId: string,
    userId: string,
    assignmentId: string,
    input: SubmitAssignmentInput,
    now: Date
  ): Promise<SubmissionResultDto> {
    const assignment = await this.repository.findAssignment(tenantId, assignmentId);
    if (!assignment) throw this.assignmentNotFound();

    if (
      !(SUBMITTABLE_ASSIGNMENT_STATUSES as readonly AssignmentStatus[]).includes(
        assignment.status
      )
    ) {
      throw new AppError(
        ASSIGNMENT_LIFECYCLE_MESSAGE.NOT_OPEN,
        HTTP_STATUS.CONFLICT,
        ERROR_CODE.CONFLICT
      );
    }

    const student = await this.students.findStudentByUserId(tenantId, userId);
    if (!student) {
      throw new AppError(
        ASSIGNMENT_LIFECYCLE_MESSAGE.FORBIDDEN,
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODE.FORBIDDEN
      );
    }

    const registered = await this.students.isRegistered(
      tenantId,
      student.id,
      assignment.courseId,
      assignment.sectionId
    );

    if (!registered) {
      throw new AppError(
        ASSIGNMENT_LIFECYCLE_MESSAGE.NOT_REGISTERED,
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODE.FORBIDDEN
      );
    }

    const status = isLate(assignment.dueDate, now)
      ? SubmissionStatus.LATE
      : SubmissionStatus.SUBMITTED;

    const attachments = input.attachments as Prisma.InputJsonValue | undefined;

    const existing = await this.repository.findOwnSubmission(assignmentId, student.id);

    if (!existing) {
      const created = await this.repository.createSubmission({
        assignmentId,
        studentId: student.id,
        status,
        attachments,
        submittedAt: now,
      });

      return {
        submissionId: created.id,
        assignmentId,
        status: created.status,
        submittedAt: created.submittedAt?.toISOString() ?? null,
        marks: created.marks,
        feedback: created.feedback,
        gradedAt: created.gradedAt?.toISOString() ?? null,
        attachments: created.attachments ?? null,
        attempt: 1,
        isResubmission: false,
        history: [],
      };
    }

    const replaced = await this.repository.transaction(async (client) => {
      const priorVersions = await this.repository.countVersions(existing.id, client);

      return this.repository.recordVersionAndReplace(
        {
          submissionId: existing.id,
          attempt: priorVersions + 1,
          previous: {
            status: existing.status,
            attachments: (existing.attachments ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
            submittedAt: existing.submittedAt,
            marks: existing.marks,
            feedback: existing.feedback,
            gradedAt: existing.gradedAt,
            gradedBy: existing.gradedBy,
          },
          next: { status, attachments, submittedAt: now },
        },
        client
      );
    });

    const history = await this.repository.findVersions(existing.id);

    return {
      submissionId: replaced.id,
      assignmentId,
      status: replaced.status,
      submittedAt: replaced.submittedAt?.toISOString() ?? null,
      marks: replaced.marks,
      feedback: replaced.feedback,
      gradedAt: replaced.gradedAt?.toISOString() ?? null,
      attachments: replaced.attachments ?? null,
      // Versions hold the SUPERSEDED attempts, so the live row is one beyond.
      attempt: history.length + 1,
      isResubmission: true,
      history: history.map(toSubmissionVersionDto),
    };
  }

  /**
   * GET /api/assignments/[id]/submit — the caller's own submission.
   *
   * WHY THIS EXISTS
   *   The README's Phase 24 lists "Submission History", "View Marks" and
   *   "Faculty Feedback" as STUDENT features. Marks and feedback are readable
   *   through Phase 10's own submissions route, but the version history this
   *   phase introduced was reachable only as a side effect of resubmitting —
   *   so a student could not see their earlier attempts without making another
   *   one, which is absurd.
   *
   *   It is a GET on the /submit path rather than a new URL because the README
   *   defines no route for it, and adding a method to a path it does name is a
   *   smaller departure than inventing a path it does not.
   *
   * RULES : Self-service. The student is resolved from session.sub and the
   *         submission is looked up by (assignmentId, studentId), so there is
   *         no way to name another student's work. A student who has not
   *         submitted receives a 404 rather than an empty shell.
   */
  async getOwnSubmission(
    tenantId: string,
    userId: string,
    assignmentId: string
  ): Promise<SubmissionResultDto> {
    const assignment = await this.repository.findAssignment(tenantId, assignmentId);
    if (!assignment) throw this.assignmentNotFound();

    const student = await this.students.findStudentByUserId(tenantId, userId);
    if (!student) {
      throw new AppError(
        ASSIGNMENT_LIFECYCLE_MESSAGE.FORBIDDEN,
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODE.FORBIDDEN
      );
    }

    const existing = await this.repository.findOwnSubmission(assignmentId, student.id);

    if (!existing) {
      throw new AppError(
        ASSIGNMENT_LIFECYCLE_MESSAGE.SUBMISSION_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }

    const history = await this.repository.findVersions(existing.id);

    return {
      submissionId: existing.id,
      assignmentId,
      status: existing.status,
      submittedAt: existing.submittedAt?.toISOString() ?? null,
      marks: existing.marks,
      feedback: existing.feedback,
      gradedAt: existing.gradedAt?.toISOString() ?? null,
      attachments: existing.attachments ?? null,
      // Versions hold the SUPERSEDED attempts, so the live row is one beyond.
      attempt: history.length + 1,
      isResubmission: history.length > 0,
      history: history.map(toSubmissionVersionDto),
    };
  }

  /**
   * PATCH /api/assignments/[id]/grade
   *
   * RULES   : The submission must belong to the named assignment AND that
   *           assignment must belong to the caller's tenant. Both are asserted
   *           in the UPDATE's own predicate rather than by a prior read, so a
   *           submission moved between the check and the write cannot be
   *           graded — a zero row count is the 404.
   *
   *           `marks <= assignment.maxMarks` is enforced here because the bound
   *           depends on a stored value the validation layer cannot read.
   */
  async grade(
    tenantId: string,
    assignmentId: string,
    input: GradeAssignmentInput,
    gradedBy: string,
    now: Date
  ): Promise<SubmittedRowDto> {
    const assignment = await this.repository.findAssignment(tenantId, assignmentId);
    if (!assignment) throw this.assignmentNotFound();

    if (input.marks > assignment.maxMarks) {
      throw new AppError(
        `${ASSIGNMENT_LIFECYCLE_MESSAGE.MARKS_EXCEED_MAX} (${assignment.maxMarks})`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODE.VALIDATION
      );
    }

    const count = await this.repository.gradeSubmission({
      tenantId,
      assignmentId,
      submissionId: input.submissionId,
      marks: input.marks,
      feedback: input.feedback ?? null,
      gradedBy,
      gradedAt: now,
    });

    if (count === 0) {
      throw new AppError(
        ASSIGNMENT_LIFECYCLE_MESSAGE.SUBMISSION_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }

    const graded = await this.repository.findSubmissionById(input.submissionId);

    if (!graded) {
      // The row was removed between the update and the read-back. Reported as
      // the same 404 the update would have produced.
      throw new AppError(
        ASSIGNMENT_LIFECYCLE_MESSAGE.SUBMISSION_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }

    return toSubmittedRowDto({ ...graded, _count: { versions: 0 } });
  }

  /** GET /api/assignments/[id]/submitted */
  async getSubmitted(
    tenantId: string,
    assignmentId: string,
    query: AssignmentRosterQuery
  ): Promise<RosterPageDto<SubmittedRowDto>> {
    const assignment = await this.repository.findAssignment(tenantId, assignmentId);
    if (!assignment) throw this.assignmentNotFound();

    const { rows, total } = await this.repository.findSubmittedPage(
      tenantId,
      assignmentId,
      query.page,
      query.limit
    );

    return toRosterPageDto(rows.map(toSubmittedRowDto), query.page, query.limit, total);
  }

  /**
   * GET /api/assignments/[id]/pending
   *
   * REPORTS : Students REGISTERED for the assignment's course who hold no
   *           submitted row. A student with a PENDING placeholder counts as
   *           pending, because PENDING is the column default and means exactly
   *           that.
   */
  async getPending(
    tenantId: string,
    assignmentId: string,
    query: AssignmentRosterQuery
  ): Promise<RosterPageDto<RosterStudentDto>> {
    const assignment = await this.repository.findAssignment(tenantId, assignmentId);
    if (!assignment) throw this.assignmentNotFound();

    const { rows, total } = await this.repository.findPendingPage(
      tenantId,
      {
        id: assignment.id,
        courseId: assignment.courseId,
        sectionId: assignment.sectionId,
      },
      query.page,
      query.limit
    );

    return toRosterPageDto(
      rows.map((row) => toRosterStudentDto(row.student)),
      query.page,
      query.limit,
      total
    );
  }

  /**
   * GET /api/assignments/analytics
   *
   * The cohort size is read ONCE PER DISTINCT (course, section) PAIR, not once
   * per assignment: a course with twelve assignments for one section shares one
   * cohort, and twelve identical counts would be eleven wasted round trips.
   */
  async getAnalytics(
    tenantId: string,
    query: AssignmentAnalyticsQuery
  ): Promise<AssignmentAnalyticsDto> {
    const { rows, truncated } = await this.repository.findAssignmentsForAnalytics(
      tenantId,
      query,
      ASSIGNMENT_ANALYTICS_LIMIT
    );

    const cohortKey = (courseId: string, sectionId: string | null) =>
      `${courseId} ${sectionId ?? ""}`;

    const distinctPairs = [
      ...new Map(
        rows.map((row) => [
          cohortKey(row.courseId, row.sectionId),
          { courseId: row.courseId, sectionId: row.sectionId },
        ])
      ).values(),
    ];

    const cohorts = new Map<string, number>();
    await Promise.all(
      distinctPairs.map(async (pair) => {
        const size = await this.repository.countCohort(tenantId, pair.courseId, pair.sectionId);
        cohorts.set(cohortKey(pair.courseId, pair.sectionId), size);
      })
    );

    const assignments = rows.map((row) => {
      const stats = computeAssignmentStats({
        id: row.id,
        maxMarks: row.maxMarks,
        dueDate: row.dueDate,
        submissions: row.submissions,
        cohortSize: cohorts.get(cohortKey(row.courseId, row.sectionId)) ?? 0,
      });

      return {
        ...stats,
        title: row.title,
        courseId: row.courseId,
        sectionId: row.sectionId,
        status: row.status,
        maxMarks: row.maxMarks,
        dueDate: row.dueDate?.toISOString() ?? null,
      };
    });

    return {
      totals: rollUpAssignmentStats(assignments, truncated),
      assignments,
    };
  }

  /**
   * DELETE /api/assignments/[id]
   *
   * RULES   : REFUSED with 409 once any submission exists. A hard delete would
   *           cascade nothing (AssignmentSubmission holds a plain foreign key
   *           to Assignment with no cascade) and would therefore be rejected by
   *           the database with an opaque constraint error — but more
   *           importantly, destroying student work as a side effect of tidying
   *           an assignment list is not a thing an API should do quietly.
   *
   *           An assignment with no submissions is removed permanently. The
   *           schema has no deletedAt column for this model and no archive to
   *           soft-delete into, so there is nothing to soft-delete into.
   */
  async deleteAssignment(tenantId: string, assignmentId: string): Promise<void> {
    const assignment = await this.repository.findAssignment(tenantId, assignmentId);
    if (!assignment) throw this.assignmentNotFound();

    const submissions = await this.repository.countSubmissions(assignmentId);

    if (submissions > 0) {
      throw new AppError(
        ASSIGNMENT_LIFECYCLE_MESSAGE.HAS_SUBMISSIONS,
        HTTP_STATUS.CONFLICT,
        ERROR_CODE.CONFLICT
      );
    }

    const removed = await this.repository.deleteAssignment(tenantId, assignmentId);

    if (removed === 0) {
      // Deleted between the check and the write. Reported as the 404 the lookup
      // would have produced, so a losing racer and an unknown id are
      // indistinguishable.
      throw this.assignmentNotFound();
    }
  }

  private assignmentNotFound(): AppError {
    return new AppError(
      ASSIGNMENT_LIFECYCLE_MESSAGE.NOT_FOUND,
      HTTP_STATUS.NOT_FOUND,
      ERROR_CODE.NOT_FOUND
    );
  }
}
