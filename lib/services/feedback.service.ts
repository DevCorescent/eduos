// ============================================================================
// OWNER      : Gauransh
// MODULE     : Faculty Feedback System
// LAYER      : Service
// PURPOSE    : Orchestrate the four feedback use cases.
// ARCHITECTURE:
//                Repository  ->  Domain Engine  ->  Repository  ->  DTO
//
//   • The SERVICE owns authorisation outcomes, transaction boundaries and the
//     order in which questions are asked — and nothing else.
//   • It computes NO statistic. Averages, category scores, distributions, the
//     disclosure threshold, eligibility and completeness all live in
//     lib/domain/feedback, which this file calls and never reimplements.
//   • It performs NO masking. The repository publishes two projections and this
//     layer chooses between them by ROLE; there is no code path that receives
//     an identity and then removes it.
//
// THE DISCLOSURE DECISION IS MADE ONCE, BEFORE THE DATA IS READ
//   `getFacultyFeedback` counts first, asks the domain engine whether that count
//   clears the threshold, and only then reads the submissions. A faculty member
//   below the threshold never has their cohort's answers in memory at all —
//   which is a stronger guarantee than computing an aggregate and declining to
//   return it.
//
// FOUR ROLES, THREE AUTHORITIES
//   STUDENT submits about themselves. FACULTY reads their own record, gated.
//   DEPARTMENT_HOD reads any faculty member, gated the same way — see the
//   constants for why. UNIVERSITY_ADMIN reads everything, ungated, with
//   attribution.
// ============================================================================

import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE } from "@/lib/constants/errors";
import {
  FEEDBACK_EDITABLE_STATUS,
  FEEDBACK_MESSAGE,
  FEEDBACK_VIEWER,
  MAX_REPORT_COHORT,
  type FeedbackViewer,
} from "@/lib/constants/feedback";
import { FeedbackSubmissionStatus } from "@/app/generated/prisma/enums";
import type { FeedbackRepository } from "@/lib/repositories/feedback.repository";
import { evaluateCompletion, resolveStatus } from "@/lib/domain/feedback/completion";
import {
  evaluateEligibility,
  INELIGIBILITY_REASON,
  type ScheduledSession,
  type TeachingAssignment,
  type RegistrationEvidence,
} from "@/lib/domain/feedback/eligibility";
import { evaluateAccess } from "@/lib/domain/feedback/anonymity";
import {
  summariseAggregate,
  summariseFaculty,
  type AggregateSummary,
  type FacultySummary,
  type SubmissionWithAnswers,
} from "@/lib/domain/feedback/report";
import type { AnalyticQuestion } from "@/lib/domain/feedback/analytics";
import type { FeedbackSubmissionResultDto } from "@/lib/dto/feedback.dto";
import type {
  FacultyFeedbackQuery,
  FeedbackReportQuery,
  SubmitFeedbackInput,
} from "@/lib/validations/feedback.validation";

/**
 * The caller's authority, decided by the route and applied here.
 *
 * `facultyId` is present only for a FACULTY caller and is what confines them to
 * their own record — resolved from their user account by the route's guard,
 * never taken from the request.
 */
export type FeedbackAccess =
  | { readonly scope: "STUDENT"; readonly userId: string }
  | { readonly scope: "FACULTY"; readonly facultyId: string | null }
  | { readonly scope: "HOD" }
  | { readonly scope: "ADMIN" };

/** Resolves a student from a user, and the teaching evidence eligibility needs. */
export interface FeedbackStudentPort {
  findStudentByUserId(
    tenantId: string,
    userId: string
  ): Promise<{ readonly id: string } | null>;
  findRegistrations(
    tenantId: string,
    studentId: string,
    semesterId: string
  ): Promise<readonly RegistrationEvidence[]>;
}

/** Reads the assignment and timetable evidence, without deciding on it. */
export interface TeachingEvidencePort {
  findAssignments(
    tenantId: string,
    facultyId: string,
    courseId: string
  ): Promise<readonly TeachingAssignment[]>;
  findSessions(
    tenantId: string,
    facultyId: string,
    courseId: string,
    semesterId: string
  ): Promise<readonly ScheduledSession[]>;
}

