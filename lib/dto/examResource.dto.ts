// ============================================================================
// OWNER  : Gauransh
// MODULE : Question Paper & Solution Repository (Phase 26)
// LAYER  : DTO
// PURPOSE: The two shapes this module returns — one for staff, one for
//          students — and the mappers that produce them.
//
// TWO SHAPES, NOT ONE WITH FIELDS OMITTED
//   A student's view carries no uploader, no lifecycle timestamps and no
//   workflow state beyond what they need. Expressing that as a separate
//   interface means the student mapper CANNOT accidentally leak a staff field:
//   there is no key to put it in. A single shape with optional fields would
//   push that guarantee into whichever caller remembered to strip them.
//
// NO PRISMA VALUE CROSSES THIS BOUNDARY
//   Every Date becomes an ISO string. Nothing here is a Decimal.
// ============================================================================

import type { ExamResourceStatus, ExamResourceType } from "@/app/generated/prisma/enums";
import { isVisibleToStudent, pendingReason } from "@/lib/domain/exam-resources/visibility";

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** Who uploaded a resource. Staff view only. */
export interface UploaderDto {
  readonly id: string;
  readonly name: string | null;
  readonly email: string;
}

interface UploaderRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  email: string;
}

function toUploaderDto(row: UploaderRow | null): UploaderDto | null {
  if (row === null) return null;

  const composed = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();

  return {
    id: row.id,
    name: row.displayName ?? (composed.length > 0 ? composed : null),
    email: row.email,
  };
}

/** A resource as STAFF see it. */
export interface ExamResourceDto {
  readonly id: string;
  readonly tenantId: string;
  readonly courseId: string;
  readonly courseCode: string | null;
  readonly courseName: string | null;
  readonly semesterId: string;
  readonly semesterName: string | null;
  readonly departmentId: string | null;
  readonly departmentCode: string | null;
  readonly departmentName: string | null;
  readonly examinationId: string | null;
  readonly type: ExamResourceType;
  readonly title: string;
  readonly description: string | null;
  readonly academicYear: string | null;
  readonly fileName: string;
  readonly fileUrl: string;
  readonly fileSize: number | null;
  readonly mimeType: string | null;
  readonly status: ExamResourceStatus;
  readonly scheduledPublishAt: string | null;
  readonly publishedAt: string | null;
  readonly archivedAt: string | null;
  readonly isVerified: boolean;
  readonly verifiedAt: string | null;
  readonly uploadedBy: UploaderDto | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * Whether a student can see this RIGHT NOW.
   *
   * Derived from the same predicate the student endpoints use, so a staff
   * listing cannot claim a resource is live while the student route hides it.
   */
  readonly isLiveForStudents: boolean;
  /**
   * Why it is not live, or null when it is.
   *
   * "SCHEDULED" is the state that exists only because publication is evaluated
   * on read rather than by a job: PUBLISHED, but not yet due.
   */
  readonly pendingReason: "DRAFT" | "ARCHIVED" | "SCHEDULED" | null;
}

/** The row shape EXAM_RESOURCE_SELECT produces. */
export interface ExamResourceRow {
  id: string;
  tenantId: string;
  courseId: string;
  semesterId: string;
  departmentId: string | null;
  examinationId: string | null;
  type: ExamResourceType;
  title: string;
  description: string | null;
  academicYear: string | null;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string | null;
  status: ExamResourceStatus;
  scheduledPublishAt: Date | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  isVerified: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  course: { code: string; name: string } | null;
  semester: { name: string } | null;
  department: { code: string; name: string } | null;
  uploadedBy: UploaderRow | null;
}

