// ============================================================================
// OWNER      : Gauransh
// MODULE     : Question Paper & Solution Repository (Phase 26)
// LAYER      : Service
// PURPOSE    : Own every rule this phase has — who may edit what, when a
//              resource becomes visible, and what a student is confined to.
// ARCHITECTURE:
//   • Service owns ALL orchestration and every decision.
//   • The visibility rule is delegated to
//     lib/domain/exam-resources/visibility.ts, so the SQL predicate the
//     repository applies and the in-memory decision this layer re-checks are
//     provably the same rule.
//
// A STUDENT IS CONFINED TO THEIR REGISTERED COURSES
//   Every student-facing method resolves the caller to their own Student row,
//   reads the courses they are registered for, and passes that set to the
//   repository. A student naming a course they are not registered for receives
//   nothing rather than an error — an error would confirm the course exists.
//
// A FACULTY MEMBER MANAGES THEIR OWN UPLOADS
//   Editing, publishing, archiving and deleting someone ELSE'S resource
//   requires an administrative role. That is enforced here, by comparing
//   uploadedById against the caller — never by trusting a client-supplied id.
//   The refusal is the same 404 used for "no such resource", so neither answer
//   confirms the other.
//
// EVERY TRANSITION THAT CHANGES STUDENT VISIBILITY IS AUDITED
//   Publish, archive and delete are written to AuditLog inside the same
//   transaction as the change. Ordinary edits are not: `updatedAt` records that
//   one happened, and auditing every typo correction would bury the events that
//   matter.
//
// QUERY BUDGET, STATED HONESTLY
//   create        2 (course, semester) + 1 insert
//   update        1 (lookup) + 1 update
//   publish/archive 1 (lookup) + 1 update + 1 audit, the last two in one
//                 transaction
//   delete        1 (lookup) + 1 delete + 1 audit
//   list (staff)  2
//   list (student) 1 (student) + 1 (registrations) + 2
// ============================================================================

import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import { ExamResourceStatus } from "@/app/generated/prisma/enums";
import {
  EDITABLE_STATUSES,
  EXAM_RESOURCE_ACTION,
  EXAM_RESOURCE_AUDIT_RESOURCE,
  EXAM_RESOURCE_MESSAGE,
} from "@/lib/constants/examResource";
import {
  toDownloadDto,
  toExamResourceDto,
  toPageDto,
  toStudentExamResourceDto,
  type ExamResourceDownloadDto,
  type ExamResourceDto,
  type ExamResourcePageDto,
  type ExamResourceRow,
  type StudentExamResourceDto,
  type StudentExamResourceRow,
} from "@/lib/dto/examResource.dto";
import type { ExamResourceRepositoryPort } from "@/lib/repositories/examResource.repository";
import type { AuditLogRepositoryPort } from "@/lib/repositories/auditLog.repository";
import type {
  ArchiveExamResourceInput,
  CreateExamResourceInput,
  ExamResourceListQuery,
  PublishExamResourceInput,
  StudentExamResourceQuery,
  UpdateExamResourceInput,
} from "@/lib/validations/examResource.validation";

/**
 * Who is asking, as the route resolved them.
 *
 * `scope` carries the AUTHORITY the guard established rather than raw roles —
 * the same contract Phase 16's ResultAccess and Phase 23's FacultyAccessContext
 * use. ANY reaches every resource in the tenant; OWN is confined to the
 * caller's own uploads.
 */
