// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Rule
// LAYER  : Validation
// PURPOSE: Shape and bounds for every rule request, applied before the
//          controller is reached and before any database work is done.
//
// WHAT IS ENFORCED HERE AND WHAT IS NOT
//   Here : field shape; numeric ranges matching the Decimal columns downstream;
//          enum membership; that `config` matches `operation`; that a
//          component-scoped phase names a component and a course-scoped one
//          does not. All of it is decidable from the request body alone.
//   Not  : anything requiring stored state — whether the scheme is still a
//          draft, whether the named component exists, whether a formula reads
//          COURSE_TOTAL at a phase where the course total does not yet exist,
//          or whether a position is already taken. Those are the service's,
//          because a schema that cannot read the database must never pretend to
//          enforce a rule that depends on it.
//
// THE OPERATION/CONFIG PAIRING
//   `config` is validated against `operation` on CREATE, where both arrive
//   together. On PATCH either may be absent, so the pairing is re-checked by
//   the service against the merged values — the same split already used for
//   passMark <= maxMarks in the examination module and for gradeScaleId in C2.
//   Both paths call ruleConfigSchemaFor(), so the per-operation shapes are
//   defined exactly once.
// ============================================================================

import { z } from "zod";
import { RuleOperation, RulePhase } from "@/app/generated/prisma/client";
import {
  CONDITION_COMPARATOR,
  EVALUATION_RULE_CODE_MAX_LENGTH,
  EVALUATION_RULE_CODE_MIN_LENGTH,
  EVALUATION_RULE_CODE_PATTERN,
  EVALUATION_RULE_DESCRIPTION_MAX_LENGTH,
  EVALUATION_RULE_MESSAGE,
  EVALUATION_RULE_NAME_MAX_LENGTH,
  EVALUATION_RULE_NAME_MIN_LENGTH,
  FORMULA_VARIABLE,
  MAX_CONDITION_CLAUSES,
  RULE_AMOUNT_MAX,
  RULE_AMOUNT_MIN,
  RULE_FACTOR_MAX,
  RULE_FACTOR_MIN,
  RULE_LIMIT_MAX,
  RULE_LIMIT_MIN,
  RULE_PERCENT_MAX,
  RULE_PERCENT_MIN,
  RULE_SEQUENCE_MAX,
  RULE_SEQUENCE_MIN,
  RULE_STDDEV_MAX,
  RULE_STDDEV_MIN,
} from "@/lib/constants/evaluationRule";
import { validateFormulaExpression, type FormulaExpression } from "@/lib/domain/result-engine/formula";
import { checkRuleScope, checkRuleVariableScope } from "@/lib/domain/result-engine/policies";
import { boundedDecimal, identifier } from "@/lib/validations/shared";

const ruleCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(EVALUATION_RULE_CODE_MIN_LENGTH)
  .max(EVALUATION_RULE_CODE_MAX_LENGTH)
  .regex(EVALUATION_RULE_CODE_PATTERN);

const ruleName = z
  .string()
  .trim()
  .min(EVALUATION_RULE_NAME_MIN_LENGTH)
  .max(EVALUATION_RULE_NAME_MAX_LENGTH);

/**
 * A custom formula's expression tree.
 *
 * The structural work is delegated to the domain validator, which walks
 * ITERATIVELY and enforces the depth and node budgets. A recursive Zod schema
 * would recurse during parsing, so a deeply nested body would overflow the
 * stack before any limit could apply — the validation layer would have caused
 * the denial of service it exists to prevent.
 *
 * z.custom supplies the static type; superRefine supplies the diagnostics, one
 * issue per offending node with its path, so a malformed formula is repaired in
 * one pass.
 */
const formulaExpressionSchema = z
  .custom<FormulaExpression>((value) => typeof value === "object" && value !== null, {
    message: "Expected a formula expression object",
  })
  .superRefine((value, ctx) => {
    for (const violation of validateFormulaExpression(value)) {
      ctx.addIssue({
        code: "custom",
        message: violation.message,
        // The domain validator paths start at "expression"; ctx is already
        // positioned there, so the leading segment is dropped.
        path: violation.path.split(".").slice(1),
      });
    }
  });

