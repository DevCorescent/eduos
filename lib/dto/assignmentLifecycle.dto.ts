// ============================================================================
// OWNER  : Gauransh
// MODULE : Assignment Management Enhancement (Phase 24)
// LAYER  : DTO
// PURPOSE: The shapes the six Phase 24 endpoints return.
//
// NO PRISMA VALUE CROSSES THIS BOUNDARY
//   Every mapper returns a plain object with Date columns converted to ISO
//   strings. The Json attachment column is passed through as stored — nothing
//   in the database constrains its shape and nothing in the application has
//   ever validated what was written into it, so casting it to an interface
//   would be a claim this codebase cannot support.
//
// A STUDENT ON A ROSTER IS NAMED, NOT NUMBERED
//   Both rosters expand the student's User row to a display name and enrolment
//   number. A page of cuids is a page a faculty member cannot act on.
// ============================================================================

import type { SubmissionStatus } from "@/app/generated/prisma/enums";
import type {
  AssignmentAnalyticsTotals,
  AssignmentStats,
} from "@/lib/domain/assignment-analytics/metrics";

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** Who a roster row is about. */
export interface RosterStudentDto {
  readonly studentId: string;
  readonly enrollmentNo: string;
  readonly name: string | null;
  readonly email: string;
}

/** The Student shape both roster queries select. */
export interface RosterStudentRow {
  id: string;
  enrollmentNo: string;
  user: {
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    email: string;
  };
}

export function toRosterStudentDto(row: RosterStudentRow): RosterStudentDto {
  const composed = [row.user.firstName, row.user.lastName].filter(Boolean).join(" ").trim();

  return {
    studentId: row.id,
    enrollmentNo: row.enrollmentNo,
    name: row.user.displayName ?? (composed.length > 0 ? composed : null),
    email: row.user.email,
  };
}

/** One student who has submitted, with the state of their submission. */
export interface SubmittedRowDto {
  readonly submissionId: string;
  readonly student: RosterStudentDto;
  readonly status: SubmissionStatus;
  readonly submittedAt: string | null;
  readonly marks: number | null;
  readonly feedback: string | null;
  readonly gradedAt: string | null;
  readonly attachments: unknown;
  /** How many superseded attempts precede the current one. */
  readonly previousAttempts: number;
}

/** The row shape findSubmittedPage produces. */
export interface SubmittedRow {
  id: string;
  status: SubmissionStatus;
  submittedAt: Date | null;
  marks: number | null;
  feedback: string | null;
  gradedAt: Date | null;
  attachments: unknown;
  student: RosterStudentRow;
  _count: { versions: number };
}

export function toSubmittedRowDto(row: SubmittedRow): SubmittedRowDto {
  return {
    submissionId: row.id,
    student: toRosterStudentDto(row.student),
    status: row.status,
    submittedAt: toIso(row.submittedAt),
    marks: row.marks,
    feedback: row.feedback,
    gradedAt: toIso(row.gradedAt),
    attachments: row.attachments ?? null,
    previousAttempts: row._count.versions,
  };
}

/** A page of roster rows and the total that satisfied the same predicate. */
export interface RosterPageDto<T> {
  readonly rows: readonly T[];
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

export function toRosterPageDto<T>(
  rows: readonly T[],
  page: number,
  limit: number,
  total: number
): RosterPageDto<T> {
  return {
    rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/** One superseded attempt. */
export interface SubmissionVersionDto {
  readonly id: string;
  readonly attempt: number;
  readonly status: SubmissionStatus;
  readonly submittedAt: string | null;
  readonly marks: number | null;
  readonly feedback: string | null;
  readonly attachments: unknown;
  /** When this version was superseded — not when it was originally submitted. */
  readonly recordedAt: string;
}

/** The row shape findVersions produces. */
export interface SubmissionVersionRow {
  id: string;
  attempt: number;
  status: SubmissionStatus;
  submittedAt: Date | null;
  marks: number | null;
  feedback: string | null;
  attachments: unknown;
  recordedAt: Date;
}

export function toSubmissionVersionDto(row: SubmissionVersionRow): SubmissionVersionDto {
  return {
    id: row.id,
    attempt: row.attempt,
    status: row.status,
    submittedAt: toIso(row.submittedAt),
    marks: row.marks,
    feedback: row.feedback,
    attachments: row.attachments ?? null,
    recordedAt: row.recordedAt.toISOString(),
  };
}

/** What a student gets back after submitting or resubmitting. */
export interface SubmissionResultDto {
  readonly submissionId: string;
  readonly assignmentId: string;
  readonly status: SubmissionStatus;
  readonly submittedAt: string | null;
  readonly marks: number | null;
  readonly feedback: string | null;
  readonly gradedAt: string | null;
  readonly attachments: unknown;
  /**
   * Which attempt this is, 1-based.
   *
   * Reported so a student can see that a resubmission was recorded as one,
   * rather than having to infer it from the history endpoint.
   */
  readonly attempt: number;
  /** True when this write replaced an earlier attempt. */
  readonly isResubmission: boolean;
  readonly history: readonly SubmissionVersionDto[];
}

/** One assignment's analytics, with enough identity to label it. */
export interface AssignmentAnalyticsRowDto extends AssignmentStats {
  readonly title: string;
  readonly courseId: string;
  readonly sectionId: string | null;
  readonly status: string;
  readonly maxMarks: number;
  readonly dueDate: string | null;
}

/** The analytics response. */
export interface AssignmentAnalyticsDto {
  readonly totals: AssignmentAnalyticsTotals;
  readonly assignments: readonly AssignmentAnalyticsRowDto[];
}
