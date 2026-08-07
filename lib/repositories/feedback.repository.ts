// ============================================================================
// OWNER      : Gauransh
// MODULE     : Faculty Feedback System
// LAYER      : Repository
// PURPOSE    : Every read and write the feedback module needs, and nothing that
//              decides, computes or conceals anything.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • NO averages, NO weighted scores, NO category rollups, NO trend maths,
//     NO duplicate detection, NO eligibility evaluation, NO report assembly.
//     Every one of those is a business rule and belongs to lib/domain/feedback.
//
//   The line is sharpest around ANONYMITY. This file does not "mask" anything —
//   masking is an action a caller can forget to take. Instead it publishes TWO
//   projections and no third:
//
//     ANONYMOUS_SUBMISSION_SELECT   omits studentId entirely
//     ATTRIBUTED_SUBMISSION_SELECT  includes it
//
//   A faculty-facing read physically cannot return an identity, because the
//   column is absent from the shape the query asked for. That is a structural
//   guarantee rather than a procedural one, and it is the whole reason the two
//   constants exist as separate exports that a test can compare.
//
// TENANT ISOLATION
//   FeedbackForm and FeedbackSubmission carry @@unique([tenantId, id]), so
//   questions and answers reference them through COMPOSITE foreign keys and a
//   cross-tenant child is refused by the database. Every query below ALSO
//   filters on tenantId — a structural guarantee about WRITES is not a
//   guarantee about READS.
//
// THE QUERY BUDGET
//   Every method issues a FIXED number of statements. The paginated reads cost
//   two (a page and its count); every other method costs one, except
//   `replaceAnswers`, which is a delete plus a createMany inside a caller-
//   supplied transaction. There is no per-row read anywhere: a form's questions
//   travel with it through a nested select, and a cohort's answers are read for
//   the whole set at once rather than one submission at a time.
//
// INDEXES THIS RELIES ON
//   FeedbackForm       @@index([tenantId, status, sessionType])
//   FeedbackQuestion   @@index([tenantId, formId, sequence])
//   FeedbackSubmission @@index([tenantId, facultyId, courseId, semesterId,
//                               status])  — the faculty report, exactly
//   FeedbackAnswer     @@index([tenantId, submissionId])
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import {
  FeedbackSubmissionStatus,
  type FeedbackFormStatus,
  type Prisma,
  type SessionType,
} from "@/app/generated/prisma/client";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/** A page of rows and the total that satisfied the same predicate. */
export interface Page<T> {
  readonly rows: readonly T[];
  readonly total: number;
}

/** Question columns. Every one — the model holds nothing private. */
export const QUESTION_SELECT = {
  id: true,
  formId: true,
  code: true,
  text: true,
  category: true,
  weight: true,
  sequence: true,
  isRequired: true,
  allowsComment: true,
} as const;

/**
 * Form columns, with the questions nested.
 *
 * Nested rather than read separately: a form is unusable without its questions,
 * and fetching them per form would be the N+1 this layer exists to avoid.
 */
export const FORM_SELECT = {
  id: true,
  tenantId: true,
  code: true,
  name: true,
  description: true,
  version: true,
  status: true,
  sessionType: true,
  statusChangedAt: true,
  createdAt: true,
  updatedAt: true,
  questions: { select: QUESTION_SELECT, orderBy: { sequence: "asc" } },
} as const;

/**
 * A submission WITHOUT the student's identity.
 *
 * The faculty-facing projection. `studentId` is absent, so a query using this
 * shape cannot return it however the result is later handled — no masking step
 * exists to be skipped, because there is nothing to mask.
 */
export const ANONYMOUS_SUBMISSION_SELECT = {
  id: true,
  formId: true,
  facultyId: true,
  courseId: true,
  semesterId: true,
  status: true,
  submittedAt: true,
  createdAt: true,
} as const;

/**
 * A submission WITH the student's identity.
 *
 * The audit projection, for UNIVERSITY_ADMIN alone. It is a strict superset of
 * ANONYMOUS_SUBMISSION_SELECT by exactly one key, which a test asserts — so the
 * two shapes cannot silently converge.
 */
export const ATTRIBUTED_SUBMISSION_SELECT = {
  ...ANONYMOUS_SUBMISSION_SELECT,
  studentId: true,
} as const;

/** Answer columns. */
export const ANSWER_SELECT = {
  id: true,
  submissionId: true,
  questionId: true,
  rating: true,
  comment: true,
} as const;

/**
 * The only status an analytic reads.
 *
 * A DRAFT is a student mid-thought. Averaging it would let a half-finished
 * form move a faculty member's score, and the student never said it was done.
 */
export const ANALYSABLE_STATUS = FeedbackSubmissionStatus.SUBMITTED;

