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
import type {
  EvaluationComponentDTO,
  EvaluationComponentTreeDTO,
} from "@/lib/dto/evaluationComponent.dto";
import type { EvaluationRuleDTO, EvaluationRuleListDTO } from "@/lib/dto/evaluationRule.dto";
import type {
  EvaluationSchemeDTO,
  EvaluationSchemeDetailDTO,
} from "@/lib/dto/evaluationScheme.dto";
import type {
  PassingCriterionDTO,
  PassingCriterionListDTO,
} from "@/lib/dto/passingCriterion.dto";
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
import { MAX_LIST_LIMIT } from "@/types/api";
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
 * What POST /api/evaluation-schemes accepts.
 *
 * Mirrors createEvaluationSchemeSchema — the contract the endpoint actually
 * applies — rather than a looser restatement that would move the rejection
 * later. `code`, `name` and `gradeScaleId` are required; everything else
 * carries a schema default, so an omitted key lets the database apply it.
 *
 * `status`, `version` and `supersededById` are absent and unsettable. A new
 * regulation is always DRAFT at version 1, and the lifecycle moves only through
 * activateScheme and archiveScheme below.
 */
export interface SchemeInput {
  code: string;
  name: string;
  description?: string;
  gradeScaleId: string;
  attemptPolicy?: EvaluationSchemeDTO["attemptPolicy"];
  marksRounding?: EvaluationSchemeDTO["marksRounding"];
  marksPrecision?: number;
  gpaRounding?: EvaluationSchemeDTO["gpaRounding"];
  gpaPrecision?: number;
}

export async function createScheme(
  input: SchemeInput
): Promise<ApiResponse<EvaluationSchemeDTO>> {
  return apiRequest<EvaluationSchemeDTO>("/api/evaluation-schemes", {
    method: "POST",
    body: input,
  });
}

/**
 * Amend a draft regulation.
 *
 * `code` is deliberately absent from the patchable set: it is the identity a
 * revision shares with its siblings, and changing it would move the revision
 * into a different family while keeping a version number computed against the
 * old one. The endpoint refuses anything but a DRAFT.
 */
export async function updateScheme(
  id: string,
  input: Partial<Omit<SchemeInput, "code">>
): Promise<ApiResponse<EvaluationSchemeDTO>> {
  return apiRequest<EvaluationSchemeDTO>(`/api/evaluation-schemes/${id}`, {
    method: "PATCH",
    body: input,
  });
}

/**
 * Discard a draft regulation.
 *
 * Only a DRAFT may be discarded — an ACTIVE or ARCHIVED revision is part of the
 * historical record, because results computed under it must remain explicable.
 * Archival is the retirement path for those, and the endpoint answers 409 here.
 */
export async function deleteScheme(id: string): Promise<ApiResponse<null>> {
  return apiRequest<null>(`/api/evaluation-schemes/${id}`, { method: "DELETE" });
}

/** One grade scale a regulation may cite. */
export interface GradeScaleOption {
  id: string;
  code: string;
  name: string;
  version: number;
  status: string;
  method: string;
  /** Decimal(4,2) as a lossless string, e.g. "10.00". */
  maxGradePoint: string;
}

/**
 * The grade scales this tenant has.
 *
 * Required to create a scheme at all: `gradeScaleId` is mandatory and there was
 * no way for any client to resolve one before GET /api/grade-scales existed.
 * See that route for why it is read-only.
 */
