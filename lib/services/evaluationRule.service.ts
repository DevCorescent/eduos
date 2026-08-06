// ============================================================================
// OWNER      : Gauransh
// MODULE     : Evaluation Rule
// LAYER      : Service
// PURPOSE    : Every business rule governing a regulation's policy pipeline —
//              mutability, phase/component coherence, config-to-operation
//              agreement, variable availability, pipeline position, atomicity
//              and audit.
// ARCHITECTURE:
//   • Service contains ALL business logic.
//   • It owns transaction BOUNDARIES; the repository owns the Prisma handle.
//   • Pure coherence rules live one layer further in, in
//     lib/domain/result-engine/policies.ts, because the Zod layer applies the
//     same rules on create and neither layer should own them alone.
//   • All four dependencies arrive through the constructor as PORTS, imported
//     with `import type`, so this module's runtime graph never reaches
//     lib/db/prisma and it unit-tests with no database.
//
// THE QUERY BUDGET
//   create : scheme + (component) + rule set + insert + audit   → 4–5
//   update : scheme + rule set + (component) + update  + audit  → 4–5
//   remove : scheme + rule set + delete + audit                 → 4
//   getAll : scheme + rule set                                  → 2
//   getById: rule                                               → 1
//
//   The rule set is loaded ONCE per mutation and answers two questions — which
//   rule is being addressed, and whether the target position is free. There is
//   no query inside any loop in this module.
//
// WHY NO SERIALIZABLE ISOLATION
//   componentId is nullable, so @@unique([schemeId, componentId, phase,
//   sequence]) leaves two concurrent COURSE-level creates able to take the same
//   position. That race is benign here, unlike the single-ACTIVE-revision
//   invariant in C2: the repository orders by (phase, sequence, code) and code
//   is unique per scheme, so execution order stays TOTAL and deterministic even
//   when two rules share a sequence. A duplicate position is a cosmetic defect,
//   not a correctness one, and paying for SERIALIZABLE to prevent it would be
//   pessimism without measurable value.
// ============================================================================

import { RuleOperation, RulePhase } from "@/app/generated/prisma/enums";
import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import { EVALUATION_SCHEME_MUTABLE_STATUS } from "@/lib/constants/evaluationScheme";
import {
  COHORT_SCOPED_OPERATIONS,
  EVALUATION_RULE_AUDIT_ACTION,
  EVALUATION_RULE_MESSAGE,
  EVALUATION_RULE_RESOURCE,
} from "@/lib/constants/evaluationRule";
import { checkRuleScope, checkRuleVariableScope } from "@/lib/domain/result-engine/policies";
import { ruleConfigSchemaFor } from "@/lib/validations/evaluationRule";
import type {
  AuditLogRepositoryPort,
  DbClient as AuditDbClient,
} from "@/lib/repositories/auditLog.repository";
import type {
  EvaluationComponentLookupPort,
  EvaluationSchemeLifecyclePort,
} from "@/lib/repositories/evaluationConfig.ports";
import type {
  DbClient,
  EvaluationRuleRecord,
  EvaluationRuleRepositoryPort,
  UpdateEvaluationRuleData,
} from "@/lib/repositories/evaluationRule.repository";
import type {
  EvaluationRuleDTO,
  EvaluationRuleListDTO,
} from "@/lib/dto/evaluationRule.dto";
import type {
  CreateEvaluationRuleInput,
  EvaluationRuleCondition,
  EvaluationRuleConfig,
  UpdateEvaluationRuleInput,
} from "@/lib/validations/evaluationRule";
import type { RequestContext } from "@/lib/utils/request-context";
import type { ValidationDetail } from "@/lib/utils/validation-error";

/** 404 — the rule does not exist in this scheme, or this tenant. */
function ruleNotFound(): AppError {
  return new AppError(
    EVALUATION_RULE_MESSAGE.NOT_FOUND,
    HTTP_STATUS.NOT_FOUND,
    ERROR_CODE.NOT_FOUND
  );
}

/** 404 — the owning scheme does not exist, or belongs to another tenant. */
function schemeNotFound(): AppError {
  return new AppError(
    EVALUATION_RULE_MESSAGE.SCHEME_NOT_FOUND,
    HTTP_STATUS.NOT_FOUND,
    ERROR_CODE.NOT_FOUND
  );
}

