"use server";

// ============================================================================
// MODULE : Actions — Evaluation
// PURPOSE: Server Actions for the examination office's evaluation screens: the
//          assessment calendar, and the regulations behind it.
//          See actions/setup.ts for why mutations run server-side.
//
// AUTHORIZATION IS NOT DECIDED HERE.
//   POST /api/assessment-events applies ASSESSMENT_EVENT_MANAGE_ROLES and the
//   scheme endpoints apply EVALUATION_SCHEME_MANAGE_ROLES — both being
//   UNIVERSITY_ADMIN and CONTROLLER_OF_EXAMINATION. Each resolves the tenant
//   from the caller's own session and re-resolves every reference against it.
//   Re-checking in an action would be a second, weaker opinion about the same
//   question, and it is the endpoint a client cannot skip.
//
//   DEPARTMENT_HOD and FACULTY read the assessment calendar and the regulations
//   and write neither. Those boundaries live in lib/constants/assessmentEvent.ts
//   and lib/constants/evaluationScheme.ts and are not restated, widened or
//   worked around here.
// ============================================================================

import type { FormValues } from "@/components/shared/EntityFormModal";
import { NONE_VALUE } from "@/components/shared/evaluationSchemeFields";
import {
  activateScheme,
  approveSemesterResult,
  archiveScheme,
  createComponent,
  createCriterion,
  createRule,
  createScheme,
  deleteComponent,
  deleteCriterion,
  deleteRule,
  deleteScheme,
  scheduleAssessmentEvent,
  updateComponent,
  updateCriterion,
  updateRule,
  updateScheme,
  type ComponentInput,
  type CriterionInput,
  type RuleInput,
  type ScheduleAssessmentEventInput,
  type SchemeInput,
} from "@/services/evaluation";
import type { ApiResponse } from "@/types";
import type { ActionResult } from "./setup";

function str(values: FormValues, key: string): string {
  return String(values[key] ?? "").trim();
}

function optionalStr(values: FormValues, key: string): string | undefined {
  const value = str(values, key);
  return value === "" ? undefined : value;
}

/**
 * Schedule an assessment event.
 *
 * The three required references and the title are checked here so a missing one
 * lands on its own field: the API answers a schema rejection with a bare
 * "Invalid input" whose `details` never reach the client, which would put the
 * message in a banner with nothing to point at. All four are re-applied
 * server-side — these are for the person typing, not for safety.
 *
 * The rules that need stored state are NOT duplicated here and could not be:
 * whether the component's regulation is ACTIVE, whether each reference belongs
 * to this tenant, and which sitting number comes next are all decided by the
 * service against the database.
 */
export async function scheduleAssessmentEventAction(
  values: FormValues
): Promise<ActionResult> {
  const evaluationComponentId = str(values, "evaluationComponentId");
  const courseId = str(values, "courseId");
  const semesterId = str(values, "semesterId");

  if (evaluationComponentId === "") {
    return {
      success: false,
      error: "Select the component this sitting assesses.",
      code: "VALIDATION_ERROR",
      field: "evaluationComponentId",
    };
  }

  if (courseId === "") {
    return {
      success: false,
      error: "Select the course this sitting is for.",
      code: "VALIDATION_ERROR",
      field: "courseId",
    };
  }

  if (semesterId === "") {
    return {
      success: false,
      error: "Select the semester this sitting falls in.",
      code: "VALIDATION_ERROR",
      field: "semesterId",
    };
  }

  const title = str(values, "title");

  if (title.length < 2) {
    return {
      success: false,
      error: "Give the sitting a title of at least two characters.",
      code: "VALIDATION_ERROR",
      field: "title",
    };
  }

  // Optional, and left absent when blank so the service fills it from the
  // component's own scale. A non-numeric or negative entry is refused here
  // rather than sent, because boundedDecimal answers it with the generic
  // message every other schema failure produces.
  const rawMaxMarks = optionalStr(values, "maxMarks");
  let maxMarks: number | undefined;

  if (rawMaxMarks !== undefined) {
    const parsed = Number(rawMaxMarks);

    if (!Number.isFinite(parsed) || parsed < 0) {
      return {
        success: false,
        error: "Marked out of must be zero or above, or left blank.",
        code: "VALIDATION_ERROR",
        field: "maxMarks",
      };
    }

    maxMarks = parsed;
  }

  const input: ScheduleAssessmentEventInput = {
    evaluationComponentId,
    courseId,
    semesterId,
    // Absent rather than empty: the column is nullable and the schema treats a
    // missing key as "every section", which is not the same as a blank string.
    sectionId: optionalStr(values, "sectionId"),
    title,
    maxMarks,
    scheduledAt: optionalStr(values, "scheduledAt"),
  };

  return scheduleAssessmentEvent(input);
}