/**
 * Form ordering: newest version of each code first.
 *
 * `id` closes it so the order is TOTAL — offset pagination over a non-total
 * order silently skips one row and repeats another between pages.
 */
export const FORM_ORDER_BY = [
  { code: "asc" },
  { version: "desc" },
  { id: "asc" },
] as const;

/** Submission ordering: newest first, then a unique tiebreaker. */
export const SUBMISSION_ORDER_BY = [
  { submittedAt: "desc" },
  { id: "desc" },
] as const;

export class FeedbackRepository {
  // --- Forms and questions --------------------------------------------------

  /**
   * The forms available, filtered and paged.
   *
   * COST: two statements — the page and its count under the identical
   * predicate, so the total can never describe a wider set than the caller can
   * read.
   */
  async listForms(
    tenantId: string,
    filters: FormFilters,
    client: DbClient = prisma
  ): Promise<Page<FormRow>> {
    const where: Prisma.FeedbackFormWhereInput = {
      tenantId,
      ...(filters.status === undefined ? {} : { status: filters.status }),
      ...(filters.sessionType === undefined ? {} : { sessionType: filters.sessionType }),
      ...(filters.code === undefined ? {} : { code: filters.code }),
    };

    const rows = await client.feedbackForm.findMany({
      where,
      select: FORM_SELECT,
      orderBy: [...FORM_ORDER_BY],
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    });

    const total = await client.feedbackForm.count({ where });

    return { rows, total };
  }

  /**
   * One form with its questions, tenant-scoped.
   *
   * findFirst rather than findUnique: findUnique accepts only a unique key, so
   * the tenant predicate could not be part of the lookup and would have to be
   * checked after the row was read. Checking afterwards means a caller who can
   * distinguish "found but not yours" from "not found" learns that another
   * tenant's form exists.
   *
   * COST: one statement.
   */
  async findFormById(tenantId: string, formId: string, client: DbClient = prisma) {
    return client.feedbackForm.findFirst({
      where: { id: formId, tenantId },
      select: FORM_SELECT,
    });
  }

  /**
   * A form's questions on their own.
   *
   * Exists for the answer-validation path, which needs the question set but not
   * the form around it.
   *
   * COST: one statement.
   */
  async findQuestions(tenantId: string, formId: string, client: DbClient = prisma) {
    return client.feedbackQuestion.findMany({
      where: { tenantId, formId },
      select: QUESTION_SELECT,
      orderBy: { sequence: "asc" },
    });
  }

  // --- Submissions ----------------------------------------------------------

  /**
   * One student's existing submission for a context, if any.
   *
   * The duplicate-prevention READ. It reports whether a row exists; whether
   * that means "refuse" or "update" is a lifecycle decision the service makes,
   * and the unique constraint is what actually enforces it under a race.
   *
   * COST: one statement.
   */
  async findSubmission(
    tenantId: string,
    key: SubmissionKey,
    client: DbClient = prisma
  ) {
    return client.feedbackSubmission.findFirst({
      where: {
        tenantId,
        studentId: key.studentId,
        facultyId: key.facultyId,
        courseId: key.courseId,
        semesterId: key.semesterId,
        formId: key.formId,
      },
      select: ATTRIBUTED_SUBMISSION_SELECT,
    });
  }

  /**
   * One submission by id, ATTRIBUTED.
   *
   * Used on the write path, where the service must confirm the caller owns the
   * row it is about to change — which requires knowing whose it is.
   *
   * COST: one statement.
   */
  async findSubmissionById(
    tenantId: string,
    submissionId: string,
    client: DbClient = prisma
  ) {
    return client.feedbackSubmission.findFirst({
      where: { id: submissionId, tenantId },
      select: ATTRIBUTED_SUBMISSION_SELECT,
    });
  }

  /**
   * Every ANALYSABLE submission about one faculty member.
   *
   * ANONYMOUS: the projection omits studentId, so this read cannot disclose an
   * identity to the faculty member it is about. Index-backed by
   * @@index([tenantId, facultyId, courseId, semesterId, status]) — the exact
   * shape of this predicate.
   *
   * `courseId` and `semesterId` narrow optionally: a faculty member's whole
   * record, one course's, or one semester's.
   *
   * COST: one statement.
   */
  async findSubmissionsForFaculty(
    tenantId: string,
    facultyId: string,
    filters: FacultyReportFilters = {},
    client: DbClient = prisma
  ) {
    return client.feedbackSubmission.findMany({
      where: {
        tenantId,
        facultyId,
        status: ANALYSABLE_STATUS,
        ...(filters.courseId === undefined ? {} : { courseId: filters.courseId }),
        ...(filters.semesterId === undefined ? {} : { semesterId: filters.semesterId }),
        ...(filters.formId === undefined ? {} : { formId: filters.formId }),
      },
      select: ANONYMOUS_SUBMISSION_SELECT,
      orderBy: [...SUBMISSION_ORDER_BY],
    });
  }

