// ============================================================================
// OWNER      : Gauransh
// MODULE     : Student Component Score
// LAYER      : Service
// PURPOSE    : Every rule governing how a mark comes into existence — the
//              sitting's state, the regulation's state, the caller's right to
//              write, the eligibility of every registration, the status/mark
//              invariant, change detection, atomicity and audit.
// ARCHITECTURE:
//   • Service contains ALL business logic.
//   • It owns transaction BOUNDARIES; the repository owns the Prisma handle.
//   • Both dependencies arrive as constructor PORTS imported with
//     `import type`, so this module's runtime graph never reaches
//     lib/db/prisma and it unit-tests with no database.
//
// THE QUERY BUDGET — constant in the size of the batch
//   event + governing scheme + (faculty) + registrations + existing marks
//     = 4–5 READS, whether the upload carries one mark or a thousand.
//
//   Then ONE createMany for every new mark, and one UPDATE per mark whose value
//   actually MOVED. Nothing is read per row and nothing is written for a mark
//   that did not change.
//
// WHY NOT ONE STATEMENT FOR THE AMENDMENTS TOO
//   Prisma has no bulk upsert, so the honest options were a raw
//   INSERT ... ON CONFLICT DO UPDATE, a delete-then-insert, or this. Raw SQL is
//   reserved by the project rules for where it is required, and delete-insert
//   would churn primary keys and destroy the record of when a mark was FIRST
//   entered — on the one table where that history matters most.
//
//   The shape this leaves is good where it counts: a first upload of a thousand
//   marks is ONE insert, and re-uploading a corrected spreadsheet writes only
//   the handful of rows that actually differ, because unchanged rows are
//   detected and skipped. The pathological case — a genuine regrade of an
//   entire cohort — is a thousand updates, and that is an operation which ought
//   to be slow and visible rather than quiet.
// ============================================================================

import { AssessmentEventStatus, EvaluationSchemeStatus, MarkStatus } from "@/app/generated/prisma/enums";
import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import { MARK_ENTRY_STATUS } from "@/lib/constants/assessmentEvent";
import {
  MARK_MESSAGE,
  MARKABLE_REGISTRATION_STATUSES,
  STUDENT_COMPONENT_SCORE_RESOURCE,
  STATUS_WITHOUT_MARKS,
  type MarkUploadAction,
} from "@/lib/constants/studentComponentScore";
import { parseHundredths } from "@/lib/domain/evaluationComponentTree";
import type {
  AuditLogRepositoryPort,
  DbClient as AuditDbClient,
} from "@/lib/repositories/auditLog.repository";
import type {
  CreateStudentComponentScoreData,
  DbClient,
  MarkableRegistrationRecord,
  MarkingEventRecord,
  StudentComponentScoreRecord,
  StudentComponentScoreRepositoryPort,
} from "@/lib/repositories/studentComponentScore.repository";
import type {
  MarksSheetDTO,
  MarkUploadResultDTO,
  StudentComponentScoreDTO,
} from "@/lib/dto/studentComponentScore.dto";
import type { MarkEntryInput, UploadMarksInput } from "@/lib/validations/studentComponentScore";
import type { RequestContext } from "@/lib/utils/request-context";

/** Registration statuses that may receive marks, as a Set for O(1) lookup. */
const MARKABLE_SET = new Set<string>(MARKABLE_REGISTRATION_STATUSES);

/**
 * Who is uploading, and therefore what they may reach.
 *
 * `restrictToConductedEvents` is set by the internal route for a FACULTY
 * caller and by nothing else. It is the rule that makes the internal/external
 * split real: without it, admitting FACULTY to the internal endpoint would let
 * a lecturer upload university examination marks through it.
 */
export interface MarkUploadAuthority {
  action: MarkUploadAction;
  restrictToConductedEvents: boolean;
}

