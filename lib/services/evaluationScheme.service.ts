// ============================================================================
// OWNER      : Gauransh
// MODULE     : Evaluation Scheme
// LAYER      : Service
// PURPOSE    : Every business rule governing an academic regulation — version
//              assignment, immutability, lifecycle transitions, referential
//              preconditions, atomicity and audit.
// ARCHITECTURE:
//   • Service contains ALL business logic.
//   • It owns transaction BOUNDARIES; the repository owns the Prisma handle.
//   • It maps records to DTOs. Nothing downstream reshapes them.
//   • It depends on repository PORTS, injected through the constructor, not on
//     concrete classes. Both port imports are `import type` and therefore
//     erased at compile time, so this module's runtime graph never reaches
//     lib/db/prisma — which is what makes it unit-testable with no database,
//     no DATABASE_URL and no network.
//
// THE INVARIANT THIS MODULE EXISTS TO HOLD
//   At most one ACTIVE revision per (tenantId, code). PostgreSQL cannot express
//   it without a partial unique index Prisma does not track, so it is held here
//   by the activation transaction. That transaction runs SERIALIZABLE because
//   the hazard is write skew, not row contention: two concurrent activations of
//   two different drafts touch two different rows and would otherwise both
//   observe "no active revision" and both commit. Under SERIALIZABLE PostgreSQL
//   aborts the second with a serialization failure, which surfaces as Prisma
//   P2034 and is mapped to 409 by handleRouteError.
// ============================================================================

import { EvaluationSchemeStatus, GradeScaleStatus } from "@/app/generated/prisma/enums";
import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import {
  EVALUATION_SCHEME_AUDIT_ACTION,
  EVALUATION_SCHEME_MESSAGE,
  EVALUATION_SCHEME_MUTABLE_STATUS,
  EVALUATION_SCHEME_RESOURCE,
  EVALUATION_SCHEME_TRANSITIONS,
  FIRST_VERSION,
} from "@/lib/constants/evaluationScheme";
import { EVALUATION_COMPONENT_MESSAGE } from "@/lib/constants/evaluationComponent";
import { validateComponentTree } from "@/lib/domain/evaluationComponentTree";
import type {
  AuditLogRepositoryPort,
  DbClient as AuditDbClient,
} from "@/lib/repositories/auditLog.repository";
import type { EvaluationComponentTreePort } from "@/lib/repositories/evaluationComponent.repository";
import type {
  DbClient,
  EvaluationSchemeDetailRecord,
  EvaluationSchemeRecord,
  EvaluationSchemeRepositoryPort,
  UpdateEvaluationSchemeData,
} from "@/lib/repositories/evaluationScheme.repository";
import type {
  EvaluationSchemeDetailDTO,
  EvaluationSchemeDTO,
  EvaluationSchemeListDTO,
} from "@/lib/dto/evaluationScheme.dto";
import type {
  CreateEvaluationSchemeInput,
  ListEvaluationSchemesQuery,
  UpdateEvaluationSchemeInput,
} from "@/lib/validations/evaluationScheme";
import type { RequestContext } from "@/lib/utils/request-context";

/**
 * SERIALIZABLE, named once.
 *
 * The literal rather than Prisma.TransactionIsolationLevel.Serializable so this
 * module needs no runtime import from the generated client; the value is
 * identical and the repository's signature types it.
 */
const SERIALIZABLE = "Serializable" as const;

/** Date -> ISO-8601, preserving null. The DTO's only temporal conversion. */
function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * Record -> DTO.
 *
 * Every Date becomes an ISO string here and nowhere else, so the wire contract
 * is this function rather than a property of whichever serializer runs later.
 */
