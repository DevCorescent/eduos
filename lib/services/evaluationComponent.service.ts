// ============================================================================
// OWNER      : Gauransh
// MODULE     : Evaluation Component
// LAYER      : Service
// PURPOSE    : Every business rule governing a regulation's assessment tree —
//              mutability, parentage, cycle prevention, sibling ordering,
//              atomic subtree removal and audit.
// ARCHITECTURE:
//   • Service contains ALL business logic.
//   • It owns transaction BOUNDARIES; the repository owns the Prisma handle.
//   • Whole-tree ARITHMETIC and STRUCTURAL rules live one layer further in, in
//     lib/domain/evaluationComponentTree.ts, because the scheme service needs
//     the same rules at activation and neither service should import the other.
//   • Both repository ports arrive through the constructor and are imported
//     with `import type`, so this module's runtime graph never reaches
//     lib/db/prisma and it unit-tests with no database.
//
// THE QUERY BUDGET
//   Every operation is: ONE scheme lookup, ONE full-tree load, ONE write, ONE
//   audit write. The tree is loaded once and every rule — does the parent
//   exist, would this create a cycle, is the position free, which nodes form
//   the subtree — is answered against that in-memory copy. There is no query
//   inside any loop anywhere in this module.
// ============================================================================

import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import { EVALUATION_SCHEME_MUTABLE_STATUS } from "@/lib/constants/evaluationScheme";
import {
  EVALUATION_COMPONENT_AUDIT_ACTION,
  EVALUATION_COMPONENT_MESSAGE,
  EVALUATION_COMPONENT_RESOURCE,
} from "@/lib/constants/evaluationComponent";
import {
  collectSubtreeIds,
  indexComponentTree,
  isLeafNode,
  validateComponentTree,
  wouldCreateCycle,
  type ComponentTreeIndex,
} from "@/lib/domain/evaluationComponentTree";
import type {
  AuditLogRepositoryPort,
  DbClient as AuditDbClient,
} from "@/lib/repositories/auditLog.repository";
import type {
  DbClient,
  EvaluationComponentRecord,
  EvaluationComponentRepositoryPort,
  UpdateEvaluationComponentData,
} from "@/lib/repositories/evaluationComponent.repository";
import type {
  EvaluationComponentDTO,
  EvaluationComponentNodeDTO,
  EvaluationComponentTreeDTO,
} from "@/lib/dto/evaluationComponent.dto";
import type {
  ComponentRuleConfig,
  CreateEvaluationComponentInput,
  UpdateEvaluationComponentInput,
} from "@/lib/validations/evaluationComponent";
import type { RequestContext } from "@/lib/utils/request-context";

/** Depth reported for a node the tree walk could not reach — see toDTO. */
const UNREACHABLE_DEPTH = 0;

/** 404 — the component does not exist in this scheme, or this tenant. */
function componentNotFound(): AppError {
  return new AppError(
    EVALUATION_COMPONENT_MESSAGE.NOT_FOUND,
    HTTP_STATUS.NOT_FOUND,
    ERROR_CODE.NOT_FOUND
  );
}

/** 404 — the owning scheme does not exist, or belongs to another tenant. */
function schemeNotFound(): AppError {
  return new AppError(
    EVALUATION_COMPONENT_MESSAGE.SCHEME_NOT_FOUND,
    HTTP_STATUS.NOT_FOUND,
    ERROR_CODE.NOT_FOUND
  );
}

/** 409 — the request is well-formed but the stored state forbids it. */
function conflict(message: string): AppError {
  return new AppError(message, HTTP_STATUS.CONFLICT, ERROR_CODE.CONFLICT);
}

/**
 * Record -> DTO.
 *
 * `isLeaf` and `depth` are computed from the supplied index rather than read
 * from a column, because neither is stored. A node inside a parent cycle is
 * unreachable from any root, so the index holds no depth for it; it is reported
 * as UNREACHABLE_DEPTH and the tree validator raises the matching CYCLE
 * violation, so the condition surfaces as a diagnosis rather than as a silently
 * odd number.
 *
 * ruleConfig is a Json column, so its static type is Prisma's JsonValue. It is
 * narrowed here to the shape the validation layer guarantees on write; the cast
 * is confined to this one line rather than repeated by every consumer.
 */
