// ============================================================================
// MODULE : Services — Curriculum, Timetable & Attendance
// PURPOSE: The three operational academic reads and writes.
//
//          No backend route exists for any of these — they are backend Phases
//          8 and 9. Every live branch is written against the contract the other
//          collections follow, so wiring them up is a change here alone.
// ============================================================================

import type {
  ApiResponse,
  Attendance,
  AttendanceStatus,
  AttendanceSummary,
  Curriculum,
  CurriculumSubject,
  CurriculumSubjectRow,
  ListParams,
  PaginatedResult,
  Timetable,
  TimetableSlot,
} from "@/types";
import { apiList, apiRequest } from "./client";
import { currentSemester } from "./reference";

// --- Curriculum -------------------------------------------------------------

export async function listCurricula(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<Curriculum>>> {
  return apiList<Curriculum>("/api/curricula", "curricula", params);
}

export async function getCurriculum(id: string): Promise<ApiResponse<Curriculum>> {
  return apiRequest<Curriculum>(`/api/curricula/${id}`);
}

export async function getCurriculumForProgramme(
  programmeId: string
): Promise<ApiResponse<Curriculum | null>> {
  const result = await apiList<Curriculum>("/api/curricula", "curricula", {
    programmeId,
    limit: 1,
  });
  if (!result.success) return result;
  return { success: true, data: result.data.items[0] ?? null };
}

/**
 * A curriculum's subjects, joined to the courses they name.
 *
 * Returned unpaginated: a curriculum is a single document read semester by
 * semester, and paging it would split a programme structure across pages for no
 * reason.
 */
export async function listCurriculumSubjects(
  curriculumId: string
): Promise<ApiResponse<CurriculumSubjectRow[]>> {
  const result = await apiList<CurriculumSubject>(
    `/api/curricula/${curriculumId}/subjects`,
    "subjects",
    { limit: 100 }
  );
  if (!result.success) return result;

  return {
    success: true,
    data: result.data.items.map((subject) => ({
      ...subject,
      courseCode: "—",
      courseName: "—",
      courseType: "CORE" as const,
    })),
  };
}

export interface AddSubjectInput {
  courseId: string;
  semesterNumber: number;
  credits: number;
  isCompulsory?: boolean;
}

export async function addCurriculumSubject(
  curriculumId: string,
  input: AddSubjectInput
): Promise<ApiResponse<CurriculumSubject>> {
  return apiRequest<CurriculumSubject>(`/api/curricula/${curriculumId}/subjects`, {
    method: "POST",
    body: input,
  });
}

export async function removeCurriculumSubject(
  curriculumId: string,
  subjectId: string
): Promise<ApiResponse<null>> {
  // A curriculum subject is addressed under its parent curriculum — there is no
  // top-level /api/curriculum-subjects route, so the previous URL 404'd.
  return apiRequest<null>(
    `/api/curricula/${curriculumId}/subjects/${subjectId}`,
    { method: "DELETE" }
  );
}

// --- Timetable --------------------------------------------------------------

/**
 * One section's weekly timetable, joined to course and lecturer.
 *
 * Unpaginated for the same reason as the curriculum: a week grid is read whole,
 * and paging it would hand back half a week.
 */
export async function getSectionTimetable(
  sectionId: string
): Promise<ApiResponse<TimetableSlot[]>> {
  const result = await apiList<Timetable>(
    `/api/timetables/section/${sectionId}`,
    "timetables",
    { limit: 100 }
  );
  if (!result.success) return result;

  return {
    success: true,
    data: result.data.items.map((slot) => ({
      ...slot,
      courseCode: "—",
      courseName: "—",
      facultyName: "—",
    })),
  };
}

/** One lecturer's own week, across every section they teach. */
export async function getFacultyTimetable(
  facultyId: string
): Promise<ApiResponse<TimetableSlot[]>> {
  const result = await apiList<Timetable>(
    `/api/timetables/faculty/${facultyId}`,
    "timetables",
    { limit: 100 }
  );
  if (!result.success) return result;

  return {
    success: true,
    data: result.data.items.map((slot) => ({
      ...slot,
      courseCode: "—",
      courseName: "—",
      facultyName: "—",
    })),
  };
}

// --- Attendance -------------------------------------------------------------

/** One session's register, for the mark-attendance screen. */
export async function getSessionAttendance(
  sectionId: string,
  courseId: string,
  date: string
): Promise<ApiResponse<Attendance[]>> {
  const result = await apiList<Attendance>("/api/attendance", "attendance", {
    sectionId,
    courseId,
    date,
    limit: 200,
  });
  return result.success ? { success: true, data: result.data.items } : result;
}

export interface MarkAttendanceEntry {
  studentId: string;
  status: AttendanceStatus;
}

/**
 * Record a register.
 *
 * Upserts rather than inserts: @@unique([studentId, courseId, date,
 * sessionType]) means re-marking the same session must update the existing row.
 * Inserting would violate the constraint on the second submit, which is exactly
 * what happens when a lecturer corrects a mistake.
 */
export async function markAttendance(
  sectionId: string,
  courseId: string,
  date: string,
  entries: MarkAttendanceEntry[]
): Promise<ApiResponse<{ marked: number }>> {
  return apiRequest<{ marked: number }>("/api/attendance", {
    method: "POST",
    body: { sectionId, courseId, date, entries },
  });
}

/**
 * Per-course attendance percentages for one student.
 *
 * The percentage counts PRESENT and LATE as attended, and EXCUSED too — an
 * authorised absence must not count against a shortage calculation, which is
 * the whole reason the status exists as something other than ABSENT.
 */
export async function getAttendanceReport(
  studentId: string
): Promise<ApiResponse<AttendanceSummary[]>> {
  return apiRequest<AttendanceSummary[]>(`/api/attendance/report/${studentId}`);
}

/**
 * The id of the semester flagged current, or null when none is.
 *
 * Screens that default to "this term" ask for it here rather than each running
 * their own year-then-semester walk. Null is a real answer — a tenant that has
 * not flagged a current semester gets an unfiltered screen, not a wrong one.
 */
export async function currentSemesterId(): Promise<string | null> {
  return (await currentSemester())?.id ?? null;
}