/** 409 — the request is well-formed but the stored state forbids it. */
function conflict(message: string): AppError {
  return new AppError(message, HTTP_STATUS.CONFLICT, ERROR_CODE.CONFLICT);
}

/** 400 — the merged values are internally incoherent, with per-field detail. */
function invalid(message: string, details: readonly ValidationDetail[]): AppError {
  return new AppError(message, HTTP_STATUS.BAD_REQUEST, ERROR_CODE.VALIDATION, details);
}

/**
 * Record -> DTO.
 *
 * `config` and `condition` are Json columns, so their static type from Prisma
 * is JsonValue. They are narrowed here, once, to the shapes the validation
 * layer guarantees on write — so the engine can switch on `operation` and read
 * `config` without re-parsing.
 *
 * `isCohortScoped` is DERIVED from the operation rather than read from a
 * column. MODERATION and CURVE cannot be evaluated for one student in
 * isolation; storing that as a flag would be a second source of truth for a
 * fact the operation already settles.
 */
function toDTO(record: EvaluationRuleRecord): EvaluationRuleDTO {
  return {
    id: record.id,
    tenantId: record.tenantId,
    schemeId: record.schemeId,
    componentId: record.componentId,
    code: record.code,
    name: record.name,
    description: record.description,
    phase: record.phase,
    operation: record.operation,
    sequence: record.sequence,
    config: (record.config ?? null) as EvaluationRuleConfig | null,
    condition: (record.condition ?? null) as EvaluationRuleCondition | null,
    isCohortScoped: COHORT_SCOPED_OPERATIONS.includes(record.operation),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export class EvaluationRuleService {
  constructor(
    private readonly rules: EvaluationRuleRepositoryPort,
    private readonly audit: AuditLogRepositoryPort,
    private readonly schemes: EvaluationSchemeLifecyclePort,
    private readonly components: EvaluationComponentLookupPort
  ) {}

  /**
   * A regulation's whole rule set, in pipeline execution order.
   *
   * COMPLEXITY : two queries, then ONE pass building the DTOs and deciding
   *              whether any rule forces cohort-wide computation. Deriving that
   *              flag inside the same loop avoids a second traversal for a
   *              question every caller asks.
   */
  async getAll(tenantId: string, schemeId: string): Promise<EvaluationRuleListDTO> {
    const scheme = await this.schemes.findById(tenantId, schemeId);

    if (scheme === null) {
      throw schemeNotFound();
    }

    const records = await this.rules.findAllBySchemeId(tenantId, schemeId);

    const dtos: EvaluationRuleDTO[] = [];
    let requiresCohortComputation = false;

    for (const record of records) {
      const dto = toDTO(record);
      dtos.push(dto);

      if (dto.isCohortScoped) {
        requiresCohortComputation = true;
      }
    }

    return {
      schemeId,
      isMutable: scheme.status === EVALUATION_SCHEME_MUTABLE_STATUS,
      requiresCohortComputation,
      ruleCount: dtos.length,
      rules: dtos,
    };
  }

  /**
   * One rule.
   *
   * The owning scheme is deliberately NOT loaded. The repository lookup is
   * already scoped by tenant and scheme, so an unknown scheme and an unknown
   * rule produce the identical 404 — which is both a saved query and the
   * correct disclosure behaviour, since neither id is confirmed to exist.
   *
   * COMPLEXITY : one query, O(log n).
   */
  async getById(
    tenantId: string,
    schemeId: string,
    ruleId: string
  ): Promise<EvaluationRuleDTO> {
    const record = await this.rules.findById(tenantId, schemeId, ruleId);

    if (record === null) {
      throw ruleNotFound();
    }

    return toDTO(record);
  }

  /**
   * Add a rule to a draft regulation.
   *
   * RULES      : The scheme must exist and still be a DRAFT — an activated
   *              pipeline is frozen, which is the basis of reproducibility.
   *
   *              The config must match the operation, the phase must agree with
   *              whether a component is named, and no variable may be read
   *              before it exists. The Zod layer applied all three to the
   *              request body; they are applied AGAIN here because this service
   *              is the invariant boundary, not the HTTP layer — a future
   *              internal caller (a scheme-cloning routine, an import) reaches
   *              this method without passing through a Zod schema, and must not
   *              be able to store a rule whose config contradicts its
   *              operation.
   *
   *              A named component must exist in THIS scheme. The database
   *              guarantees it structurally through the three-column foreign
   *              key; this check exists to answer 404 with an explanation
   *              rather than surfacing a raw constraint violation.
   *
   * COMPLEXITY : four or five statements, all O(log n) except the position
   *              check, which is O(r) over an already-loaded set.
   */
  async create(
    tenantId: string,
    schemeId: string,
    input: CreateEvaluationRuleInput,
    context: RequestContext
  ): Promise<EvaluationRuleDTO> {
    return this.rules.transaction(async (tx) => {
      await this.assertMutableScheme(tenantId, schemeId, tx);

      const componentId = input.componentId ?? null;

      this.assertCoherent(input.phase, input.operation, componentId, input.config, input.condition);

      if (componentId !== null) {
        await this.assertComponentExists(tenantId, schemeId, componentId, tx);
      }

      const records = await this.rules.findAllBySchemeId(tenantId, schemeId, tx);

      this.assertPositionFree(records, componentId, input.phase, input.sequence, null);

      const created = await this.rules.create(
        {
          tenantId,
          schemeId,
          componentId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          phase: input.phase,
          operation: input.operation,
          sequence: input.sequence,
          config: input.config ?? null,
          condition: input.condition ?? null,
        },
        tx
      );

      const dto = toDTO(created);

      await this.recordAudit(
        tenantId,
        EVALUATION_RULE_AUDIT_ACTION.CREATED,
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
   * Amend a rule of a draft regulation.
   *
   * RULES      : Draft-only, as for create.
   *
   *              Every coherence rule is re-evaluated against the MERGED
   *              values, which is the whole reason those rules live in a pure
   *              module rather than inside the Zod schema. A PATCH may supply
   *              `config` without `operation`, or `phase` without
   *              `componentId`; neither is checkable from the body alone, and a
   *              schema that tried would either accept an incoherent merge or
   *              reject a coherent one.
   *
   *              The component is re-verified only when it CHANGES. Re-reading
   *              a component the caller did not touch would be a duplicate
   *              query bought for nothing.
   *
   * COMPLEXITY : four or five statements. The rule set load serves both the
   *              lookup of the rule being amended and the position check — one
   *              query answering two questions.
   */
  async update(
    tenantId: string,
    schemeId: string,
    ruleId: string,
    input: UpdateEvaluationRuleInput,
    context: RequestContext
  ): Promise<EvaluationRuleDTO> {
    return this.rules.transaction(async (tx) => {
      await this.assertMutableScheme(tenantId, schemeId, tx);

      const records = await this.rules.findAllBySchemeId(tenantId, schemeId, tx);
      const existing = records.find((candidate) => candidate.id === ruleId);

      if (existing === undefined) {
        throw ruleNotFound();
      }

      const phase = input.phase ?? existing.phase;
      const operation = input.operation ?? existing.operation;
      const componentId =
        input.componentId === undefined ? existing.componentId : input.componentId;
      const config = input.config === undefined ? existing.config : input.config;
      const condition = input.condition === undefined ? existing.condition : input.condition;
      const sequence = input.sequence ?? existing.sequence;

      this.assertCoherent(phase, operation, componentId, config, condition);

      if (componentId !== null && componentId !== existing.componentId) {
        await this.assertComponentExists(tenantId, schemeId, componentId, tx);
      }

      if (
        componentId !== existing.componentId ||
        phase !== existing.phase ||
        sequence !== existing.sequence
      ) {
        this.assertPositionFree(records, componentId, phase, sequence, ruleId);
      }

      const before = toDTO(existing);

      const updated = await this.rules.update(tenantId, ruleId, this.toUpdateData(input), tx);
      const dto = toDTO(updated);

      await this.recordAudit(
        tenantId,
        EVALUATION_RULE_AUDIT_ACTION.UPDATED,
        ruleId,
        context,
        tx,
        before,
        dto
      );

      return dto;
    });
  }

  /**
   * Remove a rule from a draft regulation.
   *
   * A rule owns nothing, so there is no subtree to gather as there is for a
   * component — the removal is a single delete. Its full contents are captured
   * in the audit entry before the row goes.
   *
   * COMPLEXITY : four statements, all O(log n) except the O(r) lookup in the
   *              already-loaded set.
   */
  async remove(
    tenantId: string,
    schemeId: string,
    ruleId: string,
    context: RequestContext
  ): Promise<void> {
    await this.rules.transaction(async (tx) => {
      await this.assertMutableScheme(tenantId, schemeId, tx);

      const existing = await this.rules.findById(tenantId, schemeId, ruleId, tx);

      if (existing === null) {
        throw ruleNotFound();
      }

      const before = toDTO(existing);

      await this.rules.delete(tenantId, ruleId, tx);

      await this.recordAudit(
        tenantId,
        EVALUATION_RULE_AUDIT_ACTION.DELETED,
        ruleId,
        context,
        tx,
        before,
        undefined
      );
    });
  }

  /** The scheme must exist, belong to this tenant, and still be a draft. */
  private async assertMutableScheme(
    tenantId: string,
    schemeId: string,
    tx: DbClient
  ): Promise<void> {
    const scheme = await this.schemes.findById(tenantId, schemeId, tx);

    if (scheme === null) {
      throw schemeNotFound();
    }

    if (scheme.status !== EVALUATION_SCHEME_MUTABLE_STATUS) {
      throw conflict(EVALUATION_RULE_MESSAGE.SCHEME_NOT_MUTABLE);
    }
  }

  /**
   * Apply every rule that depends only on the rule's own effective values.
   *
   * Collected into one method so create and update enforce an identical set,
   * and so every violation is reported together — an administrator repairs a
   * misconfigured rule in one pass rather than one save per mistake.
   */
  private assertCoherent(
    phase: RulePhase,
    operation: RuleOperation,
    componentId: string | null,
    config: unknown,
    condition: unknown
  ): void {
    const violations: ValidationDetail[] = [...checkRuleScope(phase, componentId)];

    const parsed = ruleConfigSchemaFor(operation).safeParse(config);

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        violations.push({
          field: ["config", ...issue.path].join("."),
          message: issue.message,
        });
      }

      // The variable-scope check reads the expression tree, so running it on a
      // config already known to be malformed would report noise rather than a
      // second real problem.
      throw invalid(EVALUATION_RULE_MESSAGE.CONFIG_MISMATCH, violations);
    }

    violations.push(...checkRuleVariableScope(phase, operation, config, condition));

    if (violations.length > 0) {
      throw invalid(EVALUATION_RULE_MESSAGE.CONFIG_MISMATCH, violations);
    }
  }

  /** A named component must be one of this scheme's own. */
  private async assertComponentExists(
    tenantId: string,
    schemeId: string,
    componentId: string,
    tx: DbClient
  ): Promise<void> {
    const component = await this.components.findById(tenantId, schemeId, componentId, tx);

    if (component === null) {
      throw new AppError(
        EVALUATION_RULE_MESSAGE.COMPONENT_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }
  }

  /**
   * No other rule may already occupy this position in this pipeline stage.
   *
   * `excludeId` keeps a rule from colliding with itself when it is saved
   * without being moved.
   *
   * COMPLEXITY : O(r) over a set already in memory — no query.
   */
  private assertPositionFree(
    records: readonly EvaluationRuleRecord[],
    componentId: string | null,
    phase: RulePhase,
    sequence: number,
    excludeId: string | null
  ): void {
    const taken = records.some(
      (record) =>
        record.id !== excludeId &&
        record.componentId === componentId &&
        record.phase === phase &&
        record.sequence === sequence
    );

    if (taken) {
      throw conflict(EVALUATION_RULE_MESSAGE.DUPLICATE_SEQUENCE);
    }
  }

  /**
   * Narrow a validated PATCH body to the columns the repository may write.
   *
   * Explicit rather than a spread, so a field added to the validator never
   * becomes writable here by accident.
   */
  private toUpdateData(input: UpdateEvaluationRuleInput): UpdateEvaluationRuleData {
    return {
      componentId: input.componentId,
      code: input.code,
      name: input.name,
      description: input.description,
      phase: input.phase,
      operation: input.operation,
      sequence: input.sequence,
      config: input.config,
      condition: input.condition,
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
        resource: EVALUATION_RULE_RESOURCE,
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
