// ============================================================================
// OWNER  : Gauransh
// MODULE : AI Assisted Internal Assessment (Phase 25)
// LAYER  : Validation
// PURPOSE: The request contracts for the five Phase 25 endpoints.
//
// EVERY BODY SCHEMA IS .strict()
//   A supplied `suggestedMarks`, `confidence` or `generatedById` is a 400
//   rather than a silent strip. All three are derived server-side, and a client
//   that believes it set the model's own suggestion — and is quietly ignored —
//   would keep believing it while an audit trail recorded something else.
//
// THE OVERRIDE RULE THE SCHEMA CAN EXPRESS, AND THE ONE IT CANNOT
//   The README says faculty may override "within the allowed range" and records
//   a reason. `overrideReason` is validated here for SHAPE; whether it is
//   REQUIRED depends on comparing finalMarks against a stored suggestion, which
//   this layer cannot read. That check lives in the service — stated here so
//   the split is deliberate rather than an omission.
// ============================================================================

import { z } from "zod";
import { identifier } from "@/lib/validations/shared";
import { boundedDecimal } from "@/lib/validations/shared";

/**
 * A marks value destined for a Decimal(6,2) column.
 *
 * boundedDecimal is the project's shared primitive and carries the scale check
 * that stops PostgreSQL silently rounding a third decimal place away. The upper
 * bound is the column's own ceiling; the component's maxMarks is a tighter
 * bound the SERVICE applies, because it is a stored value.
 */
const marks = boundedDecimal(0, 9999.99);

/**
 * POST /api/internal-assessment/generate
 *
 * `componentId` names WHICH internal component is being suggested. It is
 * required: a scheme may carry several internal components, and generating "an
 * internal mark" without saying which would produce a row that no later read
 * could interpret.
 *
 * `studentIds` is optional. Omitted, the service generates for every registered
 * student in the course-semester, which is the ordinary course-wide use.
 * Supplied, it narrows to those students — a faculty member regenerating for
 * one person after a late assignment was marked.
 */
export const generateSuggestionsSchema = z
  .object({
    courseId: identifier,
    semesterId: identifier,
    componentId: identifier,
    studentIds: z.array(identifier).min(1).max(300).optional(),
    /**
     * Whether to ask the provider for a written rationale.
     *
     * Defaults to false so the ordinary path is deterministic, offline and
     * fast. The numeric suggestion NEVER depends on this: it is computed from
     * the university's own weights before any provider is contacted, and a
     * provider failure leaves the suggestion intact with a null rationale.
     */
    withRationale: z.boolean().default(false),
  })
  .strict();

export type GenerateSuggestionsInput = z.infer<typeof generateSuggestionsSchema>;

/**
 * PATCH /api/internal-assessment/[studentId]
 *
 * The faculty decision. `finalMarks` is what is actually awarded.
 */
export const decideInternalAssessmentSchema = z
  .object({
    courseId: identifier,
    semesterId: identifier,
    componentId: identifier,
    finalMarks: marks,
    overrideReason: z.string().trim().min(1).max(1000).optional(),
    remarks: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export type DecideInternalAssessmentInput = z.infer<typeof decideInternalAssessmentSchema>;

/** The [studentId] route segment. */
export const internalAssessmentStudentParamSchema = z.object({ studentId: identifier });

export type InternalAssessmentStudentParam = z.infer<
  typeof internalAssessmentStudentParamSchema
>;

/**
 * GET /api/internal-assessment/student/[studentId] and /audit/[studentId].
 *
 * Both filters optional so one endpoint answers "everything for this student"
 * and "this student in this course this semester".
 */
export const internalAssessmentQuerySchema = z
  .object({
    courseId: identifier.optional(),
    semesterId: identifier.optional(),
  })
  .strict();

export type InternalAssessmentQuery = z.infer<typeof internalAssessmentQuerySchema>;

/**
 * GET /api/internal-assessment/rules
 *
 * courseId and semesterId are REQUIRED. The active evaluation scheme is
 * resolved through the registrations for a course-semester — asking "what are
 * the marking rules" without saying for what would have no answer, since a
 * tenant may run several regulations at once.
 */
export const internalAssessmentRulesQuerySchema = z
  .object({
    courseId: identifier,
    semesterId: identifier,
  })
  .strict();

export type InternalAssessmentRulesQuery = z.infer<
  typeof internalAssessmentRulesQuerySchema
>;
