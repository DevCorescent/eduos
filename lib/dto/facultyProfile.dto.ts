// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Profile & Performance Analytics (Phase 23)
// LAYER  : DTO
// PURPOSE: The shapes the five Phase 23 endpoints return.
//
// NO PRISMA VALUE CROSSES THIS BOUNDARY
//   Every mapper returns a plain object. Date columns become ISO strings, and
//   the two that are conceptually calendar days — publishedOn, issuedOn — are
//   rendered as YYYY-MM-DD so a client cannot apply a timezone and land a day
//   early on a publication date.
//
// NULL MEANS UNAVAILABLE AND IS NEVER FABRICATED
//   Every rate and average in the analytics DTOs is `number | null`. Null is
//   what a faculty member with no data gets — see the domain module for why a
//   fabricated 0% is materially worse than an absent figure.
//
// NO COMPOSITE SCORE IS PRESENT ANYWHERE IN THESE SHAPES
//   The README names "Teaching Performance" but defines no formula. The
//   component metrics are reported side by side and a client is free to
//   combine them; the server does not invent a weighting nobody decided.
// ============================================================================

import type {
  DayOfWeek,
  EmployeeStatus,
  SessionType,
} from "@/app/generated/prisma/enums";
import type {
  AttendanceSummary,
  ResultSummary,
  WorkloadSummary,
} from "@/lib/domain/faculty-analytics/metrics";

/** A date column that only ever meant a calendar day. */
function toCalendarDay(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

// --- Profile ----------------------------------------------------------------

export interface FacultyPublicationDto {
  readonly id: string;
  readonly title: string;
  readonly publisher: string | null;
  readonly identifier: string | null;
  readonly url: string | null;
  readonly publishedOn: string | null;
}

export interface FacultyCertificationDto {
  readonly id: string;
  readonly name: string;
  readonly issuer: string | null;
  readonly url: string | null;
  readonly issuedOn: string | null;
  readonly expiresOn: string | null;
}

export interface FacultyEducationDto {
  readonly id: string;
  readonly degree: string;
  readonly institution: string;
  readonly fieldOfStudy: string | null;
  readonly startYear: number | null;
  readonly endYear: number | null;
  readonly grade: string | null;
}

export interface FacultyProfileDto {
  readonly id: string;
  readonly tenantId: string;
  /** The README's "Faculty Number". */
  readonly employeeId: string;
  readonly name: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly photoUrl: string | null;
  readonly designation: string | null;
  readonly qualification: string | null;
  readonly specialization: string | null;
  readonly experience: number | null;
  readonly status: EmployeeStatus;
  readonly joinDate: string;
  readonly department: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  } | null;
  readonly publications: readonly FacultyPublicationDto[];
  readonly certifications: readonly FacultyCertificationDto[];
  readonly education: readonly FacultyEducationDto[];
}

/** The row shape FACULTY_PROFILE_SELECT produces. */
export interface FacultyProfileRow {
  id: string;
  tenantId: string;
  employeeId: string;
  designation: string | null;
  qualification: string | null;
  specialization: string | null;
  experience: number | null;
  photoUrl: string | null;
  status: EmployeeStatus;
  joinDate: Date;
  user: {
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    email: string;
    phone: string | null;
  };
  department: { id: string; code: string; name: string } | null;
  publications: Array<{
    id: string;
    title: string;
    publisher: string | null;
    identifier: string | null;
    url: string | null;
    publishedOn: Date | null;
  }>;
  certifications: Array<{
    id: string;
    name: string;
    issuer: string | null;
    url: string | null;
    issuedOn: Date | null;
    expiresOn: Date | null;
  }>;
  education: Array<{
    id: string;
    degree: string;
    institution: string;
    fieldOfStudy: string | null;
    startYear: number | null;
    endYear: number | null;
    grade: string | null;
  }>;
}

/**
 * Compose a display name.
 *
 * displayName first because it is what the tenant chose to show; the name parts
 * are a fallback, and a row carrying neither reports null rather than an empty
 * string a UI would render as a blank card.
 */
function displayNameOf(user: FacultyProfileRow["user"]): string | null {
  const composed = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();

  return user.displayName ?? (composed.length > 0 ? composed : null);
}

export function toFacultyProfileDto(row: FacultyProfileRow): FacultyProfileDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    employeeId: row.employeeId,
    name: displayNameOf(row.user),
    email: row.user.email,
    phone: row.user.phone,
    photoUrl: row.photoUrl,
    designation: row.designation,
    qualification: row.qualification,
    specialization: row.specialization,
    experience: row.experience,
    status: row.status,
    joinDate: row.joinDate.toISOString(),
    department: row.department,
    publications: row.publications.map((entry) => ({
      id: entry.id,
      title: entry.title,
      publisher: entry.publisher,
      identifier: entry.identifier,
      url: entry.url,
      publishedOn: toCalendarDay(entry.publishedOn),
    })),
    certifications: row.certifications.map((entry) => ({
      id: entry.id,
      name: entry.name,
      issuer: entry.issuer,
      url: entry.url,
      issuedOn: toCalendarDay(entry.issuedOn),
      expiresOn: toCalendarDay(entry.expiresOn),
    })),
    education: row.education.map((entry) => ({
      id: entry.id,
      degree: entry.degree,
      institution: entry.institution,
      fieldOfStudy: entry.fieldOfStudy,
      startYear: entry.startYear,
      endYear: entry.endYear,
      grade: entry.grade,
    })),
  };
}