export function toExamResourceDto(row: ExamResourceRow, now: Date): ExamResourceDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    courseId: row.courseId,
    courseCode: row.course?.code ?? null,
    courseName: row.course?.name ?? null,
    semesterId: row.semesterId,
    semesterName: row.semester?.name ?? null,
    departmentId: row.departmentId,
    departmentCode: row.department?.code ?? null,
    departmentName: row.department?.name ?? null,
    examinationId: row.examinationId,
    type: row.type,
    title: row.title,
    description: row.description,
    academicYear: row.academicYear,
    fileName: row.fileName,
    fileUrl: row.fileUrl,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    status: row.status,
    scheduledPublishAt: toIso(row.scheduledPublishAt),
    publishedAt: toIso(row.publishedAt),
    archivedAt: toIso(row.archivedAt),
    isVerified: row.isVerified,
    verifiedAt: toIso(row.verifiedAt),
    uploadedBy: toUploaderDto(row.uploadedBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isLiveForStudents: isVisibleToStudent(row, now),
    pendingReason: pendingReason(row, now),
  };
}

/**
 * A resource as a STUDENT sees it.
 *
 * No uploader, no lifecycle timestamps beyond publication, no archival state.
 * Who set a paper is staff information, and a student comparing uploaders
 * across papers learns something about internal process the README never grants
 * them.
 */
export interface StudentExamResourceDto {
  readonly id: string;
  readonly courseId: string;
  readonly courseCode: string | null;
  readonly courseName: string | null;
  readonly semesterId: string;
  readonly semesterName: string | null;
  readonly examinationId: string | null;
  readonly type: ExamResourceType;
  readonly title: string;
  readonly description: string | null;
  readonly academicYear: string | null;
  readonly fileName: string;
  readonly fileSize: number | null;
  readonly mimeType: string | null;
  /** Reported as a quality signal, never as a gate. See the constants module. */
  readonly isVerified: boolean;
  readonly publishedAt: string | null;
}

/** The row shape STUDENT_EXAM_RESOURCE_SELECT produces. */
export interface StudentExamResourceRow {
  id: string;
  courseId: string;
  semesterId: string;
  examinationId: string | null;
  type: ExamResourceType;
  title: string;
  description: string | null;
  academicYear: string | null;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string | null;
  status: ExamResourceStatus;
  scheduledPublishAt: Date | null;
  publishedAt: Date | null;
  isVerified: boolean;
  course: { code: string; name: string } | null;
  semester: { name: string } | null;
}

/**
 * Map a resource for a student.
 *
 * NOTE that `fileUrl` is NOT included. A student receives the download location
 * only from the dedicated download endpoint, so a list response cannot be
 * scraped for every paper's URL in one request.
 */
export function toStudentExamResourceDto(
  row: StudentExamResourceRow
): StudentExamResourceDto {
  return {
    id: row.id,
    courseId: row.courseId,
    courseCode: row.course?.code ?? null,
    courseName: row.course?.name ?? null,
    semesterId: row.semesterId,
    semesterName: row.semester?.name ?? null,
    examinationId: row.examinationId,
    type: row.type,
    title: row.title,
    description: row.description,
    academicYear: row.academicYear,
    fileName: row.fileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    isVerified: row.isVerified,
    publishedAt: toIso(row.publishedAt),
  };
}

/**
 * What the download endpoint returns.
 *
 * JSON CARRYING A LOCATION, NOT BYTES. Nothing in this project streams a file:
 * the Phase 17 receipt download returns JSON for the same reason, and no
 * storage client exists to stream from. A client follows `fileUrl`.
 */
export interface ExamResourceDownloadDto extends StudentExamResourceDto {
  readonly fileUrl: string;
}

export function toDownloadDto(row: StudentExamResourceRow): ExamResourceDownloadDto {
  return { ...toStudentExamResourceDto(row), fileUrl: row.fileUrl };
}

/** A page of rows and the total that satisfied the same predicate. */
export interface ExamResourcePageDto<T> {
  readonly resources: readonly T[];
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

export function toPageDto<T>(
  resources: readonly T[],
  page: number,
  limit: number,
  total: number
): ExamResourcePageDto<T> {
  return {
    resources,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
