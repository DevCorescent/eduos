// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Rule
// LAYER  : DTO
// PURPOSE: The exact shapes returned to the client. The service builds these
//          and nothing downstream reshapes them.
//
// TWO CONVERSIONS AT THIS BOUNDARY, as in every Phase 16 DTO:
//   Date    -> ISO-8601 string, so the wire contract is this file rather than a
//              property of whichever serializer runs.
//   Decimal -> lossless string. (This model carries none, but the rule applies
//              to its config values, which are plain numbers by construction.)
//
// ONE FIELD IS DERIVED, NOT STORED
//   `isCohortScoped` is computed from `operation`. MODERATION and CURVE cannot
//   be evaluated for one student in isolation, and a client needs to know that
//   — a scheme carrying either forces cohort-wide computation rather than
//   per-student recalculation. It is derived rather than stored because the
//   operation already determines it, and a column would be a second source of
//   truth for a fact the enum settles.
// ============================================================================

import type { RuleOperation, RulePhase } from "@/app/generated/prisma/client";
import type {
  EvaluationRuleCondition,
  EvaluationRuleConfig,
} from "@/lib/validations/evaluationRule";

/** One policy transform in a regulation's pipeline. */
export interface EvaluationRuleDTO {
  id: string;
  tenantId: string;
  schemeId: string;

  /** Null when the rule transforms the course total rather than one component. */
  componentId: string | null;

  code: string;
  name: string;
  description: string | null;

  phase: RulePhase;
  operation: RuleOperation;
  sequence: number;

  /**
   * Parameters for `operation`, narrowed to the union member that matches it.
   *
   * The column is JSON, so its static type from Prisma is JsonValue; the
   * service narrows it once, against the same schema that validated it on
   * write, so the engine can switch on `operation` and read `config` without
   * re-parsing.
   */
  config: EvaluationRuleConfig | null;

  /** Null when the rule applies unconditionally. */
  condition: EvaluationRuleCondition | null;

  /** Derived: this rule needs the whole cohort, not one student. */
  isCohortScoped: boolean;

  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
}

/**
 * A regulation's whole rule set.
 *
 * Returned unpaginated, and ordered as the engine executes it — by phase, then
 * by sequence. A page of a pipeline would be meaningless: the rules compose,
 * so reading half of them tells you nothing about what the regulation does. The
 * row count is bounded by how many transforms one regulation declares, which is
 * a handful.
 *
 * `isMutable` mirrors the component tree response: it says whether the owning
 * scheme is still a draft, so a client knows whether to render an editor or a
 * read-only view without a second request.
 */
export interface EvaluationRuleListDTO {
  schemeId: string;
  isMutable: boolean;
  /** True when any rule in the set forces cohort-wide computation. */
  requiresCohortComputation: boolean;
  ruleCount: number;
  rules: EvaluationRuleDTO[];
}
