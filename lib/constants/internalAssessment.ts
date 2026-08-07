// ============================================================================
// OWNER  : Gauransh
// MODULE : AI Assisted Internal Assessment (Phase 25)
// LAYER  : Constants
// PURPOSE: The authorisation sets, the audit vocabulary, the mapping from
//          Phase 16 component types onto the five evidence signals, and the
//          messages this module answers with.
//
// THE MARKING RULES ARE PHASE 16's, NOT A NEW STORE
//   `GET /api/internal-assessment/rules` reads the ACTIVE EvaluationScheme's
//   internal components and reports their weightages. No parallel rules model
//   exists, deliberately: a university that has configured "internal assessment
//   is 40% assignments, 30% quizzes, 30% attendance" has already stated its
//   rule, and a second store would be free to contradict it — with no way to
//   tell which one the engine actually used.
//
// THE FACULTY MEMBER DECIDES, ALWAYS
//   The README is explicit that "the final decision [stays] with the faculty".
//   Nothing in this module writes a mark into a student's result. A suggestion
//   is a row in InternalAssessmentSuggestion, and `finalMarks` is NULL until a
//   human sets it. Publishing an accepted mark into Phase 16's
//   StudentComponentScore remains that module's operation, unchanged.
// ============================================================================

import { ROLES } from "@/constants/roles";
import { EvaluationComponentType } from "@/app/generated/prisma/enums";
import type { SignalKey } from "@/lib/domain/internal-assessment/evidence";

// --- Authorization ----------------------------------------------------------

/**
 * Roles permitted to reach this module.
 *
 * Exactly the three the README's Phase 25 names. STUDENT is absent throughout:
 * a suggestion is deliberative material about a student, not a result they hold,
 * and Phase 21's matrix lists "Modify Internal Assessment" among the things a
 * student cannot do.
 */
export const INTERNAL_ASSESSMENT_ROLES = [
  ROLES.FACULTY,
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
  ROLES.UNIVERSITY_ADMIN,
] as const;

// --- Audit vocabulary -------------------------------------------------------

/** The resource name every AuditLog row from this module carries. */
export const INTERNAL_ASSESSMENT_RESOURCE = "InternalAssessmentSuggestion";

/**
 * The actions this module records.
 *
 * Both are audited. A trail holding only overrides could not answer "what did
 * the model propose", which is exactly the question an appeal against an
 * internal mark raises.
 */
export const INTERNAL_ASSESSMENT_ACTION = {
  GENERATE: "INTERNAL_ASSESSMENT_GENERATE",
  DECIDE: "INTERNAL_ASSESSMENT_DECIDE",
} as const;

// --- Evidence mapping -------------------------------------------------------

/**
 * Which evidence signal a configured EvaluationComponent draws on.
 *
 * This is the ONE place Phase 16's vocabulary meets Phase 25's inputs. A
 * component the university typed as QUIZ contributes the quiz signal; one typed
 * LAB or PRACTICAL contributes practical work. A type absent from this map — a
 * VIVA, a SEMINAR, a CUSTOM logbook — contributes NO signal, because nothing in
 * the system observes it: there is no viva table to read. Such a component is
 * reported in `unmappedComponents` rather than silently ignored, so a faculty
 * member can see that part of their scheme is not something the suggestion
 * could account for.
 *
 * THEORY, INTERNAL and EXTERNAL are absent for a different reason: they are
 * containers, not observations. An INTERNAL component is the thing being
 * suggested, and mapping it onto itself would make the suggestion circular.
 */
export const COMPONENT_TYPE_SIGNAL: Partial<Record<EvaluationComponentType, SignalKey>> = {
  [EvaluationComponentType.ATTENDANCE]: "attendance",
  [EvaluationComponentType.ASSIGNMENT]: "assignment",
  [EvaluationComponentType.QUIZ]: "quiz",
  [EvaluationComponentType.PRACTICAL]: "practical",
  [EvaluationComponentType.LAB]: "practical",
  [EvaluationComponentType.PROJECT]: "assignment",
};

/**
 * Component types that represent internal assessment as a whole.
 *
 * These are the components a suggestion is FOR — the target of the exercise
 * rather than an input to it.
 */
export const INTERNAL_COMPONENT_TYPES = [
  EvaluationComponentType.INTERNAL,
  EvaluationComponentType.ASSIGNMENT,
  EvaluationComponentType.QUIZ,
  EvaluationComponentType.PRACTICAL,
  EvaluationComponentType.LAB,
  EvaluationComponentType.ATTENDANCE,
  EvaluationComponentType.PROJECT,
  EvaluationComponentType.SEMINAR,
  EvaluationComponentType.PRESENTATION,
  EvaluationComponentType.VIVA,
  EvaluationComponentType.CUSTOM,
] as const;

// --- Bounds -----------------------------------------------------------------

/**
 * Students a single generate call may produce suggestions for.
 *
 * A course-wide generation is the ordinary use, and a large first-year course
 * carries several hundred students. Bounded so one request cannot become an
 * unbounded write; the service reports what it covered.
 */
export const INTERNAL_ASSESSMENT_GENERATE_LIMIT = 300;

/**
 * The grade-point scale prior performance is normalised against.
 *
 * 10 is the scale every GradeScale in this project's seed uses and the one
 * Indian universities overwhelmingly use. It is stated as a named constant
 * rather than inline so that the assumption is visible and changeable, and it
 * is reported in the response's `factors` so a reader can see what the figure
 * was measured against.
 */
export const PRIOR_PERFORMANCE_SCALE = 10;

// --- Messages ---------------------------------------------------------------

export const INTERNAL_ASSESSMENT_MESSAGE = {
  COMPONENT_NOT_FOUND: "Evaluation component not found",
  SUGGESTION_NOT_FOUND: "No internal assessment suggestion exists for this student",
  NO_ACTIVE_SCHEME: "No active evaluation scheme is configured for this course and semester",
  NO_REGISTRATIONS: "No students are registered for this course and semester",
  /**
   * The refusal when a faculty member awards more than the component allows.
   *
   * The bound is the component's own maxMarks, which is a stored value the
   * validation layer cannot read — so this is a service-layer rejection.
   */
  MARKS_EXCEED_MAX: "Marks exceed the component's maximum",
  OVERRIDE_REASON_REQUIRED:
    "A reason is required when the awarded marks differ from the suggestion",
} as const;