/** 404 — the sitting does not exist, or belongs to another tenant. */
function eventNotFound(): AppError {
  return new AppError(
    MARK_MESSAGE.EVENT_NOT_FOUND,
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

/** 400 — the request contradicts a rule about the values it carries. */
function invalid(message: string): AppError {
  return new AppError(message, HTTP_STATUS.BAD_REQUEST, ERROR_CODE.VALIDATION);
}

/** 403 — the caller is authenticated and permitted here, but not for THIS sitting. */
function forbidden(message: string): AppError {
  return new AppError(message, HTTP_STATUS.FORBIDDEN, ERROR_CODE.FORBIDDEN);
}

/** Record -> DTO. The null mark is preserved, because absence is not zero. */
function toDTO(record: StudentComponentScoreRecord): StudentComponentScoreDTO {
  return {
    id: record.id,
    tenantId: record.tenantId,
    assessmentEventId: record.assessmentEventId,
    courseRegistrationId: record.courseRegistrationId,
    marksObtained: record.marksObtained === null ? null : record.marksObtained.toString(),
    status: record.status,
    remarks: record.remarks,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** The normalised form of one submitted entry, after defaults are applied. */
interface NormalisedEntry {
  courseRegistrationId: string;
  marksObtained: number | null;
  status: MarkStatus;
  remarks: string | null;
}

/**
 * Has this mark actually moved?
 *
 * Compared in integer HUNDREDTHS rather than on floats, reusing the exact
 * parser the component tree relies on. A stored 17.50 and a submitted 17.5 are
 * the same mark, and an equality test that said otherwise would rewrite every
 * row on every re-upload — turning a cheap correction into a full regrade.
 */
function hasChanged(existing: StudentComponentScoreRecord, entry: NormalisedEntry): boolean {
  if (existing.status !== entry.status) {
    return true;
  }

  if ((existing.remarks ?? null) !== entry.remarks) {
    return true;
  }

  const existingMark = existing.marksObtained;

  if (existingMark === null || entry.marksObtained === null) {
    return existingMark === null ? entry.marksObtained !== null : true;
  }

  return parseHundredths(existingMark) !== parseHundredths(entry.marksObtained);
}

export class StudentComponentScoreService {
  constructor(
    private readonly scores: StudentComponentScoreRepositoryPort,
    private readonly audit: AuditLogRepositoryPort
  ) {}

  /**
   * A sitting's whole marks sheet.
   *
   * COMPLEXITY : two queries — the sitting, then its marks — then ONE pass that
   *              builds the DTOs and tallies all three counts. Counting
   *              separately would be three further traversals of the same
   *              array for figures that fall out of the same visit.
   */
  async getMarksSheet(
    tenantId: string,
    assessmentEventId: string,
    departmentId: string | null = null
  ): Promise<MarksSheetDTO> {
    const event = await this.scores.findEvent(tenantId, assessmentEventId);

    if (event === null) {
      throw eventNotFound();
    }

    // MARK_READ_ROLES admits DEPARTMENT_HOD, which without this narrowing read
    // every mark in the university. `departmentId` is null for callers who are
    // not narrowed and is resolved from the authenticated subject, so nothing
    // the caller can edit reaches it.
    //
    // The refusal is the same not-found an unknown id gets: a sitting outside
    // the department must not be confirmed to exist by the shape of the error.
    if (
      departmentId !== null &&
      !(await this.scores.courseBelongsToDepartment(
        tenantId,
        event.courseId,
        departmentId
      ))
    ) {
      throw eventNotFound();
    }

    const records = await this.scores.findByEvent(tenantId, assessmentEventId);

    const entries: StudentComponentScoreDTO[] = [];
    let recordedCount = 0;
    let absentCount = 0;
    let withheldCount = 0;

    for (const record of records) {
      entries.push(toDTO(record));

      if (record.status === MarkStatus.ABSENT) {
        absentCount += 1;
      } else if (record.status === MarkStatus.WITHHELD) {
        withheldCount += 1;
      } else {
        recordedCount += 1;
      }
    }

    return {
      assessmentEventId,
      eventStatus: event.status as AssessmentEventStatus,
      acceptsMarks: event.status === MARK_ENTRY_STATUS,
      maxMarks: event.maxMarks.toString(),
      recordedCount,
      absentCount,
      withheldCount,
      entries,
    };
  }

  /**
   * Record or amend marks for one sitting.
   *
   * The whole of C6.2's business rules run here, in this order, and the order
   * is deliberate — each step is a precondition of the next, and every one that
   * can fail does so before a single row is written:
   *
   *   1. The sitting exists in this tenant.
   *   2. It is OPEN. This single predicate IS locking and publication: a DRAFT,
   *      LOCKED or PUBLISHED sitting rejects every write, so "no marks after
   *      lock" and "no marks after publish" are one rule rather than three.
   *   3. The regulation governing it is still ACTIVE. Checked here and not only
   *      at scheduling, because a scheme can be archived after a sitting opens.
   *   4. The caller may write to THIS sitting. A lecturer is confined to the
   *      sittings they conduct; an administrator is not.
   *   5. Every registration exists, belongs to this course, this term, this
   *      teaching group and this REGULATION, and is still live.
   *   6. Every mark fits the total this paper was set out of.
   *
   * Only then is anything written, and all of it in one transaction.
   *
   * COMPLEXITY : 4–5 reads regardless of batch size; O(b) in memory over the
   *              batch, with every lookup through a Map rather than a scan —
   *              there is no nested loop anywhere in this method.
   */
  async upload(
    tenantId: string,
    input: UploadMarksInput,
    authority: MarkUploadAuthority,
    context: RequestContext
  ): Promise<MarkUploadResultDTO> {
    return this.scores.transaction(async (tx) => {
      const event = await this.scores.findEvent(tenantId, input.assessmentEventId, tx);

      if (event === null) {
        throw eventNotFound();
      }

      if (event.status !== MARK_ENTRY_STATUS) {
        throw conflict(MARK_MESSAGE.EVENT_NOT_OPEN);
      }

      const governing = await this.scores.findGoverningScheme(
        tenantId,
        event.evaluationComponentId,
        tx
      );

      if (governing === null) {
        throw referenceNotFound(MARK_MESSAGE.COMPONENT_NOT_FOUND);
      }

      if (governing.schemeStatus !== EvaluationSchemeStatus.ACTIVE) {
        throw conflict(MARK_MESSAGE.SCHEME_NOT_ACTIVE);
      }

      if (authority.restrictToConductedEvents) {
        await this.assertConductsEvent(tenantId, event, context, tx);
      }

      const registrationIds = input.marks.map((entry) => entry.courseRegistrationId);

      const registrations = await this.scores.findRegistrations(tenantId, registrationIds, tx);

      if (registrations.length !== registrationIds.length) {
        throw referenceNotFound(MARK_MESSAGE.REGISTRATION_NOT_FOUND);
      }

      const registrationById = new Map(
        registrations.map((registration) => [registration.id, registration])
      );

      const entries = input.marks.map((entry) =>
        this.normaliseAndValidate(entry, event, governing.schemeId, registrationById)
      );

      const existing = await this.scores.findExisting(
        tenantId,
        event.id,
        registrationIds,
        tx
      );
      const existingByRegistration = new Map(
        existing.map((record) => [record.courseRegistrationId, record])
      );

      const toCreate: CreateStudentComponentScoreData[] = [];
      const toUpdate: NormalisedEntry[] = [];
      let unchangedCount = 0;

      for (const entry of entries) {
        const current = existingByRegistration.get(entry.courseRegistrationId);

        if (current === undefined) {
          toCreate.push({
            tenantId,
            assessmentEventId: event.id,
            courseRegistrationId: entry.courseRegistrationId,
            marksObtained: entry.marksObtained,
            status: entry.status,
            remarks: entry.remarks,
          });
          continue;
        }

        if (hasChanged(current, entry)) {
          toUpdate.push(entry);
        } else {
          unchangedCount += 1;
        }
      }

      const createdCount = await this.scores.createMany(toCreate, tx);

      for (const entry of toUpdate) {
        await this.scores.updateByNaturalKey(
          tenantId,
          event.id,
          entry.courseRegistrationId,
          {
            marksObtained: entry.marksObtained,
            status: entry.status,
            remarks: entry.remarks,
          },
          tx
        );
      }

      const result: MarkUploadResultDTO = {
        assessmentEventId: event.id,
        submittedCount: input.marks.length,
        createdCount,
        updatedCount: toUpdate.length,
        unchangedCount,
      };

      // ONE audit entry for the upload, not one per mark. A thousand entries
      // would bury the act that caused them; the before/after of individual
      // marks is reconstructable from the sheet either side of this timestamp,
      // and the entry itself records which sitting, by whom, from where.
      await this.audit.record(
        {
          tenantId,
          userId: context.actorId,
          action: authority.action,
          resource: STUDENT_COMPONENT_SCORE_RESOURCE,
          resourceId: event.id,
          before: { existingCount: existing.length },
          after: result,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        tx as AuditDbClient
      );

      return result;
    });
  }

  /**
   * A lecturer may only record marks for sittings they conduct.
   *
   * The session identifies a USER; the sitting records a FacultyMember. The
   * profile is resolved tenant-scoped, and a sitting with no conductor accepts
   * no faculty entry at all — an unassigned sitting has nobody entitled to mark
   * it.
   */
  private async assertConductsEvent(
    tenantId: string,
    event: MarkingEventRecord,
    context: RequestContext,
    tx: DbClient
  ): Promise<void> {
    const faculty = await this.scores.findFacultyByUserId(tenantId, context.actorId, tx);

    if (faculty === null) {
      throw forbidden(MARK_MESSAGE.FACULTY_PROFILE_MISSING);
    }

    if (event.conductedById === null || event.conductedById !== faculty.id) {
      throw forbidden(MARK_MESSAGE.FACULTY_NOT_CONDUCTOR);
    }
  }

  /**
   * Apply defaults to one entry and reject it if any rule fails.
   *
   * Every check is a Map lookup or a comparison — O(1) per entry, so the whole
   * batch is one linear pass with no nested scan.
   */
  private normaliseAndValidate(
    entry: MarkEntryInput,
    event: MarkingEventRecord,
    schemeId: string,
    registrationById: Map<string, MarkableRegistrationRecord>
  ): NormalisedEntry {
    // Present by construction: the caller verified every id resolved.
    const registration = registrationById.get(
      entry.courseRegistrationId
    ) as MarkableRegistrationRecord;

    if (
      registration.courseId !== event.courseId ||
      registration.semesterId !== event.semesterId
    ) {
      throw conflict(MARK_MESSAGE.REGISTRATION_WRONG_COURSE);
    }

    // Only enforced when the sitting names a teaching group. A cohort-wide
    // sitting is sat by every registration for the course and term.
    if (event.sectionId !== null && registration.sectionId !== event.sectionId) {
      throw conflict(MARK_MESSAGE.REGISTRATION_WRONG_SECTION);
    }

    // The rule that ties C5.5, C6.1 and C6.2 together: a mark must be recorded
    // under the SAME regulation the student is enrolled under, or it would be
    // graded by rules that never applied to them.
    if (registration.evaluationSchemeId !== schemeId) {
      throw conflict(MARK_MESSAGE.REGISTRATION_WRONG_SCHEME);
    }

    if (!MARKABLE_SET.has(registration.status)) {
      throw conflict(MARK_MESSAGE.REGISTRATION_NOT_MARKABLE);
    }

    const status = entry.status ?? MarkStatus.RECORDED;
    const marksObtained = entry.marksObtained ?? null;

    // Re-asserted here as well as in the schema: this service is the invariant
    // boundary, and a future internal caller reaches it without a Zod schema in
    // front of it.
    if (status === STATUS_WITHOUT_MARKS) {
      if (marksObtained !== null) {
        throw invalid(MARK_MESSAGE.MARKS_FORBIDDEN_WHEN_ABSENT);
      }
    } else {
      if (marksObtained === null) {
        throw invalid(MARK_MESSAGE.MARKS_REQUIRED);
      }

      // Compared in integer hundredths, exactly as every other bound in this
      // phase: a mark of 30.00 against a total of 30.00 must compare equal.
      if (parseHundredths(marksObtained) > parseHundredths(event.maxMarks)) {
        throw invalid(MARK_MESSAGE.MARKS_EXCEED_MAXIMUM);
      }
    }

    return {
      courseRegistrationId: entry.courseRegistrationId,
      marksObtained,
      status,
      remarks: entry.remarks ?? null,
    };
  }
}