  /**
   * Every ANALYSABLE submission about one faculty member, ATTRIBUTED.
   *
   * The audit read, for UNIVERSITY_ADMIN alone. Identical predicate to the
   * method above and a different projection — deliberately two methods rather
   * than one with a boolean, because a boolean parameter is a thing a caller
   * can pass wrongly and a method name is not.
   *
   * COST: one statement.
   */
  async findAttributedSubmissionsForFaculty(
    tenantId: string,
    facultyId: string,
    filters: FacultyReportFilters = {},
    client: DbClient = prisma
  ) {
    return client.feedbackSubmission.findMany({
      where: {
        tenantId,
        facultyId,
        status: ANALYSABLE_STATUS,
        ...(filters.courseId === undefined ? {} : { courseId: filters.courseId }),
        ...(filters.semesterId === undefined ? {} : { semesterId: filters.semesterId }),
        ...(filters.formId === undefined ? {} : { formId: filters.formId }),
      },
      select: ATTRIBUTED_SUBMISSION_SELECT,
      orderBy: [...SUBMISSION_ORDER_BY],
    });
  }

  /**
   * Every analysable submission matching a report scope.
   *
   * The institution-wide read behind GET /api/feedback/report. ANONYMOUS: a
   * report is a statement about a population, and an identity has no place in
   * one.
   *
   * COST: one statement.
   */
  async findSubmissionsForReport(
    tenantId: string,
    filters: ReportFilters,
    client: DbClient = prisma
  ) {
    return client.feedbackSubmission.findMany({
      where: {
        tenantId,
        status: ANALYSABLE_STATUS,
        ...(filters.formId === undefined ? {} : { formId: filters.formId }),
        ...(filters.semesterId === undefined ? {} : { semesterId: filters.semesterId }),
        ...(filters.courseId === undefined ? {} : { courseId: filters.courseId }),
        ...(filters.facultyId === undefined ? {} : { facultyId: filters.facultyId }),
        ...(filters.departmentId === undefined
          ? {}
          : { faculty: { departmentId: filters.departmentId } }),
      },
      select: ANONYMOUS_SUBMISSION_SELECT,
      orderBy: [...SUBMISSION_ORDER_BY],
    });
  }

  /**
   * How many analysable submissions one faculty member has.
   *
   * A COUNT, not a verdict. Whether it clears the disclosure threshold is a
   * comparison, and a comparison is a decision — the domain engine makes it.
   * This method is named for what it counts rather than for what the caller
   * intends to conclude.
   *
   * COST: one statement.
   */
  async countSubmissionsForFaculty(
    tenantId: string,
    facultyId: string,
    filters: FacultyReportFilters = {},
    client: DbClient = prisma
  ) {
    return client.feedbackSubmission.count({
      where: {
        tenantId,
        facultyId,
        status: ANALYSABLE_STATUS,
        ...(filters.courseId === undefined ? {} : { courseId: filters.courseId }),
        ...(filters.semesterId === undefined ? {} : { semesterId: filters.semesterId }),
        ...(filters.formId === undefined ? {} : { formId: filters.formId }),
      },
    });
  }

  /**
   * Create a submission in DRAFT.
   *
   * The unique constraint on (studentId, facultyId, courseId, semesterId,
   * formId) is what actually prevents a duplicate — a prior read cannot, because
   * two concurrent submits both see nothing and both proceed. The service
   * catches the constraint violation; this method simply attempts the write.
   *
   * COST: one statement.
   */
  async createSubmission(input: CreateSubmissionInput, client: DbClient = prisma) {
    return client.feedbackSubmission.create({
      data: {
        tenantId: input.tenantId,
        formId: input.formId,
        studentId: input.studentId,
        facultyId: input.facultyId,
        courseId: input.courseId,
        semesterId: input.semesterId,
        status: input.status,
        submittedAt: input.submittedAt,
      },
      select: ATTRIBUTED_SUBMISSION_SELECT,
    });
  }

  /**
   * Move a submission's status.
   *
   * The compound selector carries its OWN tenant predicate rather than
   * inheriting one from a preceding read — the same TOCTOU defence Phase 16
   * established. Which transitions are legal is the SERVICE's rule.
   *
   * COST: one statement.
   */
  async updateSubmissionStatus(
    tenantId: string,
    submissionId: string,
    status: FeedbackSubmissionStatus,
    submittedAt: Date | null,
    client: DbClient = prisma
  ) {
    return client.feedbackSubmission.update({
      where: { tenantId_id: { tenantId, id: submissionId } },
      data: { status, submittedAt },
      select: ATTRIBUTED_SUBMISSION_SELECT,
    });
  }

