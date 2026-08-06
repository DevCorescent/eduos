// ============================================================================
// OWNER      : Gauransh
// MODULE     : Passing Criterion
// LAYER      : Service
// PURPOSE    : Every business rule governing a regulation's thresholds —
//              mutability, metric/unit/component coherence, the threshold's
//              relationship to the component it constrains, atomicity and
//              audit.
// ARCHITECTURE:
//   • Service contains ALL business logic.
//   • It owns transaction BOUNDARIES; the repository owns the Prisma handle.
//   • Pure coherence rules live in lib/domain/result-engine/policies.ts,
//     shared with the Zod layer so neither owns them alone.
//   • All four dependencies arrive through the constructor as PORTS, imported
//     with `import type`, so this module's runtime graph never reaches
//     lib/db/prisma.
//
// THE QUERY BUDGET
//   create : scheme + (component) + insert + audit   → 3–4
//   update : scheme + criterion + (component) + update + audit → 4–5
//   remove : scheme + criterion + delete + audit     → 4
//   getAll : scheme + criterion set                  → 2
//   getById: criterion                               → 1
//
//   Note what is ABSENT: create loads no criterion set. Criteria have no
//   position and no ordering semantics, and code uniqueness is enforced by
//   @@unique([schemeId, code]) — so there is nothing an in-memory scan could
//   answer that the database does not already guarantee. Loading the set anyway
//   would be a query bought for symmetry with the rule service rather than for
//   a reason.
//
// WHY DUPLICATE (component, metric) PAIRS ARE ALLOWED
//   A regulation may legitimately require "theory >= 21 marks" AND
//   "theory >= 30%" — the same component and metric under two units. No
//   constraint forbids it and none should; the criteria form a conjunction, so
//   two thresholds on one component simply both apply.
// ============================================================================

import { PassingMetric, ThresholdUnit } from "@/app/generated/prisma/enums";
import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import { EVALUATION_SCHEME_MUTABLE_STATUS } from "@/lib/constants/evaluationScheme";
import {
  CRITERION_SCOPE,
  PASSING_CRITERION_AUDIT_ACTION,
  PASSING_CRITERION_MESSAGE,
  PASSING_CRITERION_RESOURCE,
  SEMESTER_SCOPED_METRICS,
  type CriterionScope,
} from "@/lib/constants/passingCriterion";
import { checkCriterionCoherence } from "@/lib/domain/result-engine/policies";
import { parseHundredths } from "@/lib/domain/evaluationComponentTree";
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
  PassingCriterionRecord,
  PassingCriterionRepositoryPort,
  UpdatePassingCriterionData,
} from "@/lib/repositories/passingCriterion.repository";
import type {
  PassingCriterionDTO,
  PassingCriterionListDTO,
} from "@/lib/dto/passingCriterion.dto";
import type {
  CreatePassingCriterionInput,
  UpdatePassingCriterionInput,
} from "@/lib/validations/passingCriterion";
import type { RequestContext } from "@/lib/utils/request-context";
import type { ValidationDetail } from "@/lib/utils/validation-error";

/** 404 — the criterion does not exist in this scheme, or this tenant. */
function criterionNotFound(): AppError {
  return new AppError(
    PASSING_CRITERION_MESSAGE.NOT_FOUND,
    HTTP_STATUS.NOT_FOUND,
    ERROR_CODE.NOT_FOUND
  );
}