export async function listGradeScales(): Promise<ApiResponse<GradeScaleOption[]>> {
  const result = await apiRequest<{ gradeScales: GradeScaleOption[] }>("/api/grade-scales");
  if (!result.success) return result;

  return { success: true, data: result.data.gradeScales };
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

// --- Scheme sub-collections: components, rules, passing criteria ------------
//
// EVERY ONE OF THESE REQUIRES THE OWNING SCHEME TO BE A DRAFT. That is not
// restated per function: it is a rule about stored state, applied by each
// service against the scheme it reads, and the endpoints answer 409
// ("Only a draft evaluation scheme can be modified or deleted") when it does
// not hold. The UI reads `isMutable` off the component tree rather than
// re-deriving it.

/** What POST/PATCH on a scheme's components accepts. Mirrors componentFields. */
export interface ComponentInput {
  code: string;
  name: string;
  description?: string;
  type: EvaluationComponentDTO["type"];
  sourceType?: EvaluationComponentDTO["sourceType"];
  maxMarks: number;
  weightage: number;
  aggregation?: EvaluationComponentDTO["aggregation"];
  rollup?: EvaluationComponentDTO["rollup"];
  sequence: number;
  isMandatory?: boolean;
  /** Null promotes a nested component back to the top level. */
  parentComponentId?: string | null;
}

export async function createComponent(
  schemeId: string,
  input: ComponentInput
): Promise<ApiResponse<EvaluationComponentDTO>> {
  return apiRequest<EvaluationComponentDTO>(
    `/api/evaluation-schemes/${schemeId}/components`,
    { method: "POST", body: input }
  );
}

export async function updateComponent(
  schemeId: string,
  componentId: string,
  input: Partial<ComponentInput>
): Promise<ApiResponse<EvaluationComponentDTO>> {
  return apiRequest<EvaluationComponentDTO>(
    `/api/evaluation-schemes/${schemeId}/components/${componentId}`,
    { method: "PATCH", body: input }
  );
}

export async function deleteComponent(
  schemeId: string,
  componentId: string
): Promise<ApiResponse<null>> {
  return apiRequest<null>(
    `/api/evaluation-schemes/${schemeId}/components/${componentId}`,
    { method: "DELETE" }
  );
}

/**
 * What POST/PATCH on a scheme's rules accepts.
 *
 * `config` is typed as the DTO's own union rather than `unknown`: the endpoint
 * validates it against `operation`, and the pairing is exactly what must not be
 * mismatched. `condition` is omitted from this side — see
 * components/shared/evaluationSchemeFields.ts for why a conditional rule is not
 * authored through the generated form.
 */
export interface RuleInput {
  componentId?: string | null;
  code: string;
  name: string;
  description?: string;
  phase: EvaluationRuleDTO["phase"];
  operation: EvaluationRuleDTO["operation"];
  sequence: number;
  config: EvaluationRuleDTO["config"];
}

export async function createRule(
  schemeId: string,
  input: RuleInput
): Promise<ApiResponse<EvaluationRuleDTO>> {
  return apiRequest<EvaluationRuleDTO>(`/api/evaluation-schemes/${schemeId}/rules`, {
    method: "POST",
    body: input,
  });
}

export async function updateRule(
  schemeId: string,
  ruleId: string,
  input: Partial<RuleInput>
): Promise<ApiResponse<EvaluationRuleDTO>> {
  return apiRequest<EvaluationRuleDTO>(
    `/api/evaluation-schemes/${schemeId}/rules/${ruleId}`,
    { method: "PATCH", body: input }
  );
}

export async function deleteRule(
  schemeId: string,
  ruleId: string
): Promise<ApiResponse<null>> {
  return apiRequest<null>(`/api/evaluation-schemes/${schemeId}/rules/${ruleId}`, {
    method: "DELETE",
  });
}

/** What POST/PATCH on a scheme's passing criteria accepts. Mirrors criterionFields. */
export interface CriterionInput {
  componentId?: string | null;
  code: string;
  name: string;
  description?: string;
  metric: PassingCriterionDTO["metric"];
  threshold: number;
  unit: PassingCriterionDTO["unit"];
  failureOutcome: PassingCriterionDTO["failureOutcome"];
}

export async function createCriterion(
  schemeId: string,
  input: CriterionInput
): Promise<ApiResponse<PassingCriterionDTO>> {
  return apiRequest<PassingCriterionDTO>(
    `/api/evaluation-schemes/${schemeId}/passing-criteria`,
    { method: "POST", body: input }
  );
}

export async function updateCriterion(
  schemeId: string,
  criterionId: string,
  input: Partial<CriterionInput>
): Promise<ApiResponse<PassingCriterionDTO>> {
  return apiRequest<PassingCriterionDTO>(
    `/api/evaluation-schemes/${schemeId}/passing-criteria/${criterionId}`,
    { method: "PATCH", body: input }
  );
}

export async function deleteCriterion(
  schemeId: string,
  criterionId: string
): Promise<ApiResponse<null>> {
  return apiRequest<null>(
    `/api/evaluation-schemes/${schemeId}/passing-criteria/${criterionId}`,
    { method: "DELETE" }
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

/** One option in a transcript or result student picker. */
export interface ResultStudentOption {
  id: string;
  name: string;
  enrollmentNo: string;
}

/**
 * The students whose results this caller may read — tester issue #48.
 *
 * NOT listStudents(). That reads /api/students, the student REGISTRY, which is
 * STUDENT_READ_ROLES and deliberately closed to the examination office — so the
 * Transcript picker was empty for a Controller of Examination and populated for
 * a head of department, which is exactly what was reported.
 *
 * This reads /api/results/students, gated on requireResultAccess — the same
 * boundary the transcript itself applies. The list can therefore never offer a
 * student whose transcript would then be refused, and it returns three columns
 * rather than the registry's fifteen.
 *
 * Unpaginated: an option list is read whole. The route caps it.
 */
export async function listResultStudents(): Promise<ApiResponse<ResultStudentOption[]>> {
  const result = await apiRequest<{ students: ResultStudentOption[] }>(
    "/api/results/students"
  );
  if (!result.success) return result;

  return { success: true, data: result.data.students };
}

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

/**
 * Record the Controller of Examination's sign-off on one cohort — PRD §17.4.
 *
 * APPROVAL IS NOT PUBLICATION. The endpoint writes APPROVED and never
 * PUBLISHED; §49.4 keeps the two stages apart, so approving does not release
 * anything to students.
 *
 * Sends at most a remark. The status, the timestamp and the approving user are
 * all server-side — the last of those comes from the session, so nothing on
 * this side can attribute the decision to somebody else.
 *
 * Returns the whole cohort report carrying the stored decision, so a caller
 * renders what was persisted rather than assuming its request succeeded as sent.
 */
export async function approveSemesterResult(
  semesterId: string,
  remarks?: string
): Promise<ApiResponse<SemesterCohortResultDTO>> {
  return apiRequest<SemesterCohortResultDTO>(
    `/api/results/semester/${semesterId}/approve`,
    { method: "POST", body: remarks ? { remarks } : {} }
  );
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

// --- Scheduling a sitting ---------------------------------------------------

/**
 * What the examination office supplies when scheduling an assessment event.
 *
 * Mirrors createAssessmentEventSchema, which is the contract the endpoint
 * actually applies. Two of its keys are deliberately absent from every caller
 * on this side:
 *
 *   sequenceNumber — assigned by the server from the sittings that already
 *                    exist. A caller able to choose it could hide a sitting
 *                    from a BEST_N aggregation.
 *   status         — moves only through POST /api/assessment-events/[id]/status,
 *                    where the state machine is applied.
 *
 * `maxMarks` is optional and usually omitted: the service then fills it from
 * the component's own scale, which is the common case and one the office should
 * not have to restate.
 */
export interface ScheduleAssessmentEventInput {
  evaluationComponentId: string;
  courseId: string;
  semesterId: string;
  sectionId?: string;
  title: string;
  maxMarks?: number;
  scheduledAt?: string;
}

/**
 * Schedule a sitting.
 *
 * The endpoint resolves every reference tenant-scoped and requires the
 * component's SCHEME to be ACTIVE — marks assessed under a still-editable draft
 * regulation would be graded by rules that could change afterwards. Neither
 * rule is restated here; this is the request, not a second opinion about it.
 */
export async function scheduleAssessmentEvent(
  input: ScheduleAssessmentEventInput
): Promise<ApiResponse<AssessmentEventDTO>> {
  return apiRequest<AssessmentEventDTO>("/api/assessment-events", {
    method: "POST",
    body: input,
  });
}

/** One component an assessment event may be scheduled against. */
export interface SchedulableComponent {
  id: string;
  code: string;
  name: string;
  /** The regulation it belongs to, so two schemes' components stay tellable apart. */
  schemeCode: string;
  /** Decimal as a lossless string — what the component itself contributes on. */
  maxMarks: string;
}

/**
 * Every component of every ACTIVE regulation, flattened.
 *
 * WHY ONLY ACTIVE SCHEMES
 *   AssessmentEventService.create refuses a component whose scheme is not
 *   ACTIVE. Offering a draft scheme's components would present choices the API
 *   answers 409 for — the options a form shows and the rule the API enforces
 *   have to be the same statement.
 *
 * WHY THE WHOLE TREE AND NOT JUST THE LEAVES
 *   Nothing in the service, the schema or the constants restricts a sitting to
 *   a leaf component. Filtering to leaves here would be a new business rule
 *   invented in the presentation layer, and it would silently withhold a
 *   legitimate arrangement.
 *
 * DEGRADES RATHER THAN FAILS. A scheme whose tree cannot be read contributes
 * nothing rather than emptying the list — the same treatment the reference
 * indexes give a forbidden collection.
 */
export async function schedulableComponents(): Promise<SchedulableComponent[]> {
  const schemes = await listSchemes({
    page: 1,
    limit: MAX_LIST_LIMIT,
    status: "ACTIVE",
  });

  if (!schemes.success) return [];

  // One request per active regulation, issued together. A university holds a
  // handful of them at once, and awaiting each in turn would put the whole
  // chain on the critical path of opening a dialog.
  const trees = await Promise.all(
    schemes.data.items.map(async (scheme) => ({
      scheme,
      result: await getComponentTree(scheme.id),
    }))
  );

  const components: SchedulableComponent[] = [];

  for (const { scheme, result } of trees) {
    if (!result.success) continue;

    // Iterative rather than recursive: the tree is arbitrarily deep and a
    // cycle would otherwise be a stack overflow instead of a bounded walk.
    const stack = [...result.data.tree];

    while (stack.length > 0) {
      const node = stack.pop()!;

      components.push({
        id: node.id,
        code: node.code,
        name: node.name,
        schemeCode: scheme.code,
        maxMarks: node.maxMarks,
      });

      stack.push(...node.children);
    }
  }

  return components.sort(
    (a, b) => a.schemeCode.localeCompare(b.schemeCode) || a.code.localeCompare(b.code)
  );
}