/** Confirms a faculty member exists in this tenant. */
export interface FacultyLookupPort {
  facultyExists(tenantId: string, facultyId: string): Promise<boolean>;
}

export class FeedbackService {
  constructor(
    private readonly repository: FeedbackRepository,
    private readonly students: FeedbackStudentPort,
    private readonly evidence: TeachingEvidencePort,
    private readonly faculty: FacultyLookupPort
  ) {}

  // --------------------------------------------------------------------------
  // POST /api/feedback/faculty and POST /api/feedback/lab
  // --------------------------------------------------------------------------

  /**
   * Record a student's feedback, creating or updating one submission.
   *
   * ONE method for both endpoints, deliberately: they differ only in which FORM
   * they name, and the form's own `sessionType` is what makes a lab form a lab
   * form. Two methods would be two places for one rule to drift.
   *
   * Every decision below is delegated:
   *   eligibility.ts   may this student submit at all?
   *   completion.ts    are the answers coherent, and do they finish the form?
   *
   * COST: six statements plus one transaction.
   */
  async submitFeedback(
    tenantId: string,
    userId: string,
    input: SubmitFeedbackInput,
    now: Date
  ): Promise<FeedbackSubmissionResultDto> {
    const studentId = await this.resolveOwnStudent(tenantId, userId);

    const form = await this.repository.findFormById(tenantId, input.formId);

    if (form === null) {
      throw new AppError(FEEDBACK_MESSAGE.FORM_NOT_FOUND, 404, ERROR_CODE.NOT_FOUND);
    }

    const context = {
      facultyId: input.facultyId,
      courseId: input.courseId,
      semesterId: input.semesterId,
    };

    const [registrations, assignments, sessions, existing] = await Promise.all([
      this.students.findRegistrations(tenantId, studentId, input.semesterId),
      this.evidence.findAssignments(tenantId, input.facultyId, input.courseId),
      this.evidence.findSessions(
        tenantId,
        input.facultyId,
        input.courseId,
        input.semesterId
      ),
      this.repository.findSubmission(tenantId, { studentId, ...context, formId: input.formId }),
    ]);

    const eligibility = evaluateEligibility({
      context,
      formIsOpen: form.status === FEEDBACK_EDITABLE_STATUS,
      formSessionType: form.sessionType,
      registrations,
      assignments,
      sessions,
      hasExistingSubmission: existing !== null,
      existingIsSubmitted: existing?.status === FeedbackSubmissionStatus.SUBMITTED,
    });

    if (!eligibility.isEligible) {
      throw ineligibilityError(eligibility.reason);
    }

    const completion = evaluateCompletion(form.questions, input.answers);

    if (!completion.isValid) {
      throw new AppError(
        completion.unknownQuestions.length > 0
          ? FEEDBACK_MESSAGE.UNKNOWN_QUESTION
          : FEEDBACK_MESSAGE.COMMENT_NOT_INVITED,
        422,
        ERROR_CODE.VALIDATION
      );
    }

    // The student ASKED to finish; whether the answers support it is the domain
    // engine's call. Asking to finish an incomplete form saves the work as a
    // DRAFT rather than losing it, and the error below tells them why.
    const status = resolveStatus(completion, input.isFinal);

    if (input.isFinal && status !== FeedbackSubmissionStatus.SUBMITTED) {
      throw new AppError(FEEDBACK_MESSAGE.INCOMPLETE, 422, ERROR_CODE.VALIDATION);
    }

    const submittedAt = status === FeedbackSubmissionStatus.SUBMITTED ? now : null;

    const recorded = await this.repository.transaction(async (tx) => {
      const submission =
        existing === null
          ? await this.repository.createSubmission(
              {
                tenantId,
                studentId,
                ...context,
                formId: input.formId,
                status,
                submittedAt,
              },
              tx
            )
          : await this.repository.updateSubmissionStatus(
              tenantId,
              existing.id,
              status,
              submittedAt,
              tx
            );

      const written = await this.repository.replaceAnswers(
        tenantId,
        submission.id,
        input.answers,
        tx
      );

      return { submission, written };
    });

    return {
      submissionId: recorded.submission.id,
      status: recorded.submission.status,
      recorded: recorded.written,
      submittedAt: recorded.submission.submittedAt?.toISOString() ?? null,
    };
  }

