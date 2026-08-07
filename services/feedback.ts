// ============================================================================
// MODULE : Services — Faculty & Lab Feedback
// PURPOSE: Student submission of teaching feedback, and the two reports staff
//          read it through.
//
// THE ANONYMITY BOUNDARY IS THE BACKEND'S, NOT THIS LAYER'S
//   GET /api/feedback/faculty/[facultyId] returns a FacultySummary whose
//   `analytics` is null whenever disclosure is withheld — too few responses to
//   anonymise, typically. `disclosure` says why. A page MUST render that reason
//   rather than treating null as "no data": the two mean opposite things, and
//   showing "no feedback yet" for suppressed scores misrepresents both the
//   lecturer and the students who answered.
//
// TWO SUBMISSION ENDPOINTS, ONE BODY
//   /faculty and /lab take an identical payload and differ only in which form
//   they target — a LECTURE form or a LAB form. The pair is kept as two
//   functions because the caller always knows which it means, and a boolean
//   parameter would read as configuration rather than as the two distinct acts
//   they are.
// ============================================================================

import type { FeedbackSubmissionResultDto } from "@/lib/dto/feedback.dto";
import type { AggregateSummary, FacultySummary } from "@/lib/domain/feedback/report";
import type { FeedbackCategory } from "@/app/generated/prisma/enums";
import type { ApiResponse, ListParams } from "@/types";
import { apiRequest } from "./client";

/** One answer on a questionnaire. `rating` is 1..5. */
export interface FeedbackAnswerInput {
  questionId: string;
  rating: number;
  comment?: string;
}

/** Which teaching a submission is about. All four are required. */
export interface FeedbackContext {
  formId: string;
  facultyId: string;
  courseId: string;
  semesterId: string;
}

export interface SubmitFeedbackInput extends FeedbackContext {
  answers: FeedbackAnswerInput[];
  /**
   * False saves progress as a DRAFT; true finishes.
   *
   * Defaults to true because submitting is the ordinary act. A DRAFT is the
   * deliberate case, and completeness against the form's required questions is
   * checked server-side before a SUBMITTED status is written — so a partial
   * form sent with `isFinal` true is rejected rather than silently downgraded.
   */
  isFinal?: boolean;
}

/** Submit feedback on a lecture. STUDENT only. */
export async function submitFacultyFeedback(
  input: SubmitFeedbackInput
): Promise<ApiResponse<FeedbackSubmissionResultDto>> {
  return apiRequest<FeedbackSubmissionResultDto>("/api/feedback/faculty", {
    method: "POST",
    body: input,
  });
}

/** Submit feedback on a lab session. STUDENT only. */
export async function submitLabFeedback(
  input: SubmitFeedbackInput
): Promise<ApiResponse<FeedbackSubmissionResultDto>> {
  return apiRequest<FeedbackSubmissionResultDto>("/api/feedback/lab", {
    method: "POST",
    body: input,
  });
}

/**
 * Extends ListParams for its index signature, not for its pagination: this
 * endpoint takes no ?page, and the client's query builder is typed against
 * ListParams. Without the base type an object literal of named filters is not
 * assignable to it.
 */
export interface FacultyFeedbackFilters extends ListParams {
  courseId?: string;
  semesterId?: string;
  formId?: string;
}

/**
 * One lecturer's feedback summary.
 *
 * Readable by UNIVERSITY_ADMIN, DEPARTMENT_HOD, and by the lecturer about
 * themselves. See the module header on why `analytics: null` must be rendered
 * through `disclosure` rather than as an empty state.
 */
export async function getFacultyFeedback(
  facultyId: string,
  filters?: FacultyFeedbackFilters
): Promise<ApiResponse<FacultySummary>> {
  return apiRequest<FacultySummary>(`/api/feedback/faculty/${facultyId}`, {
    params: filters,
  });
}

/** Extends ListParams for its index signature — see FacultyFeedbackFilters. */
export interface FeedbackReportFilters extends ListParams {
  formId?: string;
  semesterId?: string;
  courseId?: string;
  facultyId?: string;
  departmentId?: string;
  category?: FeedbackCategory;
}

/**
 * A department-wide or institution-wide summary. UNIVERSITY_ADMIN and
 * DEPARTMENT_HOD only.
 *
 * `overallAverage` is the mean of the faculty averages — each lecturer counting
 * once — not the mean of all submissions. A lecturer with 200 responses must
 * not outweigh one with 20 in a figure that describes the department.
 */
export async function getFeedbackReport(
  filters?: FeedbackReportFilters
): Promise<ApiResponse<AggregateSummary>> {
  return apiRequest<AggregateSummary>("/api/feedback/report", { params: filters });
}