  // --- Answers --------------------------------------------------------------

  /**
   * One submission's answers.
   *
   * COST: one statement.
   */
  async findAnswers(tenantId: string, submissionId: string, client: DbClient = prisma) {
    return client.feedbackAnswer.findMany({
      where: { tenantId, submissionId },
      select: ANSWER_SELECT,
      orderBy: { questionId: "asc" },
    });
  }

  /**
   * Every answer belonging to a SET of submissions.
   *
   * Takes a set, not one id, so aggregating a cohort of two hundred costs ONE
   * statement rather than two hundred. This is the shape that keeps a report
   * free of an N+1 — the domain engine groups the flat result.
   *
   * COST: one statement.
   */
  async findAnswersForSubmissions(
    tenantId: string,
    submissionIds: readonly string[],
    client: DbClient = prisma
  ) {
    if (submissionIds.length === 0) {
      return [];
    }

    return client.feedbackAnswer.findMany({
      where: { tenantId, submissionId: { in: [...submissionIds] } },
      select: ANSWER_SELECT,
    });
  }

  /**
   * Replace a submission's answers, wholesale.
   *
   * Delete-then-insert rather than a per-row diff, for the same reason the
   * open-elective preference list uses it: the (submissionId, questionId)
   * unique constraint makes a partial update a minefield, and clearing first
   * removes the hazard entirely. Editing is permitted only while the form is
   * OPEN, which the service enforces.
   *
   * The caller MUST supply a transaction handle — these are two statements that
   * are only correct together, and a crash between them would leave a student
   * with a submission carrying no answers at all.
   *
   * COST: two statements.
   */
  async replaceAnswers(
    tenantId: string,
    submissionId: string,
    rows: readonly AnswerInput[],
    client: DbClient
  ): Promise<number> {
    await client.feedbackAnswer.deleteMany({ where: { tenantId, submissionId } });

    if (rows.length === 0) {
      return 0;
    }

    const created = await client.feedbackAnswer.createMany({
      data: rows.map((row) => ({
        tenantId,
        submissionId,
        questionId: row.questionId,
        rating: row.rating,
        comment: row.comment ?? null,
      })),
    });

    return created.count;
  }

  /**
   * Run work inside one interactive transaction.
   *
   * Mirrors CourseRegistrationRepository's and OpenElectiveRepository's own
   * helpers rather than introducing a third way to do it.
   */
  async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    return prisma.$transaction((tx) => fn(tx));
  }
}

// --- Input and row shapes ---------------------------------------------------
//
// Declared STRUCTURALLY rather than imported as the validation module's
// inferred types, so the repository depends on the shape it needs rather than
// on a Zod schema — an optional field added to a schema then cannot silently
// change a query.

/** Filters the form list accepts. */
export interface FormFilters {
  readonly page: number;
  readonly limit: number;
  readonly status?: FeedbackFormStatus;
  readonly sessionType?: SessionType;
  readonly code?: string;
}

/** The five columns that identify one student's feedback uniquely. */
export interface SubmissionKey {
  readonly studentId: string;
  readonly facultyId: string;
  readonly courseId: string;
  readonly semesterId: string;
  readonly formId: string;
}

/** Filters a faculty-scoped read accepts. */
export interface FacultyReportFilters {
  readonly courseId?: string;
  readonly semesterId?: string;
  readonly formId?: string;
}

/** Filters the institution-wide report accepts. */
export interface ReportFilters {
  readonly formId?: string;
  readonly semesterId?: string;
  readonly courseId?: string;
  readonly facultyId?: string;
  readonly departmentId?: string;
}

/** A submission to create. */
export interface CreateSubmissionInput extends SubmissionKey {
  readonly tenantId: string;
  readonly status: FeedbackSubmissionStatus;
  readonly submittedAt: Date | null;
}

/** One answer to write. */
export interface AnswerInput {
  readonly questionId: string;
  readonly rating: number;
  readonly comment?: string | null;
}

export type FormRow = Prisma.FeedbackFormGetPayload<{ select: typeof FORM_SELECT }>;

export type QuestionRow = Prisma.FeedbackQuestionGetPayload<{
  select: typeof QUESTION_SELECT;
}>;

export type AnonymousSubmissionRow = Prisma.FeedbackSubmissionGetPayload<{
  select: typeof ANONYMOUS_SUBMISSION_SELECT;
}>;

export type AttributedSubmissionRow = Prisma.FeedbackSubmissionGetPayload<{
  select: typeof ATTRIBUTED_SUBMISSION_SELECT;
}>;

export type AnswerRow = Prisma.FeedbackAnswerGetPayload<{ select: typeof ANSWER_SELECT }>;

export const feedbackRepository = new FeedbackRepository();