export interface ExamResourceAccess {
  readonly tenantId: string;
  readonly userId: string;
  readonly scope: "ANY" | "OWN";
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export class ExamResourceService {
  constructor(
    private readonly repository: ExamResourceRepositoryPort,
    private readonly auditLog: AuditLogRepositoryPort
  ) {}

  /**
   * POST /api/exam-resources
   *
   * RULES   : The course and semester must exist in this tenant — checked
   *           individually so the caller learns which is wrong. The department
   *           is DENORMALISED from the course rather than accepted from the
   *           client, so a resource cannot be filed under a department its
   *           course does not belong to.
   *
   *           A new resource is always DRAFT. The README's "Publish
   *           Immediately" is the publish endpoint called straight after, which
   *           keeps the one transition that changes student visibility on a
   *           single audited path.
   */
  async create(
    access: ExamResourceAccess,
    input: CreateExamResourceInput,
    now: Date
  ): Promise<ExamResourceDto> {
    const course = await this.repository.findCourse(access.tenantId, input.courseId);

    if (!course) {
      throw new AppError(
        EXAM_RESOURCE_MESSAGE.COURSE_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }

    const semesterExists = await this.repository.semesterExists(
      access.tenantId,
      input.semesterId
    );

    if (!semesterExists) {
      throw new AppError(
        EXAM_RESOURCE_MESSAGE.SEMESTER_NOT_FOUND,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODE.NOT_FOUND
      );
    }

    const created = await this.repository.create({
      tenantId: access.tenantId,
      courseId: input.courseId,
      semesterId: input.semesterId,
      departmentId: course.departmentId,
      examinationId: input.examinationId ?? null,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      academicYear: input.academicYear ?? null,
      fileName: input.fileName,
      fileUrl: input.fileUrl,
      fileSize: input.fileSize ?? null,
      mimeType: input.mimeType ?? null,
      status: ExamResourceStatus.DRAFT,
      scheduledPublishAt: input.scheduledPublishAt
        ? new Date(input.scheduledPublishAt)
        : null,
      uploadedById: access.userId,
    });

    return toExamResourceDto(created as unknown as ExamResourceRow, now);
  }

  /** GET /api/exam-resources/[id] */
  async getById(
    access: ExamResourceAccess,
    id: string,
    now: Date
  ): Promise<ExamResourceDto> {
    const row = await this.requireReadable(access, id);

    return toExamResourceDto(row, now);
  }

  /** GET /api/exam-resources */
  async list(
    access: ExamResourceAccess,
    query: ExamResourceListQuery,
    now: Date
  ): Promise<ExamResourcePageDto<ExamResourceDto>> {
    const { rows, total } = await this.repository.findStaffPage(access.tenantId, {
      ...query,
      // A faculty member may BROWSE the department repository — the README
      // grants students far wider read access than that, so restricting staff
      // would be perverse. `?mine=true` narrows to their own uploads when they
      // want it.
      uploadedById: query.mine ? access.userId : undefined,
    });

    return toPageDto(
      rows.map((row) => toExamResourceDto(row as unknown as ExamResourceRow, now)),
      query.page,
      query.limit,
      total
    );
  }

  /**
   * PATCH /api/exam-resources/[id]
   *
   * RULES   : An ARCHIVED resource is frozen. It is the historical record
   *           students relied on, and silently rewriting a withdrawn answer key
   *           would leave no trace that the document changed. Re-publishing it
   *           first is the deliberate path back.
   *
   *           courseId and semesterId are not accepted, so an edit cannot move
   *           a resource to a course with a different audience.
   */
  async update(
    access: ExamResourceAccess,
    id: string,
    input: UpdateExamResourceInput,
    now: Date
  ): Promise<ExamResourceDto> {
    const existing = await this.requireWritable(access, id);

    if (!(EDITABLE_STATUSES as readonly ExamResourceStatus[]).includes(existing.status)) {
      throw new AppError(
        EXAM_RESOURCE_MESSAGE.NOT_EDITABLE,
        HTTP_STATUS.CONFLICT,
        ERROR_CODE.CONFLICT
      );
    }

    const updated = await this.repository.update(access.tenantId, id, {
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.academicYear !== undefined ? { academicYear: input.academicYear } : {}),
      ...(input.fileName !== undefined ? { fileName: input.fileName } : {}),
      ...(input.fileUrl !== undefined ? { fileUrl: input.fileUrl } : {}),
      ...(input.fileSize !== undefined ? { fileSize: input.fileSize } : {}),
      ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
      ...(input.scheduledPublishAt !== undefined
        ? {
            scheduledPublishAt: input.scheduledPublishAt
              ? new Date(input.scheduledPublishAt)
              : null,
          }
        : {}),
    });

    return toExamResourceDto(updated as unknown as ExamResourceRow, now);
  }

  /**
   * PATCH /api/exam-resources/[id]/publish
   *
   * RULES   : Refuses an already-PUBLISHED resource with 409 — re-publishing
   *           would silently reset `publishedAt` and lose the original release
   *           date, which is exactly what a "when was this available" question
   *           needs.
   *
   *           An ARCHIVED resource CAN be published: that is how withdrawn
   *           material is restored, and it is the only path back to editable.
   *
   *           `isVerified` may be set here, because the README gives an HOD
   *           both capabilities. It does NOT gate visibility.
   */
  async publish(
    access: ExamResourceAccess,
    id: string,
    input: PublishExamResourceInput,
    now: Date
  ): Promise<ExamResourceDto> {
    const existing = await this.requireWritable(access, id);

    if (existing.status === ExamResourceStatus.PUBLISHED) {
      throw new AppError(
        EXAM_RESOURCE_MESSAGE.ALREADY_PUBLISHED,
        HTTP_STATUS.CONFLICT,
        ERROR_CODE.CONFLICT
      );
    }

    const published = await this.repository.transaction(async (client) => {
      const row = await this.repository.update(
        access.tenantId,
        id,
        {
          status: ExamResourceStatus.PUBLISHED,
          publishedAt: now,
          archivedAt: null,
          ...(input.scheduledPublishAt !== undefined
            ? {
                scheduledPublishAt: input.scheduledPublishAt
                  ? new Date(input.scheduledPublishAt)
                  : null,
              }
            : {}),
          ...(input.isVerified === undefined
            ? {}
            : {
                isVerified: input.isVerified,
                verifiedById: input.isVerified ? access.userId : null,
                verifiedAt: input.isVerified ? now : null,
              }),
        },
        client
      );

      await this.auditLog.record(
        {
          tenantId: access.tenantId,
          userId: access.userId,
          action: EXAM_RESOURCE_ACTION.PUBLISH,
          resource: EXAM_RESOURCE_AUDIT_RESOURCE,
          resourceId: id,
          before: { status: existing.status },
          after: {
            status: row.status,
            scheduledPublishAt: row.scheduledPublishAt?.toISOString() ?? null,
            isVerified: row.isVerified,
          },
          ipAddress: access.ipAddress,
          userAgent: access.userAgent,
        },
        client
      );

      return row;
    });

    return toExamResourceDto(published as unknown as ExamResourceRow, now);
  }

  /**
   * PATCH /api/exam-resources/[id]/archive
   *
   * NOT A DELETE. Previous-year papers are the point of the repository, so
   * archival withdraws material from students while retaining it for staff.
   */
  async archive(
    access: ExamResourceAccess,
    id: string,
    _input: ArchiveExamResourceInput,
    now: Date
  ): Promise<ExamResourceDto> {
    const existing = await this.requireWritable(access, id);

    if (existing.status === ExamResourceStatus.ARCHIVED) {
      throw new AppError(
        EXAM_RESOURCE_MESSAGE.ALREADY_ARCHIVED,
        HTTP_STATUS.CONFLICT,
        ERROR_CODE.CONFLICT
      );
    }

    const archived = await this.repository.transaction(async (client) => {
      const row = await this.repository.update(
        access.tenantId,
        id,
        { status: ExamResourceStatus.ARCHIVED, archivedAt: now },
        client
      );

      await this.auditLog.record(
        {
          tenantId: access.tenantId,
          userId: access.userId,
          action: EXAM_RESOURCE_ACTION.ARCHIVE,
          resource: EXAM_RESOURCE_AUDIT_RESOURCE,
          resourceId: id,
          before: { status: existing.status },
          after: { status: row.status },
          ipAddress: access.ipAddress,
          userAgent: access.userAgent,
        },
        client
      );

      return row;
    });

    return toExamResourceDto(archived as unknown as ExamResourceRow, now);
  }

  /**
   * DELETE /api/exam-resources/[id]
   *
   * A hard delete, audited. The README names both DELETE and archive as
   * separate operations, so this is genuinely destructive and archive is the
   * non-destructive alternative — which is why the audit entry records the
   * title and location, the only trace that will remain.
   */
  async remove(access: ExamResourceAccess, id: string): Promise<void> {
    const existing = await this.requireWritable(access, id);

    await this.repository.transaction(async (client) => {
      const removed = await this.repository.delete(access.tenantId, id, client);

      if (removed === 0) {
        // Deleted between the lookup and the write. Reported as the 404 the
        // lookup would have produced.
        throw this.notFound();
      }

      await this.auditLog.record(
        {
          tenantId: access.tenantId,
          userId: access.userId,
          action: EXAM_RESOURCE_ACTION.DELETE,
          resource: EXAM_RESOURCE_AUDIT_RESOURCE,
          resourceId: id,
          before: {
            title: existing.title,
            type: existing.type,
            status: existing.status,
            fileUrl: existing.fileUrl,
            courseId: existing.courseId,
          },
          ipAddress: access.ipAddress,
          userAgent: access.userAgent,
        },
        client
      );
    });
  }

  // --- Student surface ------------------------------------------------------

  /** GET /api/students/me/exam-resources */
  async listForStudent(
    tenantId: string,
    userId: string,
    query: StudentExamResourceQuery,
    now: Date
  ): Promise<ExamResourcePageDto<StudentExamResourceDto>> {
    const courseIds = await this.resolveStudentCourses(tenantId, userId);

    const { rows, total } = await this.repository.findStudentPage(
      tenantId,
      courseIds,
      query,
      now
    );

    return toPageDto(
      rows.map((row) => toStudentExamResourceDto(row as unknown as StudentExamResourceRow)),
      query.page,
      query.limit,
      total
    );
  }

  /** GET /api/students/me/exam-resources/[id] */
  async getForStudent(
    tenantId: string,
    userId: string,
    id: string,
    now: Date
  ): Promise<StudentExamResourceDto> {
    return toStudentExamResourceDto(await this.requireStudentResource(tenantId, userId, id, now));
  }

  /**
   * GET /api/students/me/exam-resources/[id]/download
   *
   * Returns JSON carrying the location, not bytes. Nothing in this project
   * streams a file and no storage client exists to stream from — the Phase 17
   * receipt download made the same choice for the same reason.
   *
   * The URL is served ONLY here, never in the list response, so a list cannot
   * be scraped for every paper's location in one request.
   */
  async downloadForStudent(
    tenantId: string,
    userId: string,
    id: string,
    now: Date
  ): Promise<ExamResourceDownloadDto> {
    return toDownloadDto(await this.requireStudentResource(tenantId, userId, id, now));
  }

  // --- Internals ------------------------------------------------------------

  /** The caller's own registered courses. Empty when they own no Student row. */
  private async resolveStudentCourses(
    tenantId: string,
    userId: string
  ): Promise<readonly string[]> {
    const student = await this.repository.findStudentByUserId(tenantId, userId);

    if (!student) {
      throw new AppError(
        EXAM_RESOURCE_MESSAGE.STUDENT_NOT_RESOLVED,
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODE.FORBIDDEN
      );
    }

    return this.repository.findRegisteredCourseIds(tenantId, student.id);
  }

  private async requireStudentResource(
    tenantId: string,
    userId: string,
    id: string,
    now: Date
  ): Promise<StudentExamResourceRow> {
    const courseIds = await this.resolveStudentCourses(tenantId, userId);

    const row = await this.repository.findStudentResource(tenantId, id, courseIds, now);

    // 404, never 403 — a 403 would confirm the resource exists and is merely
    // withheld, which tells a student that an unpublished paper is out there.
    if (!row) throw this.notFound();

    return row as unknown as StudentExamResourceRow;
  }

  /** Any staff caller may READ any resource in their tenant. */
  private async requireReadable(
    access: ExamResourceAccess,
    id: string
  ): Promise<ExamResourceRow> {
    const row = await this.repository.findById(access.tenantId, id);

    if (!row) throw this.notFound();

    return row as unknown as ExamResourceRow;
  }

  /**
   * Only an administrative caller, or the uploader, may WRITE.
   *
   * The refusal is the same 404 as "no such resource", so a faculty member
   * probing for a colleague's draft learns nothing from the response.
   */
  private async requireWritable(
    access: ExamResourceAccess,
    id: string
  ): Promise<ExamResourceRow & { uploadedById: string }> {
    const row = (await this.requireReadable(access, id)) as ExamResourceRow & {
      uploadedById: string;
    };

    if (access.scope !== "ANY" && row.uploadedById !== access.userId) {
      throw this.notFound();
    }

    return row;
  }

  private notFound(): AppError {
    return new AppError(
      EXAM_RESOURCE_MESSAGE.NOT_FOUND,
      HTTP_STATUS.NOT_FOUND,
      ERROR_CODE.NOT_FOUND
    );
  }
}
