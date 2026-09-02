// ============================================================================
// OWNER      : Gauransh
// MODULE     : Course Registration
// LAYER      : Service
// PURPOSE    : Every academic rule governing enrolment — reference validation,
//              scheme activation, snapshot capture, attempt assignment,
//              attempt/type coherence, the lifecycle state machine, atomicity
//              and audit.
// ARCHITECTURE:
//   • Service contains ALL business logic.
//   • It owns transaction BOUNDARIES; the repository owns the Prisma handle.
//   • Both dependencies arrive as constructor PORTS imported with
//     `import type`, so this module's runtime graph never reaches
//     lib/db/prisma and it unit-tests with no database.
//
// THE QUERY BUDGET — and why bulk is the one that matters
//   register : student + course + semester + (section) + scheme + attempts
//              + insert + audit                                    → 7–8
//   bulk     : course + semester + (section) + scheme + students
//              + attempts + createMany + audit                     → 6–8
//              ...for ANY batch size up to 500.
//
//   That is the whole point of the bulk path. The references are resolved ONCE
//   for the cohort rather than once per student, every student is validated in
//   a single findStudents, every prior attempt across the batch comes back in a
//   single findAttempts, and the insert is one createMany. Registering 500
//   students costs the same number of round trips as registering one.
//
// WHY NO SERIALIZABLE ISOLATION
//   The invariant at risk is "at most one ACTIVE enrolment per (student,
//   course)". Two concurrent registrations for the same student and course both
//   compute the same next attempt number, and the loser violates
//   @@unique([studentId, courseId, attemptNumber]) — Prisma raises P2002, which
//   handleRouteError maps to 409. The database is the arbiter, so an isolation
//   level would buy nothing the constraint does not already guarantee.
// ============================================================================

import { RegistrationStatus, RegistrationType } from "@/app/generated/prisma/enums";
import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import { EvaluationSchemeStatus } from "@/app/generated/prisma/enums";
import {
  ACTIVE_REGISTRATION_STATUSES,
  BULK_SKIP_REASON,
  COURSE_REGISTRATION_AUDIT_ACTION,
  COURSE_REGISTRATION_MESSAGE,
  COURSE_REGISTRATION_RESOURCE,
  FIRST_ATTEMPT,
  FIRST_ATTEMPT_TYPES,
  NON_CREDIT_TYPES,
  REATTEMPT_TYPES,
  REGISTRATION_TRANSITIONS,
} from "@/lib/constants/courseRegistration";
import type {
  AuditLogRepositoryPort,
  DbClient as AuditDbClient,
} from "@/lib/repositories/auditLog.repository";
import type {
  AttemptRecord,
  CourseRegistrationRecord,
  CourseRegistrationRepositoryPort,
  CreateCourseRegistrationData,
  DbClient,
  StudentReferenceRecord,
} from "@/lib/repositories/courseRegistration.repository";
import type { EvaluationSchemeLifecyclePort } from "@/lib/repositories/evaluationConfig.ports";
import type {
  BulkRegistrationResultDTO,
  BulkRegistrationSkipDTO,
  CourseRegistrationDTO,
  CourseRegistrationListDTO,
} from "@/lib/dto/courseRegistration.dto";
import type {
  BulkCourseRegistrationInput,
  CreateCourseRegistrationInput,
  ListCourseRegistrationsQuery,
  UpdateCourseRegistrationInput,
} from "@/lib/validations/courseRegistration";
import type { RequestContext } from "@/lib/utils/request-context";

/** Statuses in which an enrolment is live, as a Set for O(1) membership. */
const ACTIVE_STATUS_SET = new Set<RegistrationStatus>(ACTIVE_REGISTRATION_STATUSES);

/** Types carrying no credit, as a Set for O(1) membership. */
const NON_CREDIT_SET = new Set<RegistrationType>(NON_CREDIT_TYPES);