// ============================================================================
// Evaluation Schemes — management actions
//
// AUTHORIZATION IS NOT DECIDED HERE, for the reason the module header gives.
// Every endpoint below applies EVALUATION_SCHEME_MANAGE_ROLES — UNIVERSITY_ADMIN
// and CONTROLLER_OF_EXAMINATION — and resolves the tenant from the caller's own
// session. DEPARTMENT_HOD and FACULTY hold EVALUATION_SCHEME_READ_ROLES and are
// refused by that guard whatever the page rendered.
//
// NOR IS THE LIFECYCLE. "Only a draft may be amended or discarded", "the tree
// must validate before activation" and "the grade scale must be active" are all
// rules about STORED state, applied by the services against the row they read.
// Restating them here would be a second copy that goes stale; the endpoints
// answer 409 with a message written for the person who has to act on it.
//
// The scheme id arrives pre-bound through .bind(null, id) on the server, so it
// is never a mutable value in the client payload — the browser cannot retarget
// an action at a different regulation.
// ============================================================================

/** Reads a select whose "none" option means an explicit null, not "unset". */
function nullableRef(values: FormValues, key: string): string | null {
  const value = str(values, key);
  return value === "" || value === NONE_VALUE ? null : value;
}

function num(values: FormValues, key: string, fallback: number): number {
  const raw = values[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const numeric = Number(raw);
  return Number.isNaN(numeric) ? fallback : numeric;
}

/** Attach `field: "code"` to a duplicate, leave every other failure alone. */
function withCodeField(result: ApiResponse<unknown>): ActionResult {
  if (!result.success && result.code === "CONFLICT") return { ...result, field: "code" };
  return result;
}

/** A required text field, reported against itself rather than in a banner. */
function required(
  values: FormValues,
  key: string,
  message: string
): ActionResult | null {
  if (str(values, key) === "") {
    return { success: false, error: message, code: "VALIDATION_ERROR", field: key };
  }
  return null;
}

// --- The regulation itself --------------------------------------------------

export async function createSchemeAction(values: FormValues): Promise<ActionResult> {
  const missing =
    required(values, "code", "Give the regulation a code.") ??
    required(values, "name", "Give the regulation a name.") ??
    required(values, "gradeScaleId", "Select the grade scale this regulation grades against.");

  if (missing) return missing;

  return withCodeField(
    await createScheme({
      // Upper-cased to match EVALUATION_SCHEME_CODE_PATTERN, exactly as the
      // course form does — a lower-case entry is a typo, not a rejection.
      code: str(values, "code").toUpperCase(),
      name: str(values, "name"),
      description: optionalStr(values, "description"),
      gradeScaleId: str(values, "gradeScaleId"),
      attemptPolicy: optionalStr(values, "attemptPolicy") as SchemeInput["attemptPolicy"],
      marksRounding: optionalStr(values, "marksRounding") as SchemeInput["marksRounding"],
      marksPrecision: num(values, "marksPrecision", 2),
      gpaRounding: optionalStr(values, "gpaRounding") as SchemeInput["gpaRounding"],
      gpaPrecision: num(values, "gpaPrecision", 2),
    })
  );
}

/**
 * Amend a draft regulation.
 *
 * `code` is not sent and is not read from the form: it is omitted from
 * updateEvaluationSchemeSchema, so a value supplied here would be silently
 * discarded and the caller would believe it had changed.
 */
export async function updateSchemeAction(
  id: string,
  values: FormValues
): Promise<ActionResult> {
  const missing =
    required(values, "name", "Give the regulation a name.") ??
    required(values, "gradeScaleId", "Select the grade scale this regulation grades against.");

  if (missing) return missing;

  return updateScheme(id, {
    name: str(values, "name"),
    description: optionalStr(values, "description"),
    gradeScaleId: str(values, "gradeScaleId"),
    attemptPolicy: optionalStr(values, "attemptPolicy") as SchemeInput["attemptPolicy"],
    marksRounding: optionalStr(values, "marksRounding") as SchemeInput["marksRounding"],
    marksPrecision: num(values, "marksPrecision", 2),
    gpaRounding: optionalStr(values, "gpaRounding") as SchemeInput["gpaRounding"],
    gpaPrecision: num(values, "gpaPrecision", 2),
  });
}

export async function deleteSchemeAction(id: string): Promise<ActionResult> {
  return deleteScheme(id);
}

/** Put a draft regulation into force. */
export async function activateSchemeAction(id: string): Promise<ActionResult> {
  return activateScheme(id);
}

/** Retire an active regulation. */
export async function archiveSchemeAction(id: string): Promise<ActionResult> {
  return archiveScheme(id);
}

// --- Components -------------------------------------------------------------

/** The half of a component body that create and update both send. */
function componentBody(values: FormValues): ComponentInput {
  return {
    code: str(values, "code").toUpperCase(),
    name: str(values, "name"),
    description: optionalStr(values, "description"),
    type: str(values, "type") as ComponentInput["type"],
    sourceType: optionalStr(values, "sourceType") as ComponentInput["sourceType"],
    maxMarks: num(values, "maxMarks", 0),
    weightage: num(values, "weightage", 0),
    // Explicitly null rather than omitted: the schema models both as nullable,
    // and clearing one is an ordinary edit that an omitted key cannot express.
    aggregation: nullableRef(values, "aggregation") as ComponentInput["aggregation"],
    rollup: nullableRef(values, "rollup") as ComponentInput["rollup"],
    sequence: num(values, "sequence", 1),
    isMandatory: values.isMandatory === true,
    // Null is what promotes a nested component back to the top level — the one
    // place this project's "a PATCH cannot clear a nullable column" rule is
    // deliberately departed from, and the reason NONE_VALUE exists.
    parentComponentId: nullableRef(values, "parentComponentId"),
  };
}

export async function createComponentAction(
  schemeId: string,
  values: FormValues
): Promise<ActionResult> {
  const missing =
    required(values, "code", "Give the component a code.") ??
    required(values, "name", "Give the component a name.");

  if (missing) return missing;

  return withCodeField(await createComponent(schemeId, componentBody(values)));
}

export async function updateComponentAction(
  schemeId: string,
  componentId: string,
  values: FormValues
): Promise<ActionResult> {
  const missing =
    required(values, "code", "Give the component a code.") ??
    required(values, "name", "Give the component a name.");

  if (missing) return missing;

  return withCodeField(await updateComponent(schemeId, componentId, componentBody(values)));
}

export async function deleteComponentAction(
  schemeId: string,
  componentId: string
): Promise<ActionResult> {
  return deleteComponent(schemeId, componentId);
}

// --- Passing criteria -------------------------------------------------------

function criterionBody(values: FormValues): CriterionInput {
  return {
    code: str(values, "code").toUpperCase(),
    name: str(values, "name"),
    description: optionalStr(values, "description"),
    metric: str(values, "metric") as CriterionInput["metric"],
    threshold: num(values, "threshold", 0),
    unit: str(values, "unit") as CriterionInput["unit"],
    failureOutcome: str(values, "failureOutcome") as CriterionInput["failureOutcome"],
    // Nullable: a component score names a component, attendance and credits do
    // not. The service checks that coherence against the merged values.
    componentId: nullableRef(values, "componentId"),
  };
}

export async function createCriterionAction(
  schemeId: string,
  values: FormValues
): Promise<ActionResult> {
  const missing =
    required(values, "code", "Give the criterion a code.") ??
    required(values, "name", "Give the criterion a name.");

  if (missing) return missing;

  return withCodeField(await createCriterion(schemeId, criterionBody(values)));
}

export async function updateCriterionAction(
  schemeId: string,
  criterionId: string,
  values: FormValues
): Promise<ActionResult> {
  const missing =
    required(values, "code", "Give the criterion a code.") ??
    required(values, "name", "Give the criterion a name.");

  if (missing) return missing;

  return withCodeField(await updateCriterion(schemeId, criterionId, criterionBody(values)));
}

export async function deleteCriterionAction(
  schemeId: string,
  criterionId: string
): Promise<ActionResult> {
  return deleteCriterion(schemeId, criterionId);
}

// --- Rules ------------------------------------------------------------------

/**
 * The config object for the operation this form authored.
 *
 * Built from the operation rather than from whichever numeric inputs happen to
 * carry a value: the endpoint validates `config` AGAINST `operation`, and
 * sending a MODERATION shape on an ADD_CONSTANT rule is precisely the pairing
 * that must not be storable. An unknown operation yields undefined, which the
 * schema reports as CONFIG_REQUIRED rather than being silently accepted.
 */
function ruleConfigFor(values: FormValues): Record<string, number> | undefined {
  const operation = str(values, "operation");

  switch (operation) {
    case "ADD_CONSTANT":
      return { amount: num(values, "amount", 0) };
    case "ADD_PERCENTAGE":
      return { percent: num(values, "percent", 0) };
    case "SCALE":
      return { factor: num(values, "factor", 1) };
    case "CAP":
    case "FLOOR":
      return { limit: num(values, "limit", 0) };
    case "GRACE":
      return { maxAward: num(values, "maxAward", 0) };
    case "MODERATION":
      return {
        targetMean: num(values, "targetMean", 0),
        targetStdDev: num(values, "targetStdDev", 1),
      };
    default:
      // CURVE and CUSTOM_FORMULA carry a nested configuration this form does
      // not author. Refused below rather than sent with a fabricated shape.
      return undefined;
  }
}

function ruleBody(values: FormValues): RuleInput | null {
  const config = ruleConfigFor(values);
  if (config === undefined) return null;

  return {
    code: str(values, "code").toUpperCase(),
    name: str(values, "name"),
    description: optionalStr(values, "description"),
    phase: str(values, "phase") as RuleInput["phase"],
    operation: str(values, "operation") as RuleInput["operation"],
    sequence: num(values, "sequence", 1),
    config: config as RuleInput["config"],
    // Null means "applies to the course total", which is required for a
    // COURSE_ADJUSTMENT rule and refused for a component-scoped one. The
    // endpoint reports that against the right field.
    componentId: nullableRef(values, "componentId"),
  };
}

const UNSUPPORTED_RULE_OPERATION: ActionResult = {
  success: false,
  error:
    "Curve and custom-formula rules carry a nested configuration this form cannot author. They are managed through the API.",
  code: "VALIDATION_ERROR",
  field: "operation",
};

export async function createRuleAction(
  schemeId: string,
  values: FormValues
): Promise<ActionResult> {
  const missing =
    required(values, "code", "Give the rule a code.") ??
    required(values, "name", "Give the rule a name.");

  if (missing) return missing;

  const body = ruleBody(values);
  if (!body) return UNSUPPORTED_RULE_OPERATION;

  return withCodeField(await createRule(schemeId, body));
}

export async function updateRuleAction(
  schemeId: string,
  ruleId: string,
  values: FormValues
): Promise<ActionResult> {
  const missing =
    required(values, "code", "Give the rule a code.") ??
    required(values, "name", "Give the rule a name.");

  if (missing) return missing;

  const body = ruleBody(values);
  if (!body) return UNSUPPORTED_RULE_OPERATION;

  return withCodeField(await updateRule(schemeId, ruleId, body));
}

export async function deleteRuleAction(
  schemeId: string,
  ruleId: string
): Promise<ActionResult> {
  return deleteRule(schemeId, ruleId);
}

// --- Semester result approval — PRD 17.4 -----------------------------------

/**
 * Record the Controller of Examination's sign-off on one semester's cohort.
 *
 * AUTHORIZATION IS NOT DECIDED HERE, for the reason the module header gives.
 * POST /api/results/semester/[semesterId]/approve applies
 * SEMESTER_RESULT_APPROVE_ROLES, which is CONTROLLER_OF_EXAMINATION and nothing
 * else, and resolves both the tenant and the approving user from the caller's
 * own session. UNIVERSITY_ADMIN reads the cohort report and is refused here;
 * that is a confirmed product decision, not an oversight.
 *
 * NOR IS THE PRECONDITION. "The engine computed every student" is a fact about
 * the cohort the service derives by running the same calculation the results
 * page displays. Restating it here would be a second copy that goes stale, and
 * the endpoint answers 409 with a message written for the person who has to
 * act on it.
 *
 * The semester id arrives pre-bound through .bind(null, id) on the server, so
 * it is never a mutable value in the client payload — the browser cannot
 * retarget the approval at a different cohort.
 */
export async function approveSemesterResultAction(
  semesterId: string,
  remarks?: string
): Promise<ActionResult> {
  if (semesterId.trim() === "") {
    return {
      success: false,
      error: "No semester was named.",
      code: "VALIDATION_ERROR",
    };
  }

  return approveSemesterResult(semesterId, remarks);
}
