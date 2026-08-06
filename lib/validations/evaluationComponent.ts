// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Component
// LAYER  : Validation
// PURPOSE: Shape and bounds for every component request, applied before the
//          controller is reached and before any database work is done.
//
// WHAT IS ENFORCED HERE AND WHAT IS NOT
//   Here : field shape, numeric ranges matching the Decimal columns, enum
//          membership, and the one cross-field rule that holds regardless of
//          where a node sits in the tree — a component cannot declare both an
//          aggregation and a rollup.
//   Not  : anything requiring the rest of the tree. Whether siblings total 100,
//          whether a node is a leaf, whether re-parenting creates a cycle —
//          none of it is knowable from one request body, and a schema that
//          pretended otherwise would be enforcing a rule it cannot see.
// ============================================================================

import { z } from "zod";
import {
  ComponentAggregation,
  ComponentRollup,
  ComponentSource,
  EvaluationComponentType,
} from "@/app/generated/prisma/client";
import {
  ABSENCE_POLICY,
  ATTENDANCE_BAND_MARKS_MIN,
  EVALUATION_COMPONENT_CODE_MAX_LENGTH,
  EVALUATION_COMPONENT_CODE_MIN_LENGTH,
  EVALUATION_COMPONENT_CODE_PATTERN,
  EVALUATION_COMPONENT_DESCRIPTION_MAX_LENGTH,
  EVALUATION_COMPONENT_NAME_MAX_LENGTH,
  EVALUATION_COMPONENT_NAME_MIN_LENGTH,
  MAX_MARKS_MAX,
  MAX_MARKS_MIN,
  RULE_COUNT_MAX,
  RULE_COUNT_MIN,
  SEQUENCE_MAX,
  SEQUENCE_MIN,
  WEIGHTAGE_MAX,
  WEIGHTAGE_MIN,
  WITHHELD_POLICY,
} from "@/lib/constants/evaluationComponent";
import { boundedDecimal, identifier } from "@/lib/validations/shared";

const componentCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(EVALUATION_COMPONENT_CODE_MIN_LENGTH)
  .max(EVALUATION_COMPONENT_CODE_MAX_LENGTH)
  .regex(EVALUATION_COMPONENT_CODE_PATTERN);

const componentName = z
  .string()
  .trim()
  .min(EVALUATION_COMPONENT_NAME_MIN_LENGTH)
  .max(EVALUATION_COMPONENT_NAME_MAX_LENGTH);

/**
 * Parameters for the chosen aggregation and mark source.
 *
 * Every key is optional because which one applies depends on `aggregation` and
 * `sourceType`, and that pairing is checked by the tree validator where both
 * are known. What this schema guarantees is that whatever IS supplied is
 * well-formed and in range — so the engine reading ruleConfig.count can rely on
 * it being a sane integer rather than a string, an array, or 10^9.
 *
 * Unknown keys are stripped rather than stored, which is Zod's default and the
 * project-wide convention; a JSON bag that silently accumulated unrecognised
 * keys would become impossible to reason about.
 */
export const componentRuleConfigSchema = z.object({
  /** Sessions kept by BEST_N, or discarded by DROP_LOWEST_N. */
  count: z.number().int().min(RULE_COUNT_MIN).max(RULE_COUNT_MAX).optional(),

  /**
   * The band table for an ATTENDANCE_DERIVED component: at or above
   * `minPercent` attendance, award `marks`. Ordered evaluation is the engine's
   * concern; this only fixes the shape and the ranges.
   */
  attendanceBands: z
    .array(
      z.object({
        minPercent: z.number().min(WEIGHTAGE_MIN).max(WEIGHTAGE_MAX),
        marks: z.number().min(ATTENDANCE_BAND_MARKS_MIN).max(MAX_MARKS_MAX),
      })
    )
    .min(1)
    .optional(),

  /**
   * What an ABSENT sitting contributes to this component's aggregation.
   *
   * Declared here because a plain z.object() strips unknown keys: without it,
   * a stored policy would be silently discarded and the result engine would
   * have no configuration to read. Omitted means DEFAULT_ABSENCE_POLICY.
   */
  absentPolicy: z.enum(ABSENCE_POLICY).optional(),

  /** What a WITHHELD sitting does. Omitted means DEFAULT_WITHHELD_POLICY. */
  withheldPolicy: z.enum(WITHHELD_POLICY).optional(),

  /**
   * Whether AVERAGE weights each sitting by its own maximum.
   *
   * False (the default) treats every sitting equally, which is what "average"
   * plainly means. True weights by marks available, so a 50-mark paper counts
   * for more than a 10-mark quiz.
   */
  averageWeighted: z.boolean().optional(),
});