/** 404 — the registration does not exist, or belongs to another tenant. */
function registrationNotFound(): AppError {
  return new AppError(
    COURSE_REGISTRATION_MESSAGE.NOT_FOUND,
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

/** 400 — the request contradicts an academic rule. */
function invalid(message: string): AppError {
  return new AppError(message, HTTP_STATUS.BAD_REQUEST, ERROR_CODE.VALIDATION);
}

/**
 * Record -> DTO.
 *
 * `isActive` and `countsForCredit` are DERIVED from the status and the type
 * rather than read from columns. Both are consulted constantly — a roster is
 * the active enrolments, SGPA weights only the credit-bearing ones — and both
 * are already settled by the enum they derive from, so a stored flag would be a
 * second source of truth able to disagree.
 *
 * `credits` is a Prisma Decimal; .toString() is lossless where Number() would
 * not be in the general case, and it keeps the class instance out of the
 * response type.
 */
function toDTO(record: CourseRegistrationRecord): CourseRegistrationDTO {
  return {
    id: record.id,
    tenantId: record.tenantId,
    studentId: record.studentId,
    courseId: record.courseId,
    semesterId: record.semesterId,
    sectionId: record.sectionId,
    programmeId: record.programmeId,
    evaluationSchemeId: record.evaluationSchemeId,
    credits: record.credits.toString(),
    registrationType: record.registrationType,
    attemptNumber: record.attemptNumber,
    status: record.status,
    statusChangedAt: record.statusChangedAt.toISOString(),
    isActive: ACTIVE_STATUS_SET.has(record.status),
    countsForCredit: !NON_CREDIT_SET.has(record.registrationType),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** The prior-attempt summary for one student at one course. */
interface AttemptSummary {
  nextAttempt: number;
  hasActive: boolean;
}

/**
 * Fold a flat attempt list into a per-student summary.
 *
 * ONE pass over the whole batch's attempts, producing both answers the service
 * needs — what number comes next, and whether an enrolment is already live.
 * Computing them separately would be two traversals of the same array for facts
 * that fall out of the same visit.
 *
 * COMPLEXITY : O(a) time and O(s) space for a attempts across s students.
 */
function summariseAttempts(attempts: readonly AttemptRecord[]): Map<string, AttemptSummary> {
  const summary = new Map<string, AttemptSummary>();

  for (const attempt of attempts) {
    const current = summary.get(attempt.studentId) ?? { nextAttempt: FIRST_ATTEMPT, hasActive: false };

    summary.set(attempt.studentId, {
      nextAttempt: Math.max(current.nextAttempt, attempt.attemptNumber + 1),
      hasActive: current.hasActive || ACTIVE_STATUS_SET.has(attempt.status),
    });
  }

  return summary;
}

export class CourseRegistrationService {
  constructor(
    private readonly registrations: CourseRegistrationRepositoryPort,
    private readonly audit: AuditLogRepositoryPort,
    private readonly schemes: EvaluationSchemeLifecyclePort
  ) {}

  /**
   * One page of registrations.
   *
   * COMPLEXITY : two index-backed statements in one transaction, then O(k)
   *              mapping bounded by the page-size ceiling of 100 — so a
   *              response can never be proportional to a tenant's enrolment
   *              volume.
   */
  async list(
    tenantId: string,
    query: ListCourseRegistrationsQuery,
    departmentId: string | null = null
  ): Promise<CourseRegistrationListDTO> {
    const { page, limit, ...filter } = query;

    const [records, total] = await this.registrations.listWithCount(
      tenantId,
      filter,
      (page - 1) * limit,
      limit,
      departmentId
    );

    return {
      registrations: records.map(toDTO),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * One registration.
   *
   * COMPLEXITY : one query, O(log n).
   */
  async getById(
    tenantId: string,
    id: string,
    departmentId: string | null = null
  ): Promise<CourseRegistrationDTO> {
    const record = await this.registrations.findById(tenantId, id);

    if (record === null) {
      throw registrationNotFound();
    }

    // REGISTRATION_READ_ROLES admits DEPARTMENT_HOD, so an enrolment against
    // another department's course must not be readable. The refusal is the
    // same not-found an unknown id gets: the shape of the error must not
    // confirm that an enrolment with this id exists elsewhere in the tenant.
    if (
      departmentId !== null &&
      !(await this.registrations.courseBelongsToDepartment(
        tenantId,
        record.courseId,
        departmentId
      ))
    ) {
      throw registrationNotFound();
    }

    return toDTO(record);
  }

  /**
   * The active roster for a course in a term.
   *
   * Exposed as a first-class read because it is the contract every downstream
   * engine consumes INSTEAD of deriving a roster from Student.sectionId. It
   * returns registration ids, not student ids, because a mark must cite the
   * enrolment — that is what carries the attempt number and the governing
   * regulation.
   *
   * COMPLEXITY : one query, O(log n + r) for a class of r.
   */
  async getRoster(
    tenantId: string,
    courseId: string,
    semesterId: string,
    sectionId?: string
  ): Promise<Awaited<ReturnType<CourseRegistrationRepositoryPort["findRoster"]>>> {
    return this.registrations.findRoster(
      tenantId,
      courseId,
      semesterId,
      ACTIVE_REGISTRATION_STATUSES,
      sectionId
    );
  }

  /**
   * Register one student for one course.
   *
   * RULES      : Every reference is resolved TENANT-SCOPED — student, course,
   *              semester, optional section and evaluation scheme — so a
   *              registration can never be created against another tenant's
   *              row, and an unknown id and a foreign one answer identically.
   *
   *              The scheme must be ACTIVE. A DRAFT regulation is still
   *              editable, so grading against one would make the result
   *              irreproducible the moment it changed; an ARCHIVED one is no
   *              longer in force.
   *
   *              Credits and the programme are SNAPSHOTTED here. Course.credits
   *              is mutable and Student.programmeId is overwritten on transfer,
   *              so both are unrecoverable later.
   *
   *              The attempt number is assigned, never accepted, and the
   *              type must agree with it — a first sitting cannot be a backlog,
   *              and a re-sit cannot be REGULAR.
   *
   * COMPLEXITY : seven or eight statements, all O(log n).
   */
  async register(
    tenantId: string,
    input: CreateCourseRegistrationInput,
    context: RequestContext
  ): Promise<CourseRegistrationDTO> {
    return this.registrations.transaction(async (tx) => {
      const student = await this.registrations.findStudent(tenantId, input.studentId, tx);

      if (student === null) {
        throw referenceNotFound(COURSE_REGISTRATION_MESSAGE.STUDENT_NOT_FOUND);
      }

      const { credits } = await this.resolveSharedReferences(tenantId, input, tx);

      const attempts = await this.registrations.findAttempts(
        tenantId,
        input.courseId,
        [input.studentId],
        tx
      );

      const summary = summariseAttempts(attempts).get(input.studentId);

      if (summary?.hasActive === true) {
        throw conflict(COURSE_REGISTRATION_MESSAGE.ALREADY_REGISTERED);
      }

      const attemptNumber = summary?.nextAttempt ?? FIRST_ATTEMPT;
      const registrationType = input.registrationType ?? RegistrationType.REGULAR;

      this.assertAttemptTypeCoherent(attemptNumber, registrationType);

      const created = await this.registrations.create(
        this.buildRow(tenantId, input, student, credits, registrationType, attemptNumber),
        tx
      );

      const dto = toDTO(created);

      await this.recordAudit(
        tenantId,
        COURSE_REGISTRATION_AUDIT_ACTION.REGISTERED,
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
   * Register a whole cohort against one course.
   *
   * RULES      : Identical to register(), applied to every member — but the
   *              shared references are resolved ONCE and every student's
   *              existence, programme and attempt history arrives in two
   *              queries rather than 2n.
   *
   *              A student who already holds an active enrolment is SKIPPED,
   *              not rejected. Registering a section when a handful are already
   *              enrolled is the ordinary case, and failing the batch would
   *              force the caller to diff the roster by hand. A student who
   *              does not exist in the tenant, by contrast, is a 404 for the
   *              whole batch: that is a caller error, not an expected overlap.
   *
   *              A batch with nothing left to insert is not an error — it is a
   *              successful no-op reporting every skip, so a re-run of the same
   *              request is idempotent.
   *
   * COMPLEXITY : six to eight statements for ANY batch size. In memory, O(n)
   *              over the batch and O(a) over prior attempts; no nested loop,
   *              because the attempt summary is a Map keyed by student.
   */
  async registerBulk(
    tenantId: string,
    input: BulkCourseRegistrationInput,
    context: RequestContext
  ): Promise<BulkRegistrationResultDTO> {
    return this.registrations.transaction(async (tx) => {
      const { credits } = await this.resolveSharedReferences(tenantId, input, tx);

      const students = await this.registrations.findStudents(tenantId, input.studentIds, tx);

      if (students.length !== input.studentIds.length) {
        throw referenceNotFound(COURSE_REGISTRATION_MESSAGE.STUDENT_NOT_FOUND);
      }

      const studentById = new Map(students.map((student) => [student.id, student]));

      const attempts = await this.registrations.findAttempts(
        tenantId,
        input.courseId,
        input.studentIds,
        tx
      );
      const summaries = summariseAttempts(attempts);

      const registrationType = input.registrationType ?? RegistrationType.REGULAR;
      const rows: CreateCourseRegistrationData[] = [];
      const skipped: BulkRegistrationSkipDTO[] = [];

      for (const studentId of input.studentIds) {
        const summary = summaries.get(studentId);

        if (summary?.hasActive === true) {
          skipped.push({ studentId, reason: BULK_SKIP_REASON.ALREADY_REGISTERED });
          continue;
        }

        const attemptNumber = summary?.nextAttempt ?? FIRST_ATTEMPT;

        this.assertAttemptTypeCoherent(attemptNumber, registrationType);

        // Present by construction: findStudents returned every requested id, or
        // the length check above would have thrown.
        const student = studentById.get(studentId) as StudentReferenceRecord;

        rows.push(
          this.buildRow(
            tenantId,
            { ...input, studentId },
            student,
            credits,
            registrationType,
            attemptNumber
          )
        );
      }

      const registeredCount =
        rows.length === 0 ? 0 : await this.registrations.createMany(rows, tx);

      const result: BulkRegistrationResultDTO = {
        courseId: input.courseId,
        semesterId: input.semesterId,
        requestedCount: input.studentIds.length,
        registeredCount,
        skipped,
      };

      // One audit entry for the batch, not one per student. A five-hundred-row
      // batch is a single administrative act, and five hundred entries would
      // bury the act that caused them.
      await this.recordAudit(
        tenantId,
        COURSE_REGISTRATION_AUDIT_ACTION.BULK_REGISTERED,
        input.courseId,
        context,
        tx,
        undefined,
        result
      );

      return result;
    });
  }

  /**
   * Amend the two mutable properties of an enrolment.
   *
   * RULES      : Only the teaching section and the lifecycle status may change.
   *              Student, course, semester, programme, credits, scheme and
   *              attempt number are absent from the update schema and therefore
   *              unreachable — they are the immutable academic facts this model
   *              exists to preserve.
   *
   *              A status change is checked against the state machine. Every
   *              terminal state has no successors: reviving a withdrawn or
   *              completed enrolment would silently change what a past roster
   *              contained.
   *
   *              statusChangedAt is stamped by the service only when the status
   *              actually moves, so a section reallocation does not falsify
   *              when the student withdrew.
   *
   * COMPLEXITY : three or four statements, all O(log n).
   */
  async update(
    tenantId: string,
    id: string,
    input: UpdateCourseRegistrationInput,
    context: RequestContext
  ): Promise<CourseRegistrationDTO> {
    return this.registrations.transaction(async (tx) => {
      const existing = await this.registrations.findById(tenantId, id, tx);

      if (existing === null) {
        throw registrationNotFound();
      }

      if (input.sectionId !== undefined && input.sectionId !== null) {
        const section = await this.registrations.findSection(tenantId, input.sectionId, tx);

        if (section === null) {
          throw referenceNotFound(COURSE_REGISTRATION_MESSAGE.SECTION_NOT_FOUND);
        }
      }

      const statusChanged = input.status !== undefined && input.status !== existing.status;

      if (statusChanged && input.status !== undefined) {
        this.assertTransition(existing.status, input.status);
      }

      const before = toDTO(existing);

      const updated = await this.registrations.update(
        tenantId,
        id,
        {
          sectionId: input.sectionId,
          status: input.status,
          ...(statusChanged ? { statusChangedAt: new Date() } : {}),
        },
        tx
      );

      const dto = toDTO(updated);

      await this.recordAudit(
        tenantId,
        COURSE_REGISTRATION_AUDIT_ACTION.UPDATED,
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
   * Resolve and validate the references a batch shares.
   *
   * Extracted so the single and bulk paths validate identically, and so the
   * bulk path pays for them ONCE rather than once per student. Returns the one
   * value the caller needs afterwards — the credits to snapshot.
   */
  private async resolveSharedReferences(
    tenantId: string,
    input: {
      courseId: string;
      semesterId: string;
      sectionId?: string | null;
      evaluationSchemeId: string;
    },
    tx: DbClient
  ): Promise<{ credits: number }> {
    const course = await this.registrations.findCourse(tenantId, input.courseId, tx);

    if (course === null) {
      throw referenceNotFound(COURSE_REGISTRATION_MESSAGE.COURSE_NOT_FOUND);
    }

    const semester = await this.registrations.findSemester(tenantId, input.semesterId, tx);

    if (semester === null) {
      throw referenceNotFound(COURSE_REGISTRATION_MESSAGE.SEMESTER_NOT_FOUND);
    }

    if (input.sectionId !== undefined && input.sectionId !== null) {
      const section = await this.registrations.findSection(tenantId, input.sectionId, tx);

      if (section === null) {
        throw referenceNotFound(COURSE_REGISTRATION_MESSAGE.SECTION_NOT_FOUND);
      }
    }

    const scheme = await this.schemes.findById(tenantId, input.evaluationSchemeId, tx);

    if (scheme === null) {
      throw referenceNotFound(COURSE_REGISTRATION_MESSAGE.SCHEME_NOT_FOUND);
    }

    if (scheme.status !== EvaluationSchemeStatus.ACTIVE) {
      throw conflict(COURSE_REGISTRATION_MESSAGE.SCHEME_NOT_ACTIVE);
    }

    return { credits: course.credits };
  }

  /** Assemble the row, capturing every snapshot in one place. */
  private buildRow(
    tenantId: string,
    input: {
      studentId: string;
      courseId: string;
      semesterId: string;
      sectionId?: string | null;
      evaluationSchemeId: string;
    },
    student: StudentReferenceRecord,
    credits: number,
    registrationType: RegistrationType,
    attemptNumber: number
  ): CreateCourseRegistrationData {
    return {
      tenantId,
      studentId: input.studentId,
      courseId: input.courseId,
      semesterId: input.semesterId,
      sectionId: input.sectionId ?? null,
      // Snapshotted from the student, not accepted from the caller: this is the
      // programme the credit is earned toward, and it is unrecoverable once the
      // student transfers.
      programmeId: student.programmeId,
      evaluationSchemeId: input.evaluationSchemeId,
      // Snapshotted from the course, not accepted from the caller: a client able
      // to set credits could inflate a student's GPA weight.
      credits,
      registrationType,
      attemptNumber,
    };
  }

  /**
   * A first sitting cannot be a re-sit, and a re-sit cannot be a first sitting.
   *
   * The attempt number is server-assigned, so this rule is unreachable from the
   * validation layer — a schema cannot compare a type against a number it never
   * sees. It is the clearest case in the phase of a rule that MUST live here.
   */
  private assertAttemptTypeCoherent(
    attemptNumber: number,
    registrationType: RegistrationType
  ): void {
    if (attemptNumber === FIRST_ATTEMPT) {
      if (!FIRST_ATTEMPT_TYPES.includes(registrationType)) {
        throw invalid(COURSE_REGISTRATION_MESSAGE.INVALID_FIRST_ATTEMPT);
      }
      return;
    }

    if (!REATTEMPT_TYPES.includes(registrationType)) {
      throw invalid(COURSE_REGISTRATION_MESSAGE.INVALID_REATTEMPT);
    }
  }

  /**
   * Reject a lifecycle move the state machine does not permit.
   *
   * Reads REGISTRATION_TRANSITIONS rather than restating the rules, so the
   * machine is defined in exactly one place and the tests assert against that
   * same definition.
   */
  private assertTransition(from: RegistrationStatus, to: RegistrationStatus): void {
    if (!REGISTRATION_TRANSITIONS[from].includes(to)) {
      throw conflict(COURSE_REGISTRATION_MESSAGE.INVALID_TRANSITION);
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
        resource: COURSE_REGISTRATION_RESOURCE,
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