function toDTO(
  record: EvaluationComponentRecord,
  index: ComponentTreeIndex
): EvaluationComponentDTO {
  return {
    id: record.id,
    tenantId: record.tenantId,
    schemeId: record.schemeId,
    parentComponentId: record.parentComponentId,
    code: record.code,
    name: record.name,
    description: record.description,
    type: record.type,
    sourceType: record.sourceType,
    maxMarks: record.maxMarks.toString(),
    weightage: record.weightage.toString(),
    aggregation: record.aggregation,
    rollup: record.rollup,
    ruleConfig: (record.ruleConfig ?? null) as ComponentRuleConfig | null,
    sequence: record.sequence,
    isMandatory: record.isMandatory,
    isLeaf: isLeafNode(index, record.id),
    depth: index.depthOf.get(record.id) ?? UNREACHABLE_DEPTH,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export class EvaluationComponentService {
  constructor(
    private readonly components: EvaluationComponentRepositoryPort,
    private readonly audit: AuditLogRepositoryPort
  ) {}

  /**
   * A scheme's whole component tree, with its fitness for activation.
   *
   * COMPLEXITY : two queries — the scheme, then its components — followed by an
   *              O(k) index build, an O(k) nest and an O(k) validation pass.
   *              Nothing is recomputed: one index serves the nesting, the leaf
   *              flags and the depths.
   */
  async getTree(tenantId: string, schemeId: string): Promise<EvaluationComponentTreeDTO> {
    const scheme = await this.components.findScheme(tenantId, schemeId);

    if (scheme === null) {
      throw schemeNotFound();
    }

    const records = await this.components.findTreeBySchemeId(tenantId, schemeId);

    return this.buildTreeDTO(schemeId, scheme.status, records);
  }

  /**
   * One component of one scheme.
   *
   * The whole tree is loaded rather than the single row, because the DTO
   * reports isLeaf and depth and neither is knowable from the row alone. At a
   * handful of rows per scheme that is cheaper than the two extra queries a
   * children-count and an ancestor-walk would otherwise cost.
   */
  async getById(
    tenantId: string,
    schemeId: string,
    componentId: string
  ): Promise<EvaluationComponentDTO> {
    const scheme = await this.components.findScheme(tenantId, schemeId);

    if (scheme === null) {
      throw schemeNotFound();
    }

    const records = await this.components.findTreeBySchemeId(tenantId, schemeId);
    const record = records.find((candidate) => candidate.id === componentId);

    if (record === undefined) {
      throw componentNotFound();
    }

    return toDTO(record, indexComponentTree(records));
  }

  /**
   * Add a component to a draft regulation.
   *
   * RULES      : The scheme must exist and still be a DRAFT — an activated tree
   *              is frozen, which is the basis of historical reproducibility.
   *
   *              A supplied parent must belong to THIS scheme. The database
   *              already guarantees that structurally through the three-column
   *              foreign key, so this check exists purely to answer 404 with an
   *              explanation instead of surfacing a raw constraint violation.
   *
   *              The position must be free among the node's siblings. For a
   *              nested node the unique index enforces this too; for a ROOT it
   *              does not, because parentComponentId is NULL and PostgreSQL
   *              treats NULLs as distinct. The service therefore checks both,
   *              which makes root and non-root behave identically to a caller.
   *
   *              Whole-tree rules — sibling weights totalling 100, leaf/branch
   *              coherence — are deliberately NOT applied here. A draft is
   *              incomplete while it is being built, and rejecting the first of
   *              two components that must together total 100 would make the
   *              tree impossible to enter. They bind at activation.
   *
   * COMPLEXITY : three reads and two writes, all O(log n) plus one O(k) pass.
   */
  async create(
    tenantId: string,
    schemeId: string,
    input: CreateEvaluationComponentInput,
    context: RequestContext
  ): Promise<EvaluationComponentDTO> {
    return this.components.transaction(async (tx) => {
      await this.assertMutableScheme(tenantId, schemeId, tx);

      const records = await this.components.findTreeBySchemeId(tenantId, schemeId, tx);
      const parentComponentId = input.parentComponentId ?? null;

      this.assertParentExists(records, parentComponentId);
      this.assertPositionFree(records, parentComponentId, input.sequence, null);

      const created = await this.components.create(
        {
          tenantId,
          schemeId,
          parentComponentId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          type: input.type,
          sourceType: input.sourceType,
          maxMarks: input.maxMarks,
          weightage: input.weightage,
          aggregation: input.aggregation ?? null,
          rollup: input.rollup ?? null,
          ruleConfig: input.ruleConfig ?? null,
          sequence: input.sequence,
          isMandatory: input.isMandatory,
        },
        tx
      );

      // The new node is folded into the already-loaded list rather than
      // re-reading the tree, so the DTO's isLeaf and depth are correct without a
      // fourth query.
      const dto = toDTO(created, indexComponentTree([...records, created]));

      await this.recordAudit(
        tenantId,
        EVALUATION_COMPONENT_AUDIT_ACTION.CREATED,
        created.id,
        context,
        tx,
        undefined,
        dto
      );

      return dto;
    });
  }

  /**
   * Amend a component of a draft regulation.
   *
   * RULES      : Draft-only, as for create.
   *
   *              Re-parenting is checked for cycles: a node may not be moved
   *              beneath its own descendant, which no foreign key can express
   *              because every individual reference stays valid while the graph
   *              as a whole stops being a tree.
   *
   *              A change to either the parent or the position re-checks the
   *              target sibling group, excluding the node itself so that
   *              re-saving a component without moving it is never a conflict.
   *
   * COMPLEXITY : three reads and two writes, all O(log n) plus O(k) passes.
   */
  async update(
    tenantId: string,
    schemeId: string,
    componentId: string,
    input: UpdateEvaluationComponentInput,
    context: RequestContext
  ): Promise<EvaluationComponentDTO> {
    return this.components.transaction(async (tx) => {
      await this.assertMutableScheme(tenantId, schemeId, tx);

      const records = await this.components.findTreeBySchemeId(tenantId, schemeId, tx);
      const existing = records.find((candidate) => candidate.id === componentId);

      if (existing === undefined) {
        throw componentNotFound();
      }

      const parentComponentId =
        input.parentComponentId === undefined
          ? existing.parentComponentId
          : input.parentComponentId;

      if (parentComponentId !== existing.parentComponentId) {
        this.assertParentExists(records, parentComponentId);

        if (parentComponentId !== null && wouldCreateCycle(records, componentId, parentComponentId)) {
          throw conflict(EVALUATION_COMPONENT_MESSAGE.CYCLE);
        }
      }

      const sequence = input.sequence ?? existing.sequence;

      if (parentComponentId !== existing.parentComponentId || sequence !== existing.sequence) {
        this.assertPositionFree(records, parentComponentId, sequence, componentId);
      }

      const before = toDTO(existing, indexComponentTree(records));

      const updated = await this.components.update(
        tenantId,
        componentId,
        this.toUpdateData(input),
        tx
      );

      const merged = records.map((record) => (record.id === componentId ? updated : record));
      const dto = toDTO(updated, indexComponentTree(merged));

      await this.recordAudit(
        tenantId,
        EVALUATION_COMPONENT_AUDIT_ACTION.UPDATED,
        componentId,
        context,
        tx,
        before,
        dto
      );

      return dto;
    });
  }

  /**
   * Remove a component and everything beneath it.
   *
   * RULES      : Draft-only. The subtree is computed in memory and removed in
   *              ONE bulk statement rather than by a database cascade, for two
   *              reasons: the audit entry records exactly which nodes went, and
   *              the parent foreign key is ON DELETE NO ACTION — checked by
   *              PostgreSQL at end-of-statement — so parent and children
   *              disappearing together satisfies it, while deleting the parent
   *              alone would be refused.
   *
   * RETURNS    : the number of components removed, so the caller can report
   *              that a subtree went rather than a single node.
   *
   * COMPLEXITY : three reads and two writes; the subtree walk is O(k).
   */
  async remove(
    tenantId: string,
    schemeId: string,
    componentId: string,
    context: RequestContext
  ): Promise<{ removedCount: number }> {
    return this.components.transaction(async (tx) => {
      await this.assertMutableScheme(tenantId, schemeId, tx);

      const records = await this.components.findTreeBySchemeId(tenantId, schemeId, tx);
      const existing = records.find((candidate) => candidate.id === componentId);

      if (existing === undefined) {
        throw componentNotFound();
      }

      const index = indexComponentTree(records);
      const doomedIds = collectSubtreeIds(records, componentId);
      const doomed = new Set(doomedIds);

      const before = records
        .filter((record) => doomed.has(record.id))
        .map((record) => toDTO(record, index));

      const removedCount = await this.components.deleteMany(tenantId, doomedIds, tx);

      await this.recordAudit(
        tenantId,
        EVALUATION_COMPONENT_AUDIT_ACTION.DELETED,
        componentId,
        context,
        tx,
        before,
        undefined
      );

      return { removedCount };
    });
  }

  /**
   * Assemble the tree response.
   *
   * One index serves three purposes — nesting, leaf flags and depths — so
   * nothing about the tree's shape is computed twice.
   */
  private buildTreeDTO(
    schemeId: string,
    schemeStatus: EvaluationComponentTreeDTO["schemeStatus"],
    records: readonly EvaluationComponentRecord[]
  ): EvaluationComponentTreeDTO {
    const index = indexComponentTree(records);
    const violations = validateComponentTree(records);

    const nest = (record: EvaluationComponentRecord): EvaluationComponentNodeDTO => ({
      ...toDTO(record, index),
      children: (index.childrenOf.get(record.id) ?? []).map((child) =>
        nest(child as EvaluationComponentRecord)
      ),
    });

    return {
      schemeId,
      schemeStatus,
      isMutable: schemeStatus === EVALUATION_SCHEME_MUTABLE_STATUS,
      componentCount: records.length,
      // Built from the roots, so a node trapped in a cycle is absent from the
      // tree — which is precisely the condition the CYCLE violation reports, and
      // is why componentCount is taken from the row count rather than the tree.
      tree: index.roots.map((root) => nest(root as EvaluationComponentRecord)),
      validation: {
        isValid: violations.length === 0,
        violations,
      },
    };
  }

  /** The scheme must exist, belong to this tenant, and still be a draft. */
  private async assertMutableScheme(
    tenantId: string,
    schemeId: string,
    tx: DbClient
  ): Promise<void> {
    const scheme = await this.components.findScheme(tenantId, schemeId, tx);

    if (scheme === null) {
      throw schemeNotFound();
    }

    if (scheme.status !== EVALUATION_SCHEME_MUTABLE_STATUS) {
      throw conflict(EVALUATION_COMPONENT_MESSAGE.SCHEME_NOT_MUTABLE);
    }
  }

  /** A named parent must be one of this scheme's own components. */
  private assertParentExists(
    records: readonly EvaluationComponentRecord[],
    parentComponentId: string | null
  ): void {
    if (parentComponentId === null) {
      return;
    }

    if (!records.some((record) => record.id === parentComponentId)) {
      throw new AppError(
        EVALUATION_COMPONENT_MESSAGE.PARENT_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }
  }

  /**
   * No sibling may already occupy this position.
   *
   * `excludeId` keeps a component from colliding with itself when it is saved
   * without being moved.
   */
  private assertPositionFree(
    records: readonly EvaluationComponentRecord[],
    parentComponentId: string | null,
    sequence: number,
    excludeId: string | null
  ): void {
    const taken = records.some(
      (record) =>
        record.id !== excludeId &&
        record.parentComponentId === parentComponentId &&
        record.sequence === sequence
    );

    if (taken) {
      throw conflict(EVALUATION_COMPONENT_MESSAGE.DUPLICATE_SEQUENCE);
    }
  }

  /**
   * Narrow a validated PATCH body to the columns the repository may write.
   *
   * Explicit rather than a spread, so a field added to the validator never
   * becomes writable here by accident.
   */
  private toUpdateData(input: UpdateEvaluationComponentInput): UpdateEvaluationComponentData {
    return {
      parentComponentId: input.parentComponentId,
      code: input.code,
      name: input.name,
      description: input.description,
      type: input.type,
      sourceType: input.sourceType,
      maxMarks: input.maxMarks,
      weightage: input.weightage,
      aggregation: input.aggregation,
      rollup: input.rollup,
      ruleConfig: input.ruleConfig,
      sequence: input.sequence,
      isMandatory: input.isMandatory,
    };
  }

  /** Write one audit entry inside the caller's transaction. */
  private async recordAudit(
    tenantId: string,
    action: string,
    resourceId: string,
    context: RequestContext,
    tx: DbClient,
    before: unknown,
    after: unknown
  ): Promise<void> {
    await this.audit.record(
      {
        tenantId,
        userId: context.actorId,
        action,
        resource: EVALUATION_COMPONENT_RESOURCE,
        resourceId,
        before,
        after,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      tx as AuditDbClient
    );
  }
}
