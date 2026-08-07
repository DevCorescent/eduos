// ============================================================================
// MODULE : Services — Academic Evaluation & Results
// PURPOSE: The regulation side of the system: schemes and the components,
//          rules and passing criteria beneath them; course registrations;
//          assessment events; marks upload; and every computed result.
//
// THE DTOs ARE IMPORTED, NOT RESTATED
//   Every shape below comes from lib/dto — the same module the routes build
//   their responses with. Hand-copying them into types/ would create a second
//   definition that drifts the first time a field is added, and the compiler
//   would not notice.
//
// FOUR SUB-COLLECTIONS HANG OFF A SCHEME, AND ONLY ONE IS PAGINATED
//   Components come back as a TREE, rules and passing criteria as whole lists.
//   None takes ?page — they are bounded by the scheme that owns them, and an
//   examiner checking a regulation needs all of it at once. So these use
//   apiRequest and not apiList; there is no pagination to normalise.
// ============================================================================

import type {
  AssessmentEventDTO,
  AssessmentEventListDTO,
} from "@/lib/dto/assessmentEvent.dto";
import type {
  BulkRegistrationResultDTO,
  CourseRegistrationDTO,
} from "@/lib/dto/courseRegistration.dto";
import type { EvaluationComponentTreeDTO } from "@/lib/dto/evaluationComponent.dto";
import type { EvaluationRuleListDTO } from "@/lib/dto/evaluationRule.dto";
import type {
  EvaluationSchemeDTO,
  EvaluationSchemeDetailDTO,
} from "@/lib/dto/evaluationScheme.dto";
import type { PassingCriterionListDTO } from "@/lib/dto/passingCriterion.dto";
import type {
  SemesterCohortResultDTO,
  StudentAnalyticsDTO,
  StudentResultDTO,
  TranscriptDTO,
} from "@/lib/dto/result.dto";
import type { MarkUploadResultDTO, MarksSheetDTO } from "@/lib/dto/studentComponentScore.dto";
import type {
  AssessmentEventStatus,
  EvaluationSchemeStatus,
  RegistrationStatus,
  RegistrationType,
} from "@/app/generated/prisma/enums";
import type { ApiResponse, ListParams, PaginatedResult } from "@/types";
import { apiList, apiRequest } from "./client";

// --- Evaluation schemes -----------------------------------------------------

export interface SchemeFilters extends ListParams {
  status?: EvaluationSchemeStatus;
  code?: string;
  gradeScaleId?: string;
}

export async function listSchemes(
  params?: SchemeFilters
): Promise<ApiResponse<PaginatedResult<EvaluationSchemeDTO>>> {
  return apiList<EvaluationSchemeDTO>("/api/evaluation-schemes", "schemes", params);
}

export async function getScheme(
  id: string
): Promise<ApiResponse<EvaluationSchemeDetailDTO>> {
  return apiRequest<EvaluationSchemeDetailDTO>(`/api/evaluation-schemes/${id}`);
}

/**
 * Publish a draft scheme.
 *
 * Activation is a separate endpoint rather than a PATCH of `status` because it
 * is a lifecycle transition with its own preconditions — a scheme whose
 * component weightings do not total correctly cannot be activated, and that
 * check belongs to the transition, not to a field write.
 */
export async function activateScheme(id: string): Promise<ApiResponse<EvaluationSchemeDTO>> {
  return apiRequest<EvaluationSchemeDTO>(`/api/evaluation-schemes/${id}/activate`, {
    method: "POST",
  });
}

/** Retire an active scheme. Same reasoning as activateScheme. */
export async function archiveScheme(id: string): Promise<ApiResponse<EvaluationSchemeDTO>> {
  return apiRequest<EvaluationSchemeDTO>(`/api/evaluation-schemes/${id}/archive`, {
    method: "POST",
  });
}

/**
 * A scheme's component tree.
 *
 * Returns the hierarchy AND its violations — a tree whose weightings do not
 * add up is still returned, with the problems named, because hiding it would
 * leave the person who has to fix it with nothing to look at.
 */
export async function getComponentTree(
  schemeId: string
): Promise<ApiResponse<EvaluationComponentTreeDTO>> {
  return apiRequest<EvaluationComponentTreeDTO>(
    `/api/evaluation-schemes/${schemeId}/components`
  );
}

export async function getSchemeRules(
  schemeId: string
): Promise<ApiResponse<EvaluationRuleListDTO>> {
  return apiRequest<EvaluationRuleListDTO>(`/api/evaluation-schemes/${schemeId}/rules`);
}

export async function getPassingCriteria(
  schemeId: string
): Promise<ApiResponse<PassingCriterionListDTO>> {
  return apiRequest<PassingCriterionListDTO>(
    `/api/evaluation-schemes/${schemeId}/passing-criteria`
  );
}

// --- Course registrations ---------------------------------------------------

