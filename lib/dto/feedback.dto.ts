// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Feedback System
// LAYER  : DTO
// PURPOSE: The shapes the four feedback endpoints return, and the boundary
//          conversions that produce them.
//
// THE ANONYMITY GUARANTEE IS CARRIED, NOT RE-DECIDED
//   There are TWO submission shapes and they differ by exactly one field:
//
//     FeedbackSubmissionDto            has no studentId
//     AttributedFeedbackSubmissionDto  has one
//
//   The anonymous mapper takes a row whose TYPE lacks studentId, so it cannot
//   emit one even by mistake — the guarantee is enforced by the repository's
//   projection and the compiler, not by this file remembering to omit a key.
//   A test asserts the two shapes differ by exactly that field, so they cannot
//   silently converge.
//
// NO STATISTIC IS COMPUTED HERE
//   Averages, category scores, weighted rollups and the disclosure decision all
//   belong to lib/domain/feedback, which Batch 3 introduces. This file carries
//   figures it was handed. A mapper that averaged something would put the same
//   arithmetic in two layers, and the day one changed the report and the
//   dashboard would disagree about a faculty member's score.
//
// RATINGS ARE INTEGERS AND STAY INTEGERS
//   A rating is 1..5, stored SMALLINT, and emitted as a JSON number. That is
//   safe precisely because it is a small integer — unlike money or a GPA, it has
//   no fractional part to lose. Any AVERAGE of ratings is a different matter and
//   will cross the boundary as a decimal string, for the reason every other
//   computed decimal in this project does.
// ============================================================================

import type {
  FeedbackCategory,
  FeedbackFormStatus,
  FeedbackSubmissionStatus,
  SessionType,
} from "@/app/generated/prisma/enums";
import type {
  AnswerRow,
  AnonymousSubmissionRow,
  AttributedSubmissionRow,
  FormRow,
  QuestionRow,
} from "@/lib/repositories/feedback.repository";

/** Anything Prisma hands back as a Decimal. */
type DecimalLike = { toFixed(places: number): string } | null;

/** The scale a question weight is stored at — Decimal(5,2). */
const WEIGHT_SCALE = 2;

/** Render a Decimal weight as a lossless string. */
export function weight(value: DecimalLike): string {
  return value === null || value === undefined ? "0.00" : value.toFixed(WEIGHT_SCALE);
}

/** Render a Date as ISO-8601, preserving the null. */
export function isoDate(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toISOString();
}

// --- Shapes -----------------------------------------------------------------

/** One question on a form. */
export interface FeedbackQuestionDto {
  id: string;
  code: string;
  text: string;
  category: FeedbackCategory;
  /** Decimal(5,2) as a lossless string. */
  weight: string;
  sequence: number;
  isRequired: boolean;
  allowsComment: boolean;
}

/**
 * A questionnaire, with its questions.
 *
 * `acceptsSubmissions` is derived from the status so a client need not restate
 * the rule that OPEN is the only writable state — and cannot get it wrong.
 */
export interface FeedbackFormDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  version: number;
  status: FeedbackFormStatus;
  /** LECTURE or LAB — which kind of teaching this form asks about. */
  sessionType: SessionType;
  /** True only while OPEN. Editing a submission is permitted exactly then. */
  acceptsSubmissions: boolean;
  questions: FeedbackQuestionDto[];
  statusChangedAt: string;
  createdAt: string;
}

/** One answer. */
export interface FeedbackAnswerDto {
  questionId: string;
  /** 1..5. A small integer, safe as a JSON number. */
  rating: number;
  comment: string | null;
}

/**
 * A submission WITHOUT the student's identity.
 *
 * The faculty-facing shape. It is built from a row whose type has no
 * `studentId`, so the omission is enforced by the compiler rather than by this
 * mapper remembering.
 */
export interface FeedbackSubmissionDto {
  id: string;
  formId: string;
  facultyId: string;
  courseId: string;
  semesterId: string;
  status: FeedbackSubmissionStatus;
  submittedAt: string | null;
  createdAt: string;
  /** Present only when the caller asked for one submission's detail. */
  answers?: FeedbackAnswerDto[];
}