/**
 * Parameter shapes, one per operation.
 *
 * `satisfies Record<RuleOperation, ...>` is load-bearing: adding a member to
 * the RuleOperation enum without adding its parameter shape here is a COMPILE
 * ERROR, not a runtime surprise discovered when a grade comes out wrong. That
 * is the exhaustiveness guarantee this map exists to provide.
 */
const ruleConfigSchemas = {
  [RuleOperation.ADD_CONSTANT]: z.object({
    amount: boundedDecimal(RULE_AMOUNT_MIN, RULE_AMOUNT_MAX),
  }),
  [RuleOperation.ADD_PERCENTAGE]: z.object({
    percent: boundedDecimal(RULE_PERCENT_MIN, RULE_PERCENT_MAX),
  }),
  [RuleOperation.SCALE]: z.object({
    factor: boundedDecimal(RULE_FACTOR_MIN, RULE_FACTOR_MAX),
  }),
  [RuleOperation.CAP]: z.object({
    limit: boundedDecimal(RULE_LIMIT_MIN, RULE_LIMIT_MAX),
  }),
  [RuleOperation.FLOOR]: z.object({
    limit: boundedDecimal(RULE_LIMIT_MIN, RULE_LIMIT_MAX),
  }),
  [RuleOperation.GRACE]: z.object({
    maxAward: boundedDecimal(RULE_LIMIT_MIN, RULE_LIMIT_MAX),
  }),
  [RuleOperation.MODERATION]: z.object({
    targetMean: boundedDecimal(RULE_LIMIT_MIN, RULE_LIMIT_MAX),
    targetStdDev: boundedDecimal(RULE_STDDEV_MIN, RULE_STDDEV_MAX),
  }),
  [RuleOperation.CURVE]: z.object({
    distribution: z
      .array(
        z.object({
          grade: z.string().trim().min(1),
          topPercent: boundedDecimal(0, RULE_PERCENT_MAX),
        })
      )
      .min(1),
  }),
  [RuleOperation.CUSTOM_FORMULA]: z.object({
    expression: formulaExpressionSchema,
  }),
} satisfies Record<RuleOperation, z.ZodType>;

/** The parameter shape for one operation, keyed by that operation. */
export type EvaluationRuleConfigMap = {
  [Operation in RuleOperation]: z.infer<(typeof ruleConfigSchemas)[Operation]>;
};

/** Any operation's parameters. Narrow by switching on the rule's `operation`. */
export type EvaluationRuleConfig = EvaluationRuleConfigMap[RuleOperation];

/**
 * The parameter schema for one operation.
 *
 * Exported because both the create schema below and the service's PATCH path
 * need it, and the shapes must be defined once. Returning the schema rather
 * than a parsed value lets each caller choose between safeParse (for issue
 * reporting) and parse (for narrowing).
 */
export function ruleConfigSchemaFor(operation: RuleOperation): z.ZodType {
  return ruleConfigSchemas[operation];
}

/**
 * One comparison in a rule's condition.
 *
 * The variable whitelist is shared with formulas rather than duplicated: both
 * are bound by the same engine from the same student context, and two lists
 * would drift the moment one gained a variable.
 */
const conditionClauseSchema = z.object({
  variable: z.enum(FORMULA_VARIABLE),
  comparator: z.enum(CONDITION_COMPARATOR),
  value: boundedDecimal(RULE_AMOUNT_MIN, RULE_AMOUNT_MAX),
});

/**
 * When a rule applies.
 *
 * A FLAT conjunction, deliberately — not a nested boolean tree. Every policy
 * named for this phase is expressible as "all of these hold": grace when the
 * total is below the pass mark, a bonus when attendance exceeds 90%. A flat
 * list needs no recursion, no depth budget and no lazy schema, so it carries
 * none of the denial-of-service surface a formula does. Nesting can arrive
 * later as a JSON shape change with no migration, if a real requirement
 * demands it.
 */
export const evaluationRuleConditionSchema = z.object({
  all: z.array(conditionClauseSchema).min(1).max(MAX_CONDITION_CLAUSES),
});

export type EvaluationRuleCondition = z.infer<typeof evaluationRuleConditionSchema>;