// --- Workload ---------------------------------------------------------------

/** One course a faculty member teaches. */
export interface TaughtCourseDto {
  readonly courseId: string;
  readonly code: string | null;
  readonly name: string | null;
  readonly credits: number | null;
  readonly sectionId: string | null;
  readonly semesterId: string | null;
  readonly isActive: boolean;
}

/** One slot on the weekly timetable. */
export interface FacultySlotDto {
  readonly id: string;
  readonly day: DayOfWeek;
  readonly startTime: string;
  readonly endTime: string;
  readonly roomNo: string | null;
  readonly sessionType: SessionType;
  readonly isActive: boolean;
  readonly courseCode: string | null;
  readonly courseName: string | null;
  readonly sectionName: string | null;
}

export interface FacultyWorkloadDto {
  readonly facultyId: string;
  /** Present only when the caller narrowed to one semester. */
  readonly semesterId: string | null;
  readonly summary: WorkloadSummary;
  /** The README's "Student Count". */
  readonly studentCount: number;
  readonly courses: readonly TaughtCourseDto[];
  /** The README's "Weekly Timetable". */
  readonly timetable: readonly FacultySlotDto[];
}

/** The assignment row shape the repository produces. */
export interface AssignmentRow {
  courseId: string;
  sectionId: string | null;
  semesterId: string | null;
  isActive: boolean;
  course: { code: string; name: string; credits: number | null } | null;
}

/** The timetable row shape the repository produces. */
export interface SlotRow {
  id: string;
  day: DayOfWeek;
  startTime: string;
  endTime: string;
  roomNo: string | null;
  sessionType: SessionType;
  isActive: boolean;
  course: { code: string; name: string } | null;
  section: { name: string } | null;
}

export function toFacultyWorkloadDto(input: {
  facultyId: string;
  semesterId: string | null;
  summary: WorkloadSummary;
  studentCount: number;
  assignments: readonly AssignmentRow[];
  slots: readonly SlotRow[];
}): FacultyWorkloadDto {
  return {
    facultyId: input.facultyId,
    semesterId: input.semesterId,
    summary: input.summary,
    studentCount: input.studentCount,
    courses: input.assignments.map((assignment) => ({
      courseId: assignment.courseId,
      code: assignment.course?.code ?? null,
      name: assignment.course?.name ?? null,
      credits: assignment.course?.credits ?? null,
      sectionId: assignment.sectionId,
      semesterId: assignment.semesterId,
      isActive: assignment.isActive,
    })),
    timetable: input.slots.map((slot) => ({
      id: slot.id,
      day: slot.day,
      startTime: slot.startTime,
      endTime: slot.endTime,
      roomNo: slot.roomNo,
      sessionType: slot.sessionType,
      isActive: slot.isActive,
      courseCode: slot.course?.code ?? null,
      courseName: slot.course?.name ?? null,
      sectionName: slot.section?.name ?? null,
    })),
  };
}

// --- Performance & analytics ------------------------------------------------

/** What students said, read from Phase 20 rather than recomputed. */
export interface FacultyFeedbackSummaryDto {
  /** Mean overall rating on the 1-5 scale, or null when nobody responded. */
  readonly averageRating: number | null;
  readonly responseCount: number;
}

/**
 * The performance dashboard.
 *
 * FOUR NAMED COMPONENTS, NO COMPOSITE. Each is traceable to one query and one
 * definition. A client charts them; nothing here weights them together.
 */
export interface FacultyPerformanceDto {
  readonly facultyId: string;
  readonly semesterId: string | null;
  readonly teaching: {
    readonly courseCount: number;
    readonly sectionCount: number;
    readonly weeklySlotCount: number;
    readonly studentCount: number;
  };
  readonly attendance: AttendanceSummary;
  readonly results: ResultSummary;
  readonly feedback: FacultyFeedbackSummaryDto;
}

/**
 * The analytics view.
 *
 * Everything the performance dashboard reports, plus the per-session-type
 * breakdown a chart needs and the per-course list a table needs. Kept as a
 * distinct shape because the README names two endpoints and collapsing them
 * would make one of the two a lie about what it returns.
 */
export interface FacultyAnalyticsDto extends FacultyPerformanceDto {
  readonly slotsBySessionType: Readonly<Record<string, number>>;
  readonly courses: readonly TaughtCourseDto[];
}