/**
 * A submission WITH the student's identity.
 *
 * The audit shape, for UNIVERSITY_ADMIN alone. Extends the anonymous shape by
 * exactly one field, so the difference between the two is one key rather than
 * two divergent definitions.
 */
export interface AttributedFeedbackSubmissionDto extends FeedbackSubmissionDto {
  studentId: string;
}

/** What a student sees about their own feedback for one context. */
export interface MyFeedbackDto {
  submission: FeedbackSubmissionDto | null;
  /** True while the form is OPEN, so a client knows whether to render a form. */
  isEditable: boolean;
  answers: FeedbackAnswerDto[];
}

/** What was recorded when a student submitted. */
export interface FeedbackSubmissionResultDto {
  submissionId: string;
  status: FeedbackSubmissionStatus;
  /** How many answers were stored. Replaces the previous set wholesale. */
  recorded: number;
  submittedAt: string | null;
}

// --- Mappers ----------------------------------------------------------------

export function toQuestionDto(row: QuestionRow): FeedbackQuestionDto {
  return {
    id: row.id,
    code: row.code,
    text: row.text,
    category: row.category,
    weight: weight(row.weight),
    sequence: row.sequence,
    isRequired: row.isRequired,
    allowsComment: row.allowsComment,
  };
}

export function toFormDto(row: FormRow): FeedbackFormDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    version: row.version,
    status: row.status,
    sessionType: row.sessionType,
    // The single predicate that decides whether a client renders an editable
    // form. True only while OPEN, matching the lifecycle exactly.
    acceptsSubmissions: row.status === "OPEN",
    questions: row.questions.map(toQuestionDto),
    statusChangedAt: row.statusChangedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAnswerDto(row: AnswerRow): FeedbackAnswerDto {
  return {
    questionId: row.questionId,
    rating: row.rating,
    comment: row.comment,
  };
}

/**
 * Map a submission WITHOUT identity.
 *
 * The parameter type is `AnonymousSubmissionRow`, which has no `studentId`
 * property — so this function could not emit one even if a later edit tried.
 * That is the anonymity guarantee expressed in the type system rather than in a
 * comment.
 */
export function toSubmissionDto(
  row: AnonymousSubmissionRow,
  answers?: readonly AnswerRow[]
): FeedbackSubmissionDto {
  return {
    id: row.id,
    formId: row.formId,
    facultyId: row.facultyId,
    courseId: row.courseId,
    semesterId: row.semesterId,
    status: row.status,
    submittedAt: isoDate(row.submittedAt),
    createdAt: row.createdAt.toISOString(),
    ...(answers === undefined ? {} : { answers: answers.map(toAnswerDto) }),
  };
}

/**
 * Map a submission WITH identity, for audit.
 *
 * A separate function rather than a boolean on the one above, because a boolean
 * parameter is a thing a caller can pass wrongly and a function name is not. A
 * faculty-facing path that reached for this would have to name it, and naming
 * it is exactly the moment a reviewer notices.
 */
export function toAttributedSubmissionDto(
  row: AttributedSubmissionRow,
  answers?: readonly AnswerRow[]
): AttributedFeedbackSubmissionDto {
  return {
    ...toSubmissionDto(row, answers),
    studentId: row.studentId,
  };
}

/**
 * What a student sees about their own submission.
 *
 * Uses the ANONYMOUS shape even though the student owns the row: they already
 * know who they are, and echoing an identity back serves nothing while widening
 * the surface on which one could leak.
 */
export function toMyFeedbackDto(
  row: AnonymousSubmissionRow | null,
  answers: readonly AnswerRow[],
  isEditable: boolean
): MyFeedbackDto {
  return {
    submission: row === null ? null : toSubmissionDto(row),
    isEditable,
    answers: answers.map(toAnswerDto),
  };
}
