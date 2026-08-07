// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Feedback System
// LAYER  : Validation
// PURPOSE: Shape and bounds for the four feedback requests.
//
// THE ANSWER SET IS WHERE THE REAL WORK IS
//   A submission is not a bag of ratings — it is a set of answers keyed by
//   question, and three things can be wrong with it that no per-field rule
//   catches:
//
//     • the same question answered twice   -> which rating counts?
//     • a rating outside 1..5              -> every aggregate assumes the bound
//     • a comment on a question that       -> free text nobody asked for, on a
//       does not invite one                   question with no place to show it
//
//   The first two are refused here. The third needs the QUESTION SET, which
//   only the database holds, so it is the service's — and this file does not
//   pretend otherwise.
//
//   Notably NOT refused here: a missing required answer. Completeness is
//   decidable only against the form's questions, so a partial submission is
//   valid input that produces a DRAFT rather than a 400.
//
// WHAT IS ENFORCED HERE AND WHAT IS NOT
//   Here : shape, the 1..5 bound, enum membership, duplicate questions, comment
//          length, and the stripping of identity keys.
//   Not  : whether the form is OPEN, whether the student was taught by that
//          faculty member, whether they already submitted, or whether the
//          question belongs to the form. All four need the database.
//
// SELF-SERVICE ON THE WRITE PATH
//   A student never names themselves. `studentId` is absent from both write
//   schemas and both are `.strict()`, so supplying one is a 400 rather than a
//   silent strip — on a write that records an opinion attributed to a person,
//   a rejected request is safer than a quietly corrected one.
// ============================================================================

import { z } from "zod";
import {
  FeedbackCategory,
  FeedbackFormStatus,
  SessionType,
} from "@/app/generated/prisma/enums";
import {
  MAX_COMMENT_LENGTH,
  MAX_QUESTIONS_PER_FORM,
  RATING_MAX,
  RATING_MIN,
} from "@/lib/constants/feedback";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { identifier } from "@/lib/validations/shared";

/**
 * One rating.
 *
 * Bounded by the constants rather than by literals, so the scale is declared in
 * exactly one place. An integer because the column is SMALLINT and every
 * aggregate downstream assumes whole numbers on a known span.
 */
const rating = z.number().int().min(RATING_MIN).max(RATING_MAX);

/** One answer to one question. */
const answerSchema = z
  .object({
    questionId: identifier,
    rating,
    /**
     * Optional free text. Whether the QUESTION invites one is checked by the
     * service, which has the question set; this only bounds what may be sent.
     */
    comment: z.string().trim().min(1).max(MAX_COMMENT_LENGTH).optional(),
  })
  .strict();

export type FeedbackAnswerInput = z.infer<typeof answerSchema>;

/** Whether every question appears at most once. */
function questionsAreDistinct(answers: readonly FeedbackAnswerInput[]): boolean {
  return new Set(answers.map((answer) => answer.questionId)).size === answers.length;
}

/**
 * The context a submission is about: faculty, course, semester — plus the form.
 *
 * These four plus the caller's own studentId are exactly the unique key the
 * database enforces. Declaring them together means the two write endpoints
 * cannot disagree about what identifies a submission.
 */
const submissionContext = {
  formId: identifier,
  facultyId: identifier,
  courseId: identifier,
  semesterId: identifier,
} as const;

/**
 * Body for POST /api/feedback/faculty and POST /api/feedback/lab.
 *
 * ONE schema for both endpoints, deliberately. The two differ only in which
 * FORM they target — a LECTURE form or a LAB form — and that is a property of
 * the form the caller names, not of the request shape. Two identical schemas
 * would be two places for one rule to drift.
 *
 * `.strict()` because this write records an opinion attributed to a person: a
 * misspelled key must be a 400, not a silent strip.
 */
export const submitFeedbackSchema = z
  .object({
    ...submissionContext,
    answers: z.array(answerSchema).min(1).max(MAX_QUESTIONS_PER_FORM),
    /**
     * Whether the student is finishing, or saving progress.
     *
     * Defaults to true because the ordinary act is submitting. A DRAFT is the
     * deliberate case, and completeness against the form's required questions
     * is checked by the service before a SUBMITTED status is written.
     */
    isFinal: z.boolean().default(true),
  })
  .strict()
  .refine((data) => questionsAreDistinct(data.answers), {
    message: "A question may be answered only once",
    path: ["answers"],
  });

export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;

/**
 * Query for GET /api/feedback/faculty/[facultyId].
 *
 * Read-lenient: an unknown key is stripped rather than rejected, so a client
 * appending a cache-busting parameter does not receive a 400.
 *
 * There is no `includeStudentIdentity` flag and there must never be one. Whether
 * a caller sees attribution is decided by their ROLE, in the service, against
 * the repository's two projections — a request parameter able to ask for
 * identity would be a request parameter someone eventually grants.
 */
export const facultyFeedbackQuerySchema = z.object({
  courseId: identifier.optional(),
  semesterId: identifier.optional(),
  formId: identifier.optional(),
});

export type FacultyFeedbackQuery = z.infer<typeof facultyFeedbackQuerySchema>;

/**
 * Query for GET /api/feedback/report.
 *
 * Every filter narrows an already tenant-scoped set. `departmentId` reaches
 * through the faculty relation, which is the only cross-model filter this
 * module needs.
 */
export const feedbackReportQuerySchema = z.object({
  formId: identifier.optional(),
  semesterId: identifier.optional(),
  courseId: identifier.optional(),
  facultyId: identifier.optional(),
  departmentId: identifier.optional(),
  category: z.enum(FeedbackCategory).optional(),
});

export type FeedbackReportQuery = z.infer<typeof feedbackReportQuerySchema>;

/** Query for listing forms. */
export const listFormsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(FeedbackFormStatus).optional(),
  sessionType: z.enum(SessionType).optional(),
  code: z.string().trim().min(1).max(64).optional(),
});

export type ListFormsQuery = z.infer<typeof listFormsQuerySchema>;

/**
 * Route param for /api/feedback/faculty/[facultyId].
 *
 * `facultyId` is an opaque cuid, so no format is asserted: an unrecognised but
 * well-formed id must be a 404 rather than a 400.
 */
export const facultyParamSchema = z.object({
  facultyId: identifier,
});

export type FacultyParam = z.infer<typeof facultyParamSchema>;

/**
 * The schemas a student submits, for the identity-stripping guarantee.
 *
 * Exported so a test can iterate them rather than naming each — a schema added
 * later is then covered automatically instead of being forgotten.
 */
export const STUDENT_FACING_SCHEMAS = [submitFeedbackSchema] as const;

/** Identity keys no request in this module may supply. */
export const FORBIDDEN_IDENTITY_KEYS = ["studentId", "userId", "tenantId"] as const;