  // --------------------------------------------------------------------------
  // GET /api/feedback/faculty/[facultyId]
  // --------------------------------------------------------------------------

  /**
   * One faculty member's feedback, gated by the caller's authority.
   *
   * THE COUNT IS READ BEFORE THE DATA. A caller below the threshold never has
   * the cohort's answers in memory — a stronger guarantee than computing an
   * aggregate and declining to return it.
   *
   * COST: two statements when withheld, four when disclosed.
   */
  async getFacultyFeedback(
    tenantId: string,
    facultyId: string,
    query: FacultyFeedbackQuery,
    access: FeedbackAccess
  ): Promise<FacultySummary> {
    const viewer = toViewer(access);

    if (!(await this.faculty.facultyExists(tenantId, facultyId))) {
      throw new AppError(FEEDBACK_MESSAGE.FACULTY_NOT_FOUND, 404, ERROR_CODE.NOT_FOUND);
    }

    const viewerFacultyId = access.scope === "FACULTY" ? access.facultyId : null;

    const count = await this.repository.countSubmissionsForFaculty(
      tenantId,
      facultyId,
      query
    );

    // Asked BEFORE a single submission is read, so a caller below the threshold
    // never has the cohort's answers in memory at all. The domain engine
    // decides; this layer only obeys.
    const disclosure = evaluateAccess(viewer, viewerFacultyId, facultyId, count);

    if (!disclosure.isVisible) {
      return {
        facultyId,
        submissionCount: count,
        disclosure,
        analytics: null,
        responseRate: null,
      };
    }

    const submissions = await this.repository.findSubmissionsForFaculty(
      tenantId,
      facultyId,
      query
    );

    const answers = await this.repository.findAnswersForSubmissions(
      tenantId,
      submissions.map((submission) => submission.id)
    );

    const questions = await this.loadQuestions(tenantId, query.formId, submissions);

    return summariseFaculty({
      facultyId,
      // The authoritative count, from the database — not the array's length.
      submissionCount: count,
      submissions: joinAnswers(submissions, answers),
      questions,
      viewer,
      viewerFacultyId,
    });
  }

  // --------------------------------------------------------------------------
  // GET /api/feedback/report
  // --------------------------------------------------------------------------

  /**
   * The institution-wide report.
   *
   * FACULTY never reaches this — the route excludes them — so no per-line
   * threshold is applied: the whole purpose of the document is comparison, and
   * a quality office withholding half its own report would be unusable.
   *
   * COST: three statements.
   */
  async getReport(
    tenantId: string,
    query: FeedbackReportQuery,
    access: FeedbackAccess
  ): Promise<AggregateSummary> {
    if (access.scope === "STUDENT" || access.scope === "FACULTY") {
      throw new AppError(FEEDBACK_MESSAGE.FORBIDDEN, 403, ERROR_CODE.FORBIDDEN);
    }

    const submissions = await this.repository.findSubmissionsForReport(tenantId, query);

    if (submissions.length > MAX_REPORT_COHORT) {
      throw new AppError(FEEDBACK_MESSAGE.COHORT_TOO_LARGE, 422, ERROR_CODE.VALIDATION);
    }

    const answers = await this.repository.findAnswersForSubmissions(
      tenantId,
      submissions.map((submission) => submission.id)
    );

    const questions = await this.loadQuestions(tenantId, query.formId, submissions);

    return summariseAggregate(
      query.departmentId ?? query.facultyId ?? "INSTITUTION",
      joinAnswers(submissions, answers),
      questions
    );
  }

  // --------------------------------------------------------------------------
  // PRIVATE
  // --------------------------------------------------------------------------