/**
 * The writable columns of EvaluationRule.
 *
 * Deliberately absent, and therefore stripped from any body that supplies them:
 *   id, tenantId — server-managed; the tenant comes from requireTenant.
 *   schemeId     — taken from the route segment, never the body, so a rule
 *                  cannot be filed against a different regulation than the one
 *                  addressed in the URL.
 *   createdAt,
 *   updatedAt    — schema-managed timestamps.
 *
 * `componentId` is explicitly nullable rather than merely optional. Null is a
 * MEANINGFUL value here — it is what marks a rule as course-level — so a
 * caller must be able to send it, and on PATCH must be able to send it to move
 * a rule from component scope to course scope.
 */
const ruleFields = z.object({
  componentId: identifier.nullable().optional(),
  code: ruleCode,
  name: ruleName,
  description: z.string().trim().max(EVALUATION_RULE_DESCRIPTION_MAX_LENGTH).optional(),
  phase: z.enum(RulePhase),
  operation: z.enum(RuleOperation),
  sequence: z.number().int().min(RULE_SEQUENCE_MIN).max(RULE_SEQUENCE_MAX),
  /**
   * Left as `unknown` at the field level and validated against `operation` by
   * the refinement below. Typing it as a union here would accept a MODERATION
   * config on an ADD_CONSTANT rule, which is precisely the pairing that must
   * not be storable.
   */
  config: z.unknown().optional(),
  condition: evaluationRuleConditionSchema.nullable().optional(),
});

/**
 * Body schema for POST /api/evaluation-schemes/[id]/rules.
 *
 * Every rule applied here is decidable from a complete body, so all of them run
 * at this layer and a client gets field-level issues before any database work.
 *
 * The two COHERENCE rules — phase versus componentId, and variable availability
 * versus phase — are delegated to lib/domain/result-engine/policies.ts rather
 * than implemented here. The service must apply the identical rules to the
 * MERGED values on PATCH, where a body may carry `config` without `operation`;
 * defining them in one pure module is what stops the two layers from drifting
 * into two different definitions of the same rule.
 */
export const createEvaluationRuleSchema = ruleFields.superRefine((data, ctx) => {
  for (const violation of checkRuleScope(data.phase, data.componentId)) {
    ctx.addIssue({ code: "custom", path: [violation.field], message: violation.message });
  }

  if (data.config === undefined || data.config === null) {
    ctx.addIssue({
      code: "custom",
      path: ["config"],
      message: EVALUATION_RULE_MESSAGE.CONFIG_REQUIRED,
    });
    return;
  }

  const parsed = ruleConfigSchemaFor(data.operation).safeParse(data.config);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        code: "custom",
        path: ["config", ...issue.path],
        message: issue.message,
      });
    }

    // The variable-scope check reads the expression tree, so it is only
    // meaningful once the config is known to be well-formed.
    return;
  }

  for (const violation of checkRuleVariableScope(
    data.phase,
    data.operation,
    data.config,
    data.condition
  )) {
    ctx.addIssue({ code: "custom", path: [violation.field], message: violation.message });
  }
});

export type CreateEvaluationRuleInput = z.infer<typeof createEvaluationRuleSchema>;

/**
 * Body schema for PATCH /api/evaluation-schemes/[id]/rules/[ruleId].
 *
 * Every key is optional, but at least one must be present: an empty body is a
 * client error, not a silent no-op that would still advance updatedAt.
 *
 * Neither cross-field rule is applied here, and that is deliberate rather than
 * an omission. A PATCH supplying only `config` cannot be checked without the
 * STORED operation, and a PATCH supplying only `phase` cannot be checked
 * without the STORED componentId. The service re-evaluates both against the
 * merged values, which is the only place all of them are known.
 */
export const updateEvaluationRuleSchema = ruleFields
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateEvaluationRuleInput = z.infer<typeof updateEvaluationRuleSchema>;

/** Route params for /api/evaluation-schemes/[id]/rules. */
export const ruleSchemeParamSchema = z.object({
  id: identifier,
});

/** Route params for /api/evaluation-schemes/[id]/rules/[ruleId]. */
export const evaluationRuleParamSchema = z.object({
  id: identifier,
  ruleId: identifier,
});

export type EvaluationRuleParam = z.infer<typeof evaluationRuleParamSchema>;

// No pagination schema is declared. A regulation's rules are a PIPELINE whose
// members compose, so a page of them misrepresents what the regulation does.
// The count is bounded by how many transforms one regulation declares.
