// ============================================================================
// OWNER  : Gauransh
// MODULE : Passing Criterion
// LAYER  : Validation
// PURPOSE: Shape and bounds for every criterion request, applied before the
//          controller is reached and before any database work is done.
//
// WHAT IS ENFORCED HERE AND WHAT IS NOT
//   Here : field shape; the threshold's range and decimal scale; enum
//          membership; and all three coherence rules, because every one of them
//          is decidable from the body alone —
//            • metric ↔ componentId  (only COMPONENT_SCORE constrains a node)
//            • metric ↔ unit         (attendance is a percentage; credits are
//                                     credits; only a component score is
//                                     genuinely expressible either way)
//            • a PERCENT threshold cannot exceed 100
//   Not  : threshold <= the component's maxMarks. That needs the stored
//          component, so it belongs to the service — the same split used for
//          passMark <= maxMarks in the examination module.
// ============================================================================

import { z } from "zod";
import { CriterionOutcome, PassingMetric, ThresholdUnit } from "@/app/generated/prisma/client";
import {
  PASSING_CRITERION_CODE_MAX_LENGTH,
  PASSING_CRITERION_CODE_MIN_LENGTH,
  PASSING_CRITERION_CODE_PATTERN,
  PASSING_CRITERION_DESCRIPTION_MAX_LENGTH,
  PASSING_CRITERION_NAME_MAX_LENGTH,
  PASSING_CRITERION_NAME_MIN_LENGTH,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
} from "@/lib/constants/passingCriterion";
import { checkCriterionCoherence } from "@/lib/domain/result-engine/policies";
import { boundedDecimal, identifier } from "@/lib/validations/shared";

const criterionCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(PASSING_CRITERION_CODE_MIN_LENGTH)
  .max(PASSING_CRITERION_CODE_MAX_LENGTH)
  .regex(PASSING_CRITERION_CODE_PATTERN);

const criterionName = z
  .string()
  .trim()
  .min(PASSING_CRITERION_NAME_MIN_LENGTH)
  .max(PASSING_CRITERION_NAME_MAX_LENGTH);

/**
 * The writable columns of PassingCriterion.
 *
 * Deliberately absent, and therefore stripped from any body that supplies them:
 *   id, tenantId — server-managed; the tenant comes from requireTenant.
 *   schemeId     — taken from the route segment, never the body.
 *   createdAt,
 *   updatedAt    — schema-managed timestamps.
 *
 * `componentId` is explicitly nullable so a caller can move a criterion between
 * component scope and the metrics that have none, exactly as in C3 and C4.
 */
const criterionFields = z.object({
  componentId: identifier.nullable().optional(),
  code: criterionCode,
  name: criterionName,
  description: z.string().trim().max(PASSING_CRITERION_DESCRIPTION_MAX_LENGTH).optional(),
  metric: z.enum(PassingMetric),
  threshold: boundedDecimal(THRESHOLD_MIN, THRESHOLD_MAX),
  unit: z.enum(ThresholdUnit),
  failureOutcome: z.enum(CriterionOutcome),
});

/**
 * Body schema for POST /api/evaluation-schemes/[id]/passing-criteria.
 *
 * The three coherence rules are delegated to
 * lib/domain/result-engine/policies.ts rather than implemented here. The
 * service must apply the identical rules to the MERGED values on PATCH, where
 * a body may carry `unit` without `metric`; defining them in one pure module is
 * what stops the two layers from drifting into two different definitions of the
 * same rule.
 *
 * Each violation is attached to the field a client should highlight rather than
 * to the object as a whole.
 */
export const createPassingCriterionSchema = criterionFields.superRefine((data, ctx) => {
  for (const violation of checkCriterionCoherence(data)) {
    ctx.addIssue({ code: "custom", path: [violation.field], message: violation.message });
  }
});

export type CreatePassingCriterionInput = z.infer<typeof createPassingCriterionSchema>;

/**
 * Body schema for PATCH
 * /api/evaluation-schemes/[id]/passing-criteria/[criterionId].
 *
 * Every key is optional, but at least one must be present.
 *
 * The coherence rules are NOT re-applied here. All three relate metric, unit,
 * componentId and threshold, and a PATCH may supply any subset — checking a
 * partial set would either pass a body that is incoherent once merged, or
 * reject one that is perfectly coherent. The service re-evaluates all three
 * against the merged values, which is the only place every one of them is
 * known.
 */
export const updatePassingCriterionSchema = criterionFields
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdatePassingCriterionInput = z.infer<typeof updatePassingCriterionSchema>;

/** Route params for /api/evaluation-schemes/[id]/passing-criteria. */
export const criterionSchemeParamSchema = z.object({
  id: identifier,
});

/** Route params for /api/evaluation-schemes/[id]/passing-criteria/[criterionId]. */
export const passingCriterionParamSchema = z.object({
  id: identifier,
  criterionId: identifier,
});

export type PassingCriterionParam = z.infer<typeof passingCriterionParamSchema>;

// No pagination schema is declared. Criteria form a CONJUNCTION — every one
// must hold — so a page of them misrepresents the requirement: a client seeing
// three of five would believe a student meeting those three has passed.
