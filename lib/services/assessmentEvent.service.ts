// ============================================================================
// OWNER      : Gauransh
// MODULE     : Assessment Event
// LAYER      : Service
// PURPOSE    : Every business rule governing a sitting — reference validation,
//              scheme activation, sitting-number assignment, maxMarks
//              defaulting, edit windows, the lifecycle state machine,
//              atomicity and audit.
// ARCHITECTURE:
//   • Service contains ALL business logic.
//   • It owns transaction BOUNDARIES; the repository owns the Prisma handle.
//   • All three dependencies arrive as constructor PORTS imported with
//     `import type`, so this module's runtime graph never reaches
//     lib/db/prisma and it unit-tests with no database.
//
// THE QUERY BUDGET
//   create        : component + course + semester + (section) + (faculty)
//                   + max-sequence + insert + audit            → 6–8
//   update        : event + (faculty) + update + audit         → 3–4
//   changeStatus  : event + update + audit                     → 3
//   list          : 2 (paired in one transaction)
//   getById       : 1
//
//   The sitting number comes from an AGGREGATE rather than from loading the
//   sibling rows: the service needs one integer, and computing a maximum in
//   Node would move work the database does with an index scan.
//
// WHY NO SERIALIZABLE ISOLATION
//   Two concurrent creates for the same component, course, term and group both
//   read the same maximum and compute the same next number. The loser violates
//   @@unique([evaluationComponentId, courseId, semesterId, sectionId,
//   sequenceNumber]) and Prisma raises P2002, which handleRouteError maps to
//   409. The database is the arbiter, so an isolation level would buy nothing
//   the constraint does not already guarantee.
//
//   The one gap is a COHORT-WIDE sitting, where sectionId is null and
//   PostgreSQL treats NULLs as distinct — two could take the same number. That
//   is cosmetic rather than corrupting: list order ends on `id`, so the calendar
//   stays deterministic, and the aggregation reads the set rather than the
//   numbering.
// ============================================================================

import { AssessmentEventStatus, EvaluationSchemeStatus } from "@/app/generated/prisma/enums";
import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import {
  ASSESSMENT_EVENT_AUDIT_ACTION,
  ASSESSMENT_EVENT_MESSAGE,
  ASSESSMENT_EVENT_RESOURCE,
  ASSESSMENT_EVENT_TRANSITIONS,
  EDITABLE_STATUSES,
  FIRST_SEQUENCE,
  MARK_ENTRY_STATUS,
  MAX_SEQUENCE,
  PUBLISHED_STATUSES,
} from "@/lib/constants/assessmentEvent";
import type {
  AuditLogRepositoryPort,
  DbClient as AuditDbClient,
} from "@/lib/repositories/auditLog.repository";
import type {
  AssessmentEventRecord,
  AssessmentEventRepositoryPort,
  DbClient,
} from "@/lib/repositories/assessmentEvent.repository";
import type { EvaluationSchemeLifecyclePort } from "@/lib/repositories/evaluationConfig.ports";
import type {
  AssessmentEventDTO,
  AssessmentEventListDTO,
} from "@/lib/dto/assessmentEvent.dto";
import type {
  AssessmentEventStatusInput,
  CreateAssessmentEventInput,
  ListAssessmentEventsQuery,
  UpdateAssessmentEventInput,
} from "@/lib/validations/assessmentEvent";
import type { RequestContext } from "@/lib/utils/request-context";

/** Statuses in which a sitting's marks are visible, as a Set for O(1) lookup. */
const PUBLISHED_SET = new Set<AssessmentEventStatus>(PUBLISHED_STATUSES);

/** Statuses in which the sitting's own definition may be amended. */
const EDITABLE_SET = new Set<AssessmentEventStatus>(EDITABLE_STATUSES);

/** 404 — the sitting does not exist, or belongs to another tenant. */
function eventNotFound(): AppError {
  return new AppError(
    ASSESSMENT_EVENT_MESSAGE.NOT_FOUND,
    HTTP_STATUS.NOT_FOUND,
    ERROR_CODE.NOT_FOUND
  );
}

