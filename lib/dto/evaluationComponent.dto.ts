// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Component
// LAYER  : DTO
// PURPOSE: The exact shapes returned to the client. The service builds these
//          and nothing downstream reshapes them.
//
// Same two boundary conversions as the scheme DTO — Date to ISO-8601 string,
// Decimal to a lossless string — for the same reasons: the wire contract must
// be what this file declares, not a side effect of whichever serializer runs,
// and a Prisma Decimal instance must never leak into a response type.
//
// TWO FIELDS ARE DERIVED, NOT STORED
//   `isLeaf` and `depth` are computed from the tree on read. The superseded
//   draft stored isLeaf as a column, which is a second source of truth for a
//   fact the children relation already holds — and one that silently goes stale
//   the moment a child is added. Nothing is bought by storing it: the engine
//   loads a scheme's entire tree in one query and folds it in memory, so no
//   query ever needs to filter on leafness.
// ============================================================================

import type {
  ComponentAggregation,
  ComponentRollup,
  ComponentSource,
  EvaluationComponentType,
  EvaluationSchemeStatus,
} from "@/app/generated/prisma/client";
import type { ComponentTreeViolationCode } from "@/lib/constants/evaluationComponent";
import type { ComponentRuleConfig } from "@/lib/validations/evaluationComponent";

/** One component, flat. */
export interface EvaluationComponentDTO {
  id: string;
  tenantId: string;
  schemeId: string;
  parentComponentId: string | null;

  code: string;
  name: string;
  description: string | null;

  type: EvaluationComponentType;
  sourceType: ComponentSource;

  /** Decimal(6,2) as a lossless string, e.g. "20.00". */
  maxMarks: string;
  /** Decimal(5,2) as a lossless string, e.g. "30.00". */
  weightage: string;

  aggregation: ComponentAggregation | null;
  rollup: ComponentRollup | null;
  ruleConfig: ComponentRuleConfig | null;

  sequence: number;
  isMandatory: boolean;

  /** Derived: this component has no children. */
  isLeaf: boolean;
  /** Derived: 1 for a top-level component. Absent from the tree implies a cycle. */
  depth: number;

  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  updatedAt: string;
}

/** One component with its children nested beneath it. */
export interface EvaluationComponentNodeDTO extends EvaluationComponentDTO {
  children: EvaluationComponentNodeDTO[];
}

/** One reason the tree cannot be activated, as reported to a client. */
export interface ComponentTreeViolationDTO {
  code: ComponentTreeViolationCode;
  field: string;
  message: string;
}

/**
 * A scheme's whole component tree, with its current fitness for activation.
 *
 * The tree is returned nested and NOT also flat. Returning both would be the
 * same data twice in one response, and the flat form is a two-line reduction on
 * the client.
 *
 * `validation` is included on every read rather than exposed as a separate
 * endpoint, because the question "can this scheme be activated yet?" is asked
 * every time the tree is displayed, and computing it is a pure O(n) fold over
 * rows already loaded — it costs no extra query.
 */
export interface EvaluationComponentTreeDTO {
  schemeId: string;
  schemeStatus: EvaluationSchemeStatus;
  /** True while the owning scheme is a draft; the tree is frozen otherwise. */
  isMutable: boolean;
  componentCount: number;
  tree: EvaluationComponentNodeDTO[];
  validation: {
    isValid: boolean;
    violations: ComponentTreeViolationDTO[];
  };
}