export interface RegistrationFilters extends ListParams {
  studentId?: string;
  courseId?: string;
  semesterId?: string;
  sectionId?: string;
  status?: RegistrationStatus;
  registrationType?: RegistrationType;
}

export async function listRegistrations(
  params?: RegistrationFilters
): Promise<ApiResponse<PaginatedResult<CourseRegistrationDTO>>> {
  return apiList<CourseRegistrationDTO>(
    "/api/course-registrations",
    "registrations",
    params
  );
}

export async function getRegistration(
  id: string
): Promise<ApiResponse<CourseRegistrationDTO>> {
  return apiRequest<CourseRegistrationDTO>(`/api/course-registrations/${id}`);
}

/**
 * Register a cohort in one call.
 *
 * The result names what was SKIPPED as well as what was created — a bulk run
 * that reports only successes leaves the registrar unable to tell a duplicate
 * from a failure.
 */
export async function bulkRegister(
  body: unknown
): Promise<ApiResponse<BulkRegistrationResultDTO>> {
  return apiRequest<BulkRegistrationResultDTO>("/api/course-registrations/bulk", {
    method: "POST",
    body,
  });
}

// --- Assessment events ------------------------------------------------------

export interface AssessmentEventFilters extends ListParams {
  courseId?: string;
  semesterId?: string;
  sectionId?: string;
  evaluationComponentId?: string;
  status?: AssessmentEventStatus;
}

export async function listAssessmentEvents(
  params?: AssessmentEventFilters
): Promise<ApiResponse<PaginatedResult<AssessmentEventListDTO["events"][number]>>> {
  return apiList<AssessmentEventListDTO["events"][number]>(
    "/api/assessment-events",
    "events",
    params
  );
}

export async function getAssessmentEvent(
  id: string
): Promise<ApiResponse<AssessmentEventDTO>> {
  return apiRequest<AssessmentEventDTO>(`/api/assessment-events/${id}`);
}

/** Move an event through its lifecycle — schedule, lock, publish. */
export async function setAssessmentEventStatus(
  id: string,
  body: unknown
): Promise<ApiResponse<AssessmentEventDTO>> {
  return apiRequest<AssessmentEventDTO>(`/api/assessment-events/${id}/status`, {
    method: "POST",
    body,
  });
}

/**
 * The marks sheet for one sitting.
 *
 * Unpaginated by design: it is bounded by the class registered for that
 * sitting, and an examiner reconciling entries against a register needs the
 * whole list — a partial one invites the very transcription error the
 * reconciliation exists to catch.
 */
export async function getMarksSheet(
  assessmentEventId: string
): Promise<ApiResponse<MarksSheetDTO>> {
  return apiRequest<MarksSheetDTO>(`/api/assessment-events/${assessmentEventId}/marks`);
}

// --- Marks upload -----------------------------------------------------------

export interface MarkEntry {
  courseRegistrationId: string;
  [field: string]: unknown;
}

/**
 * Upload internal (continuous assessment) marks.
 *
 * One shape serves a single entry and a bulk sheet — a one-row upload is a
 * bulk upload of one, and two endpoints would double the validation surface
 * for no difference in meaning.
 */
export async function uploadInternalMarks(
  assessmentEventId: string,
  marks: MarkEntry[]
): Promise<ApiResponse<MarkUploadResultDTO>> {
  return apiRequest<MarkUploadResultDTO>("/api/results/internal", {
    method: "POST",
    body: { assessmentEventId, marks },
  });
}

/** Upload external (university examination) marks. Same contract as internal. */
export async function uploadExternalMarks(
  assessmentEventId: string,
  marks: MarkEntry[]
): Promise<ApiResponse<MarkUploadResultDTO>> {
  return apiRequest<MarkUploadResultDTO>("/api/results/external", {
    method: "POST",
    body: { assessmentEventId, marks },
  });
}

// --- Results ----------------------------------------------------------------

/** One student's computed result: components, totals, grades, SGPA and CGPA. */
export async function getStudentResult(
  studentId: string
): Promise<ApiResponse<StudentResultDTO>> {
  return apiRequest<StudentResultDTO>(`/api/results/student/${studentId}`);
}

/** A whole cohort's result for one semester, with statistics and ranks. */
export async function getSemesterResult(
  semesterId: string
): Promise<ApiResponse<SemesterCohortResultDTO>> {
  return apiRequest<SemesterCohortResultDTO>(`/api/results/semester/${semesterId}`);
}

/** The full academic transcript: every semester, credits earned, backlogs. */
export async function getTranscript(
  studentId: string
): Promise<ApiResponse<TranscriptDTO>> {
  return apiRequest<TranscriptDTO>(`/api/results/transcript/${studentId}`);
}

/** Trends, component breakdown and improvement for one student. */
export async function getStudentAnalytics(
  studentId: string
): Promise<ApiResponse<StudentAnalyticsDTO>> {
  return apiRequest<StudentAnalyticsDTO>(`/api/results/analytics/${studentId}`);
}