  /**
   * Resolve the caller to the Student row they own.
   *
   * A permitted role with no Student row is FORBIDDEN, not served an empty
   * record — the same convention Phases 17 through 19 established for the
   * identical situation, with the same message so the two are indistinguishable.
   */
  private async resolveOwnStudent(tenantId: string, userId: string): Promise<string> {
    const own = await this.students.findStudentByUserId(tenantId, userId);

    if (own === null) {
      throw new AppError(FEEDBACK_MESSAGE.FORBIDDEN, 403, ERROR_CODE.FORBIDDEN);
    }

    return own.id;
  }

  /**
   * The question set an analytic scores against.
   *
   * Read from the named form when the caller filtered by one; otherwise from
   * every form the submissions cite. A cohort spanning two forms is unusual but
   * legitimate — a semester may run a lecture form and a lab form — and scoring
   * it against one form's questions would silently drop the other's answers.
   *
   * COST: one statement per distinct form, and the distinct-form count is one
   * in every ordinary case.
   */
  private async loadQuestions(
    tenantId: string,
    formId: string | undefined,
    submissions: readonly { readonly formId: string }[]
  ): Promise<readonly AnalyticQuestion[]> {
    const formIds =
      formId === undefined
        ? [...new Set(submissions.map((submission) => submission.formId))]
        : [formId];

    const questions: AnalyticQuestion[] = [];

    for (const id of formIds) {
      const rows = await this.repository.findQuestions(tenantId, id);

      for (const row of rows) {
        questions.push({
          id: row.id,
          code: row.code,
          category: row.category,
          // Decimal(5,2) -> integer hundredths, converted once, here. The
          // domain engine holds no opinion about how a weight is stored.
          weightScaled: Math.round(Number(row.weight.toFixed(2)) * 100),
        });
      }
    }

    return questions;
  }
}

// --- Helpers ----------------------------------------------------------------

/** Map an access authority to the viewer the domain engine reasons about. */
function toViewer(access: FeedbackAccess): FeedbackViewer {
  switch (access.scope) {
    case "ADMIN":
      return FEEDBACK_VIEWER.ADMIN;
    case "HOD":
      return FEEDBACK_VIEWER.HOD;
    default:
      // A STUDENT never reaches a faculty report — the route refuses them — and
      // treating any non-staff caller as FACULTY means the strictest gate
      // applies if one ever did.
      return FEEDBACK_VIEWER.FACULTY;
  }
}

/** Attach each submission's answers to it, in ONE pass. */
function joinAnswers(
  submissions: readonly {
    readonly id: string;
    readonly facultyId: string;
    readonly courseId: string;
    readonly semesterId: string;
  }[],
  answers: readonly { readonly submissionId: string; readonly questionId: string; readonly rating: number }[]
): readonly SubmissionWithAnswers[] {
  const grouped = new Map<string, { questionId: string; rating: number }[]>();

  for (const answer of answers) {
    const held = grouped.get(answer.submissionId);

    if (held === undefined) {
      grouped.set(answer.submissionId, [answer]);
    } else {
      held.push(answer);
    }
  }

  return submissions.map((submission) => ({
    submissionId: submission.id,
    facultyId: submission.facultyId,
    courseId: submission.courseId,
    semesterId: submission.semesterId,
    answers: grouped.get(submission.id) ?? [],
  }));
}

/** Turn an ineligibility reason into the status and message it deserves. */
function ineligibilityError(reason: string | null): AppError {
  switch (reason) {
    case INELIGIBILITY_REASON.FORM_NOT_OPEN:
      // 409, not 403: the window shut. Telling a student "forbidden" when the
      // honest answer is "too late" sends them to the wrong person for help.
      return new AppError(FEEDBACK_MESSAGE.FORM_NOT_OPEN, 409, ERROR_CODE.CONFLICT);
    case INELIGIBILITY_REASON.ALREADY_SUBMITTED:
      return new AppError(FEEDBACK_MESSAGE.ALREADY_SUBMITTED, 409, ERROR_CODE.CONFLICT);
    case INELIGIBILITY_REASON.NO_LAB_SESSION:
      return new AppError(FEEDBACK_MESSAGE.NOT_A_LAB, 403, ERROR_CODE.FORBIDDEN);
    default:
      return new AppError(FEEDBACK_MESSAGE.NOT_TAUGHT, 403, ERROR_CODE.FORBIDDEN);
  }
}