/** 404 — a referenced row does not exist within this tenant. */
function referenceNotFound(message: string): AppError {
  return new AppError(message, HTTP_STATUS.NOT_FOUND, ERROR_CODE.NOT_FOUND);
}

/** 409 — the request is well-formed but the stored state forbids it. */
function conflict(message: string): AppError {
  return new AppError(message, HTTP_STATUS.CONFLICT, ERROR_CODE.CONFLICT);
}

/**
 * Record -> DTO.
 *
 * The three booleans are DERIVED from the status rather than read from columns.
 * Each answers a question a client asks on every render, and each is already
 * settled by the status enum, so a stored flag would be a second source of
 * truth able to disagree with the state it describes.
 *
 * `acceptsMarks` in particular is the whole of what "locking" means: there is
 * no separate lock mechanism, only this predicate.
 */
function toDTO(record: AssessmentEventRecord): AssessmentEventDTO {
  return {
    id: record.id,
    tenantId: record.tenantId,
    evaluationComponentId: record.evaluationComponentId,
    courseId: record.courseId,
    semesterId: record.semesterId,
    sectionId: record.sectionId,
    title: record.title,
    maxMarks: record.maxMarks.toString(),
    sequenceNumber: record.sequenceNumber,
    scheduledAt: record.scheduledAt === null ? null : record.scheduledAt.toISOString(),
    conductedById: record.conductedById,
    status: record.status,
    statusChangedAt: record.statusChangedAt.toISOString(),
    acceptsMarks: record.status === MARK_ENTRY_STATUS,
    isPublished: PUBLISHED_SET.has(record.status),
    isEditable: EDITABLE_SET.has(record.status),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export class AssessmentEventService {
  constructor(
    private readonly events: AssessmentEventRepositoryPort,
    private readonly audit: AuditLogRepositoryPort,
    private readonly schemes: EvaluationSchemeLifecyclePort
  ) {}

  /**
   * One page of sittings.
   *
   * COMPLEXITY : two index-backed statements in one transaction, then O(k)
   *              mapping bounded by the page-size ceiling of 100.
   */
  async list(
    tenantId: string,
    query: ListAssessmentEventsQuery
  ): Promise<AssessmentEventListDTO> {
    const { page, limit, ...filter } = query;

    const [records, total] = await this.events.listWithCount(
      tenantId,
      filter,
      (page - 1) * limit,
      limit
    );

    return {
      events: records.map(toDTO),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * One sitting.
   *
   * COMPLEXITY : one query, O(log n).
   */
  async getById(tenantId: string, id: string): Promise<AssessmentEventDTO> {
    const record = await this.events.findById(tenantId, id);

    if (record === null) {
      throw eventNotFound();
    }

    return toDTO(record);
  }

  /**
   * Schedule a sitting.
   *
   * RULES      : Every reference is resolved TENANT-SCOPED, so a sitting can
   *              never be created against another tenant's component, course,
   *              section or lecturer.
   *
   *              The component's SCHEME must be ACTIVE. Marks assessed under a
   *              still-editable draft regulation would be graded by rules that
   *              could change afterwards, which is precisely what the phase's
   *              immutability guarantees exist to prevent. An ARCHIVED
   *              regulation is no longer in force.
   *
   *              maxMarks defaults to the component's own scale, which is the
   *              common case and one a caller should not have to restate. A
   *              supplied value means the paper was set out of a different
   *              total — an ordinary arrangement, reconciled by a SCALE rule.
   *
   *              The sitting number is assigned, never accepted: a client able
   *              to choose it could hide a sitting from a BEST_N aggregation.
   *
   * COMPLEXITY : six to eight statements, all O(log n). The sitting number
   *              comes from an aggregate rather than from loading siblings.
   */
  async create(
    tenantId: string,
    input: CreateAssessmentEventInput,
    context: RequestContext
  ): Promise<AssessmentEventDTO> {
    return this.events.transaction(async (tx) => {
      // Resolved by id alone, not scheme-scoped: a sitting does not know the
      // regulation yet — the component is what tells it.
      const component = await this.events.findComponent(
        tenantId,
        input.evaluationComponentId,
        tx
      );

      if (component === null) {
        throw referenceNotFound(ASSESSMENT_EVENT_MESSAGE.COMPONENT_NOT_FOUND);
      }

      await this.assertSchemeActive(tenantId, component.schemeId, tx);
      await this.assertReferences(tenantId, input, tx);

      const sectionId = input.sectionId ?? null;

      const maxSequence = await this.events.findMaxSequence(
        tenantId,
        input.evaluationComponentId,
        input.courseId,
        input.semesterId,
        sectionId,
        tx
      );

      const sequenceNumber = maxSequence === null ? FIRST_SEQUENCE : maxSequence + 1;

      if (sequenceNumber > MAX_SEQUENCE) {
        throw conflict(ASSESSMENT_EVENT_MESSAGE.SEQUENCE_EXHAUSTED);
      }

      const created = await this.events.create(
        {
          tenantId,
          evaluationComponentId: input.evaluationComponentId,
          courseId: input.courseId,
          semesterId: input.semesterId,
          sectionId,
          title: input.title,
          // Defaulted from the component, not from the caller, whenever the
          // caller stays silent.
          maxMarks: input.maxMarks ?? Number(component.maxMarks),
          sequenceNumber,
          scheduledAt: input.scheduledAt ?? null,
          conductedById: input.conductedById ?? null,
        },
        tx
      );

      const dto = toDTO(created);

      await this.recordAudit(
        tenantId,
        ASSESSMENT_EVENT_AUDIT_ACTION.CREATED,
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
   * Amend a sitting's own description.
   *
   * RULES      : Only while the sitting is still a DRAFT. Once entry has
   *              opened, changing what the paper was marked out of would
   *              silently revalue every mark already recorded against it — a
   *              correction that looks like a clerical edit and behaves like a
   *              regrade.
   *
   *              The references are absent from the update schema and therefore
   *              unreachable: moving a sitting to a different component, course
   *              or term would reattribute its marks.
   *
   * COMPLEXITY : three or four statements, all O(log n).
   */
  async update(
    tenantId: string,
    id: string,
    input: UpdateAssessmentEventInput,
    context: RequestContext
  ): Promise<AssessmentEventDTO> {
    return this.events.transaction(async (tx) => {
      const existing = await this.events.findById(tenantId, id, tx);

      if (existing === null) {
        throw eventNotFound();
      }

      if (!EDITABLE_SET.has(existing.status)) {
        throw conflict(ASSESSMENT_EVENT_MESSAGE.NOT_EDITABLE);
      }

      if (input.conductedById !== undefined && input.conductedById !== null) {
        const faculty = await this.events.findFaculty(tenantId, input.conductedById, tx);

        if (faculty === null) {
          throw referenceNotFound(ASSESSMENT_EVENT_MESSAGE.FACULTY_NOT_FOUND);
        }
      }

      const before = toDTO(existing);

      const updated = await this.events.update(
        tenantId,
        id,
        {
          title: input.title,
          maxMarks: input.maxMarks,
          scheduledAt: input.scheduledAt,
          conductedById: input.conductedById,
        },
        tx
      );

      const dto = toDTO(updated);

      await this.recordAudit(
        tenantId,
        ASSESSMENT_EVENT_AUDIT_ACTION.UPDATED,
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
   * Move a sitting through its lifecycle.
   *
   * RULES      : The transition must be one the state machine permits. Opening
   *              admits marks; locking freezes them; publishing reveals them.
   *              OPEN -> PUBLISHED is deliberately absent, so nothing reaches a
   *              student without someone having closed entry first.
   *
   *              LOCKED -> OPEN and PUBLISHED -> LOCKED run backwards on
   *              purpose: a lifecycle with no correction path is the defect
   *              recorded as TD-C40, where an accidental revocation could only
   *              be undone through direct database access.
   *
   *              Re-requesting the CURRENT status is refused rather than
   *              silently accepted — the state machine lists no self-transition,
   *              and a no-op that reports success would let a caller believe a
   *              publication happened when it did not.
   *
   * COMPLEXITY : three statements, all O(log n).
   */
  async changeStatus(
    tenantId: string,
    id: string,
    input: AssessmentEventStatusInput,
    context: RequestContext
  ): Promise<AssessmentEventDTO> {
    return this.events.transaction(async (tx) => {
      const existing = await this.events.findById(tenantId, id, tx);

      if (existing === null) {
        throw eventNotFound();
      }

      this.assertTransition(existing.status, input.status);

      const before = toDTO(existing);

      const updated = await this.events.update(
        tenantId,
        id,
        { status: input.status, statusChangedAt: new Date() },
        tx
      );

      const dto = toDTO(updated);

      await this.recordAudit(
        tenantId,
        ASSESSMENT_EVENT_AUDIT_ACTION.STATUS_CHANGED,
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
   * The component's regulation must be in force.
   *
   * Read through the scheme port rather than the component's own row, because
   * only the scheme carries a status. This is the single check that stops marks
   * being assessed under rules that can still change.
   */
  private async assertSchemeActive(
    tenantId: string,
    schemeId: string,
    tx: DbClient
  ): Promise<void> {
    const scheme = await this.schemes.findById(tenantId, schemeId, tx);

    if (scheme === null || scheme.status !== EvaluationSchemeStatus.ACTIVE) {
      throw conflict(ASSESSMENT_EVENT_MESSAGE.SCHEME_NOT_ACTIVE);
    }
  }

  /**
   * Resolve the course, term, group and lecturer, all tenant-scoped.
   *
   * Sequential rather than concurrent: these run inside one interactive
   * transaction, which is a single connection, so issuing them in parallel
   * would serialise anyway while making the failure order non-deterministic.
   */
  private async assertReferences(
    tenantId: string,
    input: {
      courseId: string;
      semesterId: string;
      sectionId?: string | null;
      conductedById?: string | null;
    },
    tx: DbClient
  ): Promise<void> {
    const course = await this.events.findCourse(tenantId, input.courseId, tx);

    if (course === null) {
      throw referenceNotFound(ASSESSMENT_EVENT_MESSAGE.COURSE_NOT_FOUND);
    }

    const semester = await this.events.findSemester(tenantId, input.semesterId, tx);

    if (semester === null) {
      throw referenceNotFound(ASSESSMENT_EVENT_MESSAGE.SEMESTER_NOT_FOUND);
    }

    if (input.sectionId !== undefined && input.sectionId !== null) {
      const section = await this.events.findSection(tenantId, input.sectionId, tx);

      if (section === null) {
        throw referenceNotFound(ASSESSMENT_EVENT_MESSAGE.SECTION_NOT_FOUND);
      }
    }

    if (input.conductedById !== undefined && input.conductedById !== null) {
      const faculty = await this.events.findFaculty(tenantId, input.conductedById, tx);

      if (faculty === null) {
        throw referenceNotFound(ASSESSMENT_EVENT_MESSAGE.FACULTY_NOT_FOUND);
      }
    }
  }

  /**
   * Reject a lifecycle move the state machine does not permit.
   *
   * Reads ASSESSMENT_EVENT_TRANSITIONS rather than restating the rules, so the
   * machine is defined in exactly one place and the tests assert against that
   * same definition.
   */
  private assertTransition(
    from: AssessmentEventStatus,
    to: AssessmentEventStatus
  ): void {
    if (!ASSESSMENT_EVENT_TRANSITIONS[from].includes(to)) {
      throw conflict(ASSESSMENT_EVENT_MESSAGE.INVALID_TRANSITION);
    }
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
        resource: ASSESSMENT_EVENT_RESOURCE,
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