/** 404 — the owning scheme does not exist, or belongs to another tenant. */
function schemeNotFound(): AppError {
  return new AppError(
    PASSING_CRITERION_MESSAGE.SCHEME_NOT_FOUND,
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
 * Where a criterion is evaluated, derived from what it measures.
 *
 * Not a stored column: the metric already determines it, and a column able to
 * disagree with the metric it describes would be a second source of truth.
 */
function scopeOf(metric: PassingMetric): CriterionScope {
  return SEMESTER_SCOPED_METRICS.includes(metric)
    ? CRITERION_SCOPE.SEMESTER
    : CRITERION_SCOPE.COURSE;
}

/**
 * Record -> DTO.
 *
 * `threshold` is a Prisma Decimal; .toString() is lossless where Number() would
 * not be in the general case, and it keeps the class instance out of the
 * response type.
 */
function toDTO(record: PassingCriterionRecord): PassingCriterionDTO {
  return {
    id: record.id,
    tenantId: record.tenantId,
    schemeId: record.schemeId,
    componentId: record.componentId,
    code: record.code,
    name: record.name,
    description: record.description,
    metric: record.metric,
    threshold: record.threshold.toString(),
    unit: record.unit,
    failureOutcome: record.failureOutcome,
    scope: scopeOf(record.metric),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export class PassingCriterionService {
  constructor(
    private readonly criteria: PassingCriterionRepositoryPort,
    private readonly audit: AuditLogRepositoryPort,
    private readonly schemes: EvaluationSchemeLifecyclePort,
    private readonly components: EvaluationComponentLookupPort
  ) {}

  /**
   * A regulation's whole criterion set.
   *
   * COMPLEXITY : two queries, then ONE pass building the DTOs and tallying both
   *              scope counts. Counting inside the same loop avoids two further
   *              traversals for figures every caller displays.
   */
  async getAll(tenantId: string, schemeId: string): Promise<PassingCriterionListDTO> {
    const scheme = await this.schemes.findById(tenantId, schemeId);

    if (scheme === null) {
      throw schemeNotFound();
    }

    const records = await this.criteria.findAllBySchemeId(tenantId, schemeId);

    const dtos: PassingCriterionDTO[] = [];
    let courseScopedCount = 0;
    let semesterScopedCount = 0;

    for (const record of records) {
      const dto = toDTO(record);
      dtos.push(dto);

      if (dto.scope === CRITERION_SCOPE.SEMESTER) {
        semesterScopedCount += 1;
      } else {
        courseScopedCount += 1;
      }
    }

    return {
      schemeId,
      isMutable: scheme.status === EVALUATION_SCHEME_MUTABLE_STATUS,
      courseScopedCount,
      semesterScopedCount,
      criteria: dtos,
    };
  }

  /**
   * One criterion.
   *
   * The owning scheme is deliberately not loaded: the repository lookup is
   * already scoped by tenant and scheme, so an unknown scheme and an unknown
   * criterion produce the identical 404 — a saved query and the correct
   * disclosure behaviour at once.
   *
   * COMPLEXITY : one query, O(log n).
   */
  async getById(
    tenantId: string,
    schemeId: string,
    criterionId: string
  ): Promise<PassingCriterionDTO> {
    const record = await this.criteria.findById(tenantId, schemeId, criterionId);

    if (record === null) {
      throw criterionNotFound();
    }

    return toDTO(record);
  }

  /**
   * Add a threshold to a draft regulation.
   *
   * RULES      : Draft-only. The coherence rules are re-applied here even
   *              though Zod already checked the body, because this service is
   *              the invariant boundary rather than the HTTP layer — a future
   *              internal caller reaches this method without a schema in front
   *              of it and must not be able to store an incoherent criterion.
   *
   *              A MARKS threshold is checked against the component's own
   *              maximum. This is the one rule Zod cannot apply, because it
   *              needs the stored component — the same split already used for
   *              passMark <= maxMarks in the examination module.
   *
   * COMPLEXITY : three or four statements, all O(log n).
   */
  async create(
    tenantId: string,
    schemeId: string,
    input: CreatePassingCriterionInput,
    context: RequestContext
  ): Promise<PassingCriterionDTO> {
    return this.criteria.transaction(async (tx) => {
      await this.assertMutableScheme(tenantId, schemeId, tx);

      const componentId = input.componentId ?? null;

      this.assertCoherent({
        metric: input.metric,
        unit: input.unit,
        threshold: input.threshold,
        componentId,
      });

      if (componentId !== null) {
        await this.assertThresholdFitsComponent(
          tenantId,
          schemeId,
          componentId,
          input.unit,
          input.threshold,
          tx
        );
      }

      const created = await this.criteria.create(
        {
          tenantId,
          schemeId,
          componentId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          metric: input.metric,
          threshold: input.threshold,
          unit: input.unit,
          failureOutcome: input.failureOutcome,
        },
        tx
      );

      const dto = toDTO(created);

      await this.recordAudit(
        tenantId,
        PASSING_CRITERION_AUDIT_ACTION.CREATED,
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
   * Amend a threshold of a draft regulation.
   *
   * RULES      : Draft-only. All three coherence rules are re-evaluated against
   *              the MERGED values — the reason they live in a pure module
   *              rather than inside the Zod schema. A PATCH may supply `unit`
   *              without `metric`, which is not checkable from the body alone.
   *
   *              The component is re-read only when the component, the unit or
   *              the threshold actually changes; a PATCH touching only the name
   *              pays for no extra query.
   *
   * COMPLEXITY : four or five statements, all O(log n).
   */
  async update(
    tenantId: string,
    schemeId: string,
    criterionId: string,
    input: UpdatePassingCriterionInput,
    context: RequestContext
  ): Promise<PassingCriterionDTO> {
    return this.criteria.transaction(async (tx) => {
      await this.assertMutableScheme(tenantId, schemeId, tx);

      const existing = await this.criteria.findById(tenantId, schemeId, criterionId, tx);

      if (existing === null) {
        throw criterionNotFound();
      }

      const metric = input.metric ?? existing.metric;
      const unit = input.unit ?? existing.unit;
      const threshold = input.threshold ?? Number(existing.threshold);
      const componentId =
        input.componentId === undefined ? existing.componentId : input.componentId;

      this.assertCoherent({ metric, unit, threshold, componentId });

      const componentChanged = componentId !== existing.componentId;
      const boundsChanged = input.unit !== undefined || input.threshold !== undefined;

      if (componentId !== null && (componentChanged || boundsChanged)) {
        await this.assertThresholdFitsComponent(
          tenantId,
          schemeId,
          componentId,
          unit,
          threshold,
          tx
        );
      }

      const before = toDTO(existing);

      const updated = await this.criteria.update(
        tenantId,
        criterionId,
        this.toUpdateData(input),
        tx
      );
      const dto = toDTO(updated);

      await this.recordAudit(
        tenantId,
        PASSING_CRITERION_AUDIT_ACTION.UPDATED,
        criterionId,
        context,
        tx,
        before,
        dto
      );

      return dto;
    });
  }

  /**
   * Remove a threshold from a draft regulation.
   *
   * Its full contents are captured in the audit entry before the row goes, so a
   * relaxed requirement leaves evidence of what it used to be.
   *
   * COMPLEXITY : four statements, all O(log n).
   */
  async remove(
    tenantId: string,
    schemeId: string,
    criterionId: string,
    context: RequestContext
  ): Promise<void> {
    await this.criteria.transaction(async (tx) => {
      await this.assertMutableScheme(tenantId, schemeId, tx);

      const existing = await this.criteria.findById(tenantId, schemeId, criterionId, tx);

      if (existing === null) {
        throw criterionNotFound();
      }

      const before = toDTO(existing);

      await this.criteria.delete(tenantId, criterionId, tx);

      await this.recordAudit(
        tenantId,
        PASSING_CRITERION_AUDIT_ACTION.DELETED,
        criterionId,
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
      throw conflict(PASSING_CRITERION_MESSAGE.SCHEME_NOT_MUTABLE);
    }
  }

  /** Reject an internally incoherent criterion, reporting every fault at once. */
  private assertCoherent(input: {
    metric: PassingMetric;
    unit: ThresholdUnit;
    threshold: number;
    componentId: string | null;
  }): void {
    const violations = checkCriterionCoherence(input);

    if (violations.length > 0) {
      throw invalid(PASSING_CRITERION_MESSAGE.UNIT_NOT_PERMITTED, violations);
    }
  }

  /**
   * The component must exist, and a MARKS threshold must fit inside it.
   *
   * The comparison is made in integer HUNDREDTHS rather than on floats, reusing
   * the exact parser the component tree already relies on. A threshold of 21.00
   * against a maximum of 21.00 must compare equal, and IEEE 754 does not
   * guarantee that for values reached by different routes.
   *
   * A PERCENT threshold needs no such check — it was already bounded at 100 by
   * the coherence rules, and a percentage is scale-independent by definition.
   */
  private async assertThresholdFitsComponent(
    tenantId: string,
    schemeId: string,
    componentId: string,
    unit: ThresholdUnit,
    threshold: number,
    tx: DbClient
  ): Promise<void> {
    const component = await this.components.findById(tenantId, schemeId, componentId, tx);

    if (component === null) {
      throw new AppError(
        PASSING_CRITERION_MESSAGE.COMPONENT_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }

    if (unit !== ThresholdUnit.MARKS) {
      return;
    }

    if (parseHundredths(threshold) > parseHundredths(component.maxMarks)) {
      throw invalid(PASSING_CRITERION_MESSAGE.THRESHOLD_EXCEEDS_COMPONENT, [
        {
          field: "threshold",
          message: `${PASSING_CRITERION_MESSAGE.THRESHOLD_EXCEEDS_COMPONENT} (${component.maxMarks.toString()})`,
        },
      ]);
    }
  }

  /**
   * Narrow a validated PATCH body to the columns the repository may write.
   *
   * Explicit rather than a spread, so a field added to the validator never
   * becomes writable here by accident.
   */
  private toUpdateData(input: UpdatePassingCriterionInput): UpdatePassingCriterionData {
    return {
      componentId: input.componentId,
      code: input.code,
      name: input.name,
      description: input.description,
      metric: input.metric,
      threshold: input.threshold,
      unit: input.unit,
      failureOutcome: input.failureOutcome,
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
        resource: PASSING_CRITERION_RESOURCE,
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