export type ComponentRuleConfig = z.infer<typeof componentRuleConfigSchema>;

/**
 * The writable columns of EvaluationComponent.
 *
 * Deliberately absent, and therefore stripped from any body that supplies them:
 *   id, tenantId — server-managed; the tenant comes from requireTenant.
 *   schemeId     — taken from the route segment, never the body, so a component
 *                  cannot be filed against a different regulation than the one
 *                  addressed in the URL.
 *   createdAt,
 *   updatedAt    — schema-managed timestamps.
 *
 * `isLeaf` is absent because it no longer exists: leafness is derived from the
 * children relation, never declared.
 */
const componentFields = z.object({
  code: componentCode,
  name: componentName,
  description: z.string().trim().max(EVALUATION_COMPONENT_DESCRIPTION_MAX_LENGTH).optional(),
  type: z.enum(EvaluationComponentType),
  sourceType: z.enum(ComponentSource).optional(),
  maxMarks: boundedDecimal(MAX_MARKS_MIN, MAX_MARKS_MAX),
  weightage: boundedDecimal(WEIGHTAGE_MIN, WEIGHTAGE_MAX),
  aggregation: z.enum(ComponentAggregation).nullable().optional(),
  rollup: z.enum(ComponentRollup).nullable().optional(),
  ruleConfig: componentRuleConfigSchema.nullable().optional(),
  sequence: z.number().int().min(SEQUENCE_MIN).max(SEQUENCE_MAX),
  isMandatory: z.boolean().optional(),

  /**
   * The parent this component hangs from, or null for a top-level component.
   *
   * Explicitly nullable, which departs from the project-wide rule that a PATCH
   * cannot clear a nullable column. The departure is required rather than
   * convenient: promoting a nested component back to the top level is an
   * ordinary editing action, and with no way to send null it would be
   * unreachable through the API.
   */
  parentComponentId: identifier.nullable().optional(),
});

/**
 * A component cannot declare both an aggregation and a rollup.
 *
 * This is the ONE cross-field rule that is position-independent: aggregation
 * describes how a node's own sessions combine and rollup describes how its
 * children combine, so a node claiming both is incoherent wherever it sits.
 * Which of the two it SHOULD carry depends on whether it has children, which
 * only the tree knows — that half is checked by the tree validator.
 */
function notBothRules(data: {
  aggregation?: ComponentAggregation | null;
  rollup?: ComponentRollup | null;
}): boolean {
  return !(
    data.aggregation !== null &&
    data.aggregation !== undefined &&
    data.rollup !== null &&
    data.rollup !== undefined
  );
}

/** Body schema for POST /api/evaluation-schemes/[id]/components. */
export const createEvaluationComponentSchema = componentFields.refine(notBothRules, {
  message: "A component cannot declare both an aggregation and a rollup",
});

export type CreateEvaluationComponentInput = z.infer<typeof createEvaluationComponentSchema>;

/**
 * Body schema for PATCH /api/evaluation-schemes/[id]/components/[componentId].
 *
 * `code` REMAINS patchable, unlike EvaluationScheme.code. The reasoning differs
 * because the situation does: a scheme code is the key its version numbering is
 * computed against, whereas a component code participates in no numbering and,
 * while the owning scheme is a draft, is referenced by nothing at all — no
 * session and no mark can exist yet. Correcting a typo must not require
 * deleting and recreating the node along with its whole subtree.
 *
 * Every key is optional, but at least one must be present: an empty body is a
 * client error, not a silent no-op that would still advance updatedAt.
 */
export const updateEvaluationComponentSchema = componentFields
  .partial()
  .refine((data) => Object.keys(data).length > 0)
  .refine(notBothRules, {
    message: "A component cannot declare both an aggregation and a rollup",
  });

export type UpdateEvaluationComponentInput = z.infer<typeof updateEvaluationComponentSchema>;

/** Route params for /api/evaluation-schemes/[id]/components. */
export const componentSchemeParamSchema = z.object({
  id: identifier,
});

/** Route params for /api/evaluation-schemes/[id]/components/[componentId]. */
export const evaluationComponentParamSchema = z.object({
  id: identifier,
  componentId: identifier,
});

export type EvaluationComponentParam = z.infer<typeof evaluationComponentParamSchema>;

// No pagination schema is declared. A scheme's components are a TREE, and a
// page of a tree is not a tree — the response would be unusable and the
// validation summary would be computed over a fragment. The row count is
// bounded by how many components one regulation declares, which is a handful.