function toDTO(record: EvaluationSchemeRecord): EvaluationSchemeDTO {
  return {
    id: record.id,
    tenantId: record.tenantId,
    code: record.code,
    name: record.name,
    description: record.description,
    version: record.version,
    status: record.status,
    gradeScaleId: record.gradeScaleId,
    attemptPolicy: record.attemptPolicy,
    marksRounding: record.marksRounding,
    marksPrecision: record.marksPrecision,
    gpaRounding: record.gpaRounding,
    gpaPrecision: record.gpaPrecision,
    supersededById: record.supersededById,
    activatedAt: toIso(record.activatedAt),
    activatedById: record.activatedById,
    archivedAt: toIso(record.archivedAt),
    createdById: record.createdById,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * Record -> detail DTO.
 *
 * maxGradePoint is a Prisma Decimal; .toString() is lossless where Number()
 * would not be, and it keeps the class instance out of the response type.
 */
function toDetailDTO(record: EvaluationSchemeDetailRecord): EvaluationSchemeDetailDTO {
  return {
    ...toDTO(record),
    gradeScale: {
      id: record.gradeScale.id,
      code: record.gradeScale.code,
      name: record.gradeScale.name,
      version: record.gradeScale.version,
      status: record.gradeScale.status,
      method: record.gradeScale.method,
      maxGradePoint: record.gradeScale.maxGradePoint.toString(),
    },
  };
}

/** 404 — the scheme does not exist, or belongs to another tenant. */
function schemeNotFound(): AppError {
  return new AppError(
    EVALUATION_SCHEME_MESSAGE.NOT_FOUND,
    HTTP_STATUS.NOT_FOUND,
    ERROR_CODE.NOT_FOUND
  );
}

/** 404 — the cited grade scale does not exist, or belongs to another tenant. */
function gradeScaleNotFound(): AppError {
  return new AppError(
    EVALUATION_SCHEME_MESSAGE.GRADE_SCALE_NOT_FOUND,
    HTTP_STATUS.NOT_FOUND,
    ERROR_CODE.NOT_FOUND
  );
}

/** 409 — the request is well-formed but the stored state forbids it. */
function conflict(message: string): AppError {
  return new AppError(message, HTTP_STATUS.CONFLICT, ERROR_CODE.CONFLICT);
}

export class EvaluationSchemeService {
  /**
   * `components` is a deliberately NARROW port — one read method.
   *
   * Activation must prove the regulation's assessment tree is coherent before
   * freezing it, which needs the components; but scheme activation has no
   * business creating, amending or deleting one. Injecting a single-method port
   * rather than the whole component repository makes that impossible to violate
   * later by accident.
   */
  constructor(
    private readonly schemes: EvaluationSchemeRepositoryPort,
    private readonly audit: AuditLogRepositoryPort,
    private readonly components: EvaluationComponentTreePort
  ) {}

  /**
   * One page of regulations.
   *
   * COMPLEXITY : two index-backed statements in one transaction, O(log n + k)
   *              for the page and O(matching) for the count. Mapping is O(k)
   *              time and O(k) space, bounded by the page size ceiling of 100
   *              in paginationQuerySchema — so a response can never be
   *              proportional to a tenant's total configuration.
   */
  async list(tenantId: string, query: ListEvaluationSchemesQuery): Promise<EvaluationSchemeListDTO> {
    const { page, limit, status, code, gradeScaleId } = query;

    const [records, total] = await this.schemes.listWithCount(
      tenantId,
      { status, code, gradeScaleId },
      (page - 1) * limit,
      limit
    );

    return {
      schemes: records.map(toDTO),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * One regulation with the grade scale it cites.
   *
   * COMPLEXITY : one joined query, O(log n). No second round trip for the
   *              scale — the N+1 this module is specified to avoid.
   */
  async getById(tenantId: string, id: string): Promise<EvaluationSchemeDetailDTO> {
    const record = await this.schemes.findDetailById(tenantId, id);

    if (record === null) {
      throw schemeNotFound();
    }

    return toDetailDTO(record);
  }

  /**
   * Draft a regulation, or a further revision of an existing one.
   *
   * RULES      : The cited grade scale must exist within the tenant. It need
   *              NOT be active yet — a draft regulation may be prepared against
   *              a draft vocabulary, and that pairing is only forbidden at
   *              activation, where activate() enforces it.
   *
   *              At most one DRAFT revision may exist per code. Without this a
   *              regulation would fan out into parallel unfinished revisions
   *              with no rule for which becomes v-next.
   *
   *              The version number is assigned here, never accepted: it is
   *              max(existing) + 1, or FIRST_VERSION when the code is new.
   *
   * CONCURRENCY: two concurrent creates of the same code compute the same next
   *              version and race. The loser violates
   *              @@unique([tenantId, code, version]) and Prisma raises P2002,
   *              which handleRouteError maps to 409. The database is the
   *              arbiter, so no isolation level is needed here — unlike
   *              activate(), whose hazard no constraint can express.
   *
   * COMPLEXITY : two reads and two writes, all O(log n). findVersionsByCode
   *              answers BOTH the draft check and the version arithmetic in one
   *              query rather than two, and its result is already sorted
   *              descending so the maximum is element zero — O(1), not a scan.
   */
  async create(
    tenantId: string,
    input: CreateEvaluationSchemeInput,
    context: RequestContext
  ): Promise<EvaluationSchemeDetailDTO> {
    return this.schemes.transaction(async (tx) => {
      const gradeScale = await this.schemes.findGradeScale(tenantId, input.gradeScaleId, tx);

      if (gradeScale === null) {
        throw gradeScaleNotFound();
      }

      const versions = await this.schemes.findVersionsByCode(tenantId, input.code, tx);

      if (versions.some((revision) => revision.status === EvaluationSchemeStatus.DRAFT)) {
        throw conflict(EVALUATION_SCHEME_MESSAGE.DRAFT_ALREADY_EXISTS);
      }

      const nextVersion = versions.length === 0 ? FIRST_VERSION : versions[0].version + 1;

      const created = await this.schemes.create(
        {
          tenantId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          version: nextVersion,
          gradeScaleId: input.gradeScaleId,
          attemptPolicy: input.attemptPolicy,
          marksRounding: input.marksRounding,
          marksPrecision: input.marksPrecision,
          gpaRounding: input.gpaRounding,
          gpaPrecision: input.gpaPrecision,
          createdById: context.actorId,
        },
        tx
      );

      const dto = toDetailDTO(created);

      await this.recordAudit(
        tenantId,
        EVALUATION_SCHEME_AUDIT_ACTION.CREATED,
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
   * Amend a draft regulation.
   *
   * RULES      : Only a DRAFT may be amended. An ACTIVE or ARCHIVED revision is
   *              frozen — that immutability is the entire basis of historical
   *              reproducibility, so it is refused rather than warned about.
   *
   *              A changed gradeScaleId is re-verified against the tenant. An
   *              UNCHANGED one is not: re-reading a scale the caller did not
   *              touch would be a duplicate query bought for nothing.
   *
   * COMPLEXITY : two reads (one conditional) and two writes, all O(log n).
   */
  async update(
    tenantId: string,
    id: string,
    input: UpdateEvaluationSchemeInput,
    context: RequestContext
  ): Promise<EvaluationSchemeDetailDTO> {
    return this.schemes.transaction(async (tx) => {
      const existing = await this.schemes.findById(tenantId, id, tx);

      if (existing === null) {
        throw schemeNotFound();
      }

      if (existing.status !== EVALUATION_SCHEME_MUTABLE_STATUS) {
        throw conflict(EVALUATION_SCHEME_MESSAGE.NOT_MUTABLE);
      }

      if (input.gradeScaleId !== undefined && input.gradeScaleId !== existing.gradeScaleId) {
        const gradeScale = await this.schemes.findGradeScale(tenantId, input.gradeScaleId, tx);

        if (gradeScale === null) {
          throw gradeScaleNotFound();
        }
      }

      const before = toDTO(existing);

      const updated = await this.schemes.update(tenantId, id, this.toUpdateData(input), tx);
      const dto = toDetailDTO(updated);

      await this.recordAudit(
        tenantId,
        EVALUATION_SCHEME_AUDIT_ACTION.UPDATED,
        id,
        context,
        tx,
        before,
        dto
      );

      return dto;
    });
  }

  /**
   * Activate a draft, superseding the revision it replaces.
   *
   * RULES      : DRAFT -> ACTIVE only. The cited grade scale must itself be
   *              ACTIVE: a regulation cannot grade against a vocabulary still
   *              being drafted, because that vocabulary's bands may still
   *              change and every result computed under it would stop being
   *              reproducible.
   *
   *              Any revision of the same code already ACTIVE is archived in
   *              the same transaction and its supersededById is set to the
   *              incoming revision — the version chain is written by this
   *              operation and by no other, because this is the only point at
   *              which "which replaced which" is known.
   *
   * ATOMICITY  : both updates and the audit entry share one transaction. A
   *              failure anywhere leaves the previous revision active and the
   *              draft still a draft; there is no window in which a tenant has
   *              zero active revisions or two.
   *
   * COMPLEXITY : two reads and two or three writes, all O(log n). findDetailById
   *              supplies the grade scale's status through its join, so the
   *              precondition costs no extra query.
   */
  async activate(
    tenantId: string,
    id: string,
    context: RequestContext
  ): Promise<EvaluationSchemeDetailDTO> {
    return this.schemes.transaction(
      async (tx) => {
        const scheme = await this.schemes.findDetailById(tenantId, id, tx);

        if (scheme === null) {
          throw schemeNotFound();
        }

        this.assertTransition(scheme.status, EvaluationSchemeStatus.ACTIVE);

        if (scheme.gradeScale.status !== GradeScaleStatus.ACTIVE) {
          throw conflict(EVALUATION_SCHEME_MESSAGE.GRADE_SCALE_NOT_ACTIVE);
        }

        // The assessment tree becomes binding at this instant and immutable
        // immediately afterwards, so this is the last moment its coherence can
        // be established. Every violation is reported at once, not just the
        // first, so a misconfigured regulation is fixed in one pass rather than
        // one activation attempt per mistake.
        const components = await this.components.findTreeBySchemeId(tenantId, scheme.id, tx);
        const violations = validateComponentTree(components);

        if (violations.length > 0) {
          throw new AppError(
            EVALUATION_COMPONENT_MESSAGE.TREE_INVALID,
            HTTP_STATUS.CONFLICT,
            ERROR_CODE.CONFLICT,
            violations.map((violation) => ({
              field: violation.field,
              message: violation.message,
            }))
          );
        }

        const before = toDetailDTO(scheme);
        const now = new Date();

        const current = await this.schemes.findActiveByCode(
          tenantId,
          scheme.code,
          EvaluationSchemeStatus.ACTIVE,
          tx
        );

        if (current !== null && current.id !== scheme.id) {
          await this.schemes.update(
            tenantId,
            current.id,
            {
              status: EvaluationSchemeStatus.ARCHIVED,
              archivedAt: now,
              supersededById: scheme.id,
            },
            tx
          );
        }

        const activated = await this.schemes.update(
          tenantId,
          id,
          {
            status: EvaluationSchemeStatus.ACTIVE,
            activatedAt: now,
            activatedById: context.actorId,
          },
          tx
        );

        const dto = toDetailDTO(activated);

        await this.recordAudit(
          tenantId,
          EVALUATION_SCHEME_AUDIT_ACTION.ACTIVATED,
          id,
          context,
          tx,
          before,
          dto
        );

        return dto;
      },
      { isolationLevel: SERIALIZABLE }
    );
  }

  /**
   * Retire an active regulation without a successor.
   *
   * RULES      : ACTIVE -> ARCHIVED only. supersededById is deliberately left
   *              null — nothing replaced this revision, and recording a
   *              successor that does not exist would corrupt the version chain.
   *              A retirement WITH a successor is an activation of the next
   *              draft, which archives this one as part of that operation.
   *
   * COMPLEXITY : one read and two writes, all O(log n).
   */
  async archive(
    tenantId: string,
    id: string,
    context: RequestContext
  ): Promise<EvaluationSchemeDetailDTO> {
    return this.schemes.transaction(async (tx) => {
      const scheme = await this.schemes.findDetailById(tenantId, id, tx);

      if (scheme === null) {
        throw schemeNotFound();
      }

      this.assertTransition(scheme.status, EvaluationSchemeStatus.ARCHIVED);

      const before = toDetailDTO(scheme);

      const archived = await this.schemes.update(
        tenantId,
        id,
        { status: EvaluationSchemeStatus.ARCHIVED, archivedAt: new Date() },
        tx
      );

      const dto = toDetailDTO(archived);

      await this.recordAudit(
        tenantId,
        EVALUATION_SCHEME_AUDIT_ACTION.ARCHIVED,
        id,
        context,
        tx,
        before,
        dto
      );

      return dto;
    });
  }

  /**
   * Discard a draft.
   *
   * RULES      : Only a DRAFT may be removed. An ACTIVE or ARCHIVED revision is
   *              part of the historical record and is never deleted — results
   *              computed under it must remain explicable forever. Archival is
   *              the correct retirement path.
   *
   *              The `before` snapshot is captured and audited, so a discarded
   *              draft leaves evidence of what it contained.
   *
   * COMPLEXITY : one read and two writes, all O(log n), plus the cascade to any
   *              components the draft owned.
   */
  async remove(tenantId: string, id: string, context: RequestContext): Promise<void> {
    await this.schemes.transaction(async (tx) => {
      const existing = await this.schemes.findById(tenantId, id, tx);

      if (existing === null) {
        throw schemeNotFound();
      }

      if (existing.status !== EVALUATION_SCHEME_MUTABLE_STATUS) {
        throw conflict(EVALUATION_SCHEME_MESSAGE.NOT_MUTABLE);
      }

      const before = toDTO(existing);

      await this.schemes.delete(tenantId, id, tx);

      await this.recordAudit(
        tenantId,
        EVALUATION_SCHEME_AUDIT_ACTION.DELETED,
        id,
        context,
        tx,
        before,
        undefined
      );
    });
  }

  /**
   * Reject a lifecycle move the state machine does not permit.
   *
   * Reads EVALUATION_SCHEME_TRANSITIONS rather than restating the rules, so the
   * machine is defined in exactly one place and the tests assert against that
   * same definition.
   */
  private assertTransition(from: EvaluationSchemeStatus, to: EvaluationSchemeStatus): void {
    if (!EVALUATION_SCHEME_TRANSITIONS[from].includes(to)) {
      throw conflict(EVALUATION_SCHEME_MESSAGE.INVALID_TRANSITION);
    }
  }

  /**
   * Narrow a validated PATCH body to the columns the repository may write.
   *
   * Explicit rather than a spread of `input`: a spread would forward whatever
   * the schema happens to admit today, so a field added to the validator would
   * silently become writable here. Listing the columns means widening the write
   * surface is always a deliberate edit to this method.
   */
  private toUpdateData(input: UpdateEvaluationSchemeInput): UpdateEvaluationSchemeData {
    return {
      name: input.name,
      description: input.description,
      gradeScaleId: input.gradeScaleId,
      attemptPolicy: input.attemptPolicy,
      marksRounding: input.marksRounding,
      marksPrecision: input.marksPrecision,
      gpaRounding: input.gpaRounding,
      gpaPrecision: input.gpaPrecision,
    };
  }

  /**
   * Write one audit entry inside the caller's transaction.
   *
   * Private and parameterised so the resource name, the actor and the request
   * origin are assembled once rather than at each of the five call sites.
   */
  private async recordAudit(
    tenantId: string,
    action: string,
    resourceId: string,
    context: RequestContext,
    tx: DbClient,
    before: EvaluationSchemeDTO | undefined,
    after: EvaluationSchemeDTO | undefined
  ): Promise<void> {
    await this.audit.record(
      {
        tenantId,
        userId: context.actorId,
        action,
        resource: EVALUATION_SCHEME_RESOURCE,
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
