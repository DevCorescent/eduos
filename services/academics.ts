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
import { USE_MOCKS } from "./config";
import { MOCK_TENANT_ID } from "@/mock/data/context";
import { CURRENT_SEMESTER } from "@/mock/data/academics";
import { COURSE_BY_ID } from "@/mock/data/courses";
import {
  ATTENDANCE_SECTION_ID,
  CURRICULUM_BY_PROGRAMME,
  MOCK_CURRICULA,
} from "@/mock/data/academics-ops";
import {
  attendanceStore,
  curriculumSubjectStore,
  timetableStore,
} from "@/mock/academicsStores";
import { facultyStore } from "@/mock/staffStores";
import { mockFail, mockList, mockOk } from "@/mock/utils";

const now = () => new Date().toISOString();

// --- Curriculum -------------------------------------------------------------

export async function listCurricula(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<Curriculum>>> {
  if (USE_MOCKS) {
    return mockList(MOCK_CURRICULA, params, {
      searchFields: ["name", "version"],
      filterKeys: ["programmeId"],
    });
  }
  return apiList<Curriculum>("/api/curricula", "curricula", params);
}

export async function getCurriculum(id: string): Promise<ApiResponse<Curriculum>> {
  if (USE_MOCKS) {
    const curriculum = MOCK_CURRICULA.find((c) => c.id === id);
    return curriculum
      ? mockOk(curriculum)
      : mockFail<Curriculum>("Curriculum not found", "NOT_FOUND");
  }
  return apiRequest<Curriculum>(`/api/curricula/${id}`);
}

export async function getCurriculumForProgramme(
  programmeId: string
): Promise<ApiResponse<Curriculum | null>> {
  if (USE_MOCKS) {
    return mockOk(CURRICULUM_BY_PROGRAMME.get(programmeId) ?? null);
  }

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
  if (USE_MOCKS) {
    const rows = curriculumSubjectStore
      .all()
      .filter((subject) => subject.curriculumId === curriculumId)
      .map((subject): CurriculumSubjectRow => {
        const course = COURSE_BY_ID.get(subject.courseId);
        return {
          ...subject,
          courseCode: course?.code ?? "—",
          courseName: course?.name ?? "—",
          courseType: course?.type ?? "CORE",
        };
      })
      .sort(
        (a, b) =>
          a.semesterNumber - b.semesterNumber || a.courseCode.localeCompare(b.courseCode)
      );

    return mockOk(rows);
  }

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
  if (USE_MOCKS) {
    // @@unique([curriculumId, courseId, semesterNumber]) — the same course may
    // appear in two semesters, but not twice in one.
    const duplicate = curriculumSubjectStore
      .all()
      .some(
        (s) =>
          s.curriculumId === curriculumId &&
          s.courseId === input.courseId &&
          s.semesterNumber === input.semesterNumber
      );

    if (duplicate) {
      return mockFail<CurriculumSubject>(
        "That course is already in this semester",
        "CONFLICT"
      );
    }

    return mockOk(
      curriculumSubjectStore.insert({
        id: curriculumSubjectStore.nextId(),
        curriculumId,
        courseId: input.courseId,
        semesterNumber: input.semesterNumber,
        isCompulsory: input.isCompulsory ?? true,
        credits: input.credits,
        internalMarks: 40,
        externalMarks: 60,
        createdAt: now(),
      }),
      "Subject added"
    );
  }

  return apiRequest<CurriculumSubject>(`/api/curricula/${curriculumId}/subjects`, {
    method: "POST",
    body: input,
  });
}

export async function removeCurriculumSubject(
  curriculumId: string,
  subjectId: string
): Promise<ApiResponse<null>> {
  if (USE_MOCKS) {
    return curriculumSubjectStore.remove(subjectId)
      ? mockOk(null, "Subject removed")
      : mockFail<null>("Subject not found", "NOT_FOUND");
  }
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
  if (USE_MOCKS) {
    const rows = timetableStore
      .all()
      .filter((slot) => slot.sectionId === sectionId && slot.isActive)
      .map((slot): TimetableSlot => {
        const course = COURSE_BY_ID.get(slot.courseId);
        const faculty = facultyStore.find(slot.facultyId);
        return {
          ...slot,
          courseCode: course?.code ?? "—",
          courseName: course?.name ?? "—",
          facultyName: faculty?.fullName ?? "—",
        };
      });

    return mockOk(rows);
  }

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
  if (USE_MOCKS) {
    const rows = timetableStore
      .all()
      .filter((slot) => slot.facultyId === facultyId && slot.isActive)
      .map((slot): TimetableSlot => {
        const course = COURSE_BY_ID.get(slot.courseId);
        const faculty = facultyStore.find(slot.facultyId);
        return {
          ...slot,
          courseCode: course?.code ?? "—",
          courseName: course?.name ?? "—",
          facultyName: faculty?.fullName ?? "—",
        };
      });

    return mockOk(rows);
  }

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

/** The section attendance fixtures exist for. Used to steer the demo screens. */
export function attendanceDemoSectionId(): string {
  return ATTENDANCE_SECTION_ID;
}

/** One session's register, for the mark-attendance screen. */
export async function getSessionAttendance(
  sectionId: string,
  courseId: string,
  date: string
): Promise<ApiResponse<Attendance[]>> {
  if (USE_MOCKS) {
    const day = date.slice(0, 10);
    return mockOk(
      attendanceStore
        .all()
        .filter(
          (row) =>
            row.sectionId === sectionId &&
            row.courseId === courseId &&
            row.date.slice(0, 10) === day
        )
    );
  }

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
  if (USE_MOCKS) {
    const day = date.slice(0, 10);

    for (const entry of entries) {
      const existing = attendanceStore
        .all()
        .find(
          (row) =>
            row.studentId === entry.studentId &&
            row.courseId === courseId &&
            row.date.slice(0, 10) === day &&
            row.sessionType === "LECTURE"
        );

      if (existing) {
        attendanceStore.update(existing.id, { status: entry.status, markedAt: now() });
      } else {
        attendanceStore.insert({
          id: attendanceStore.nextId(),
          tenantId: MOCK_TENANT_ID,
          studentId: entry.studentId,
          facultyId: null,
          sectionId,
          courseId,
          date: new Date(day).toISOString(),
          status: entry.status,
          sessionType: "LECTURE",
          remarks: null,
          markedAt: now(),
          markedBy: null,
        });
      }
    }

    return mockOk({ marked: entries.length }, "Attendance saved");
  }

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
  if (USE_MOCKS) {
    const rows = attendanceStore.all().filter((row) => row.studentId === studentId);

    const byCourse = new Map<string, Attendance[]>();
    for (const row of rows) {
      if (!row.courseId) continue;
      const existing = byCourse.get(row.courseId);
      if (existing) existing.push(row);
      else byCourse.set(row.courseId, [row]);
    }

    const summaries: AttendanceSummary[] = Array.from(byCourse.entries()).map(
      ([courseId, courseRows]) => {
        const course = COURSE_BY_ID.get(courseId);
        const present = courseRows.filter((r) => r.status === "PRESENT").length;
        const late = courseRows.filter((r) => r.status === "LATE").length;
        const excused = courseRows.filter((r) => r.status === "EXCUSED").length;
        const absent = courseRows.filter((r) => r.status === "ABSENT").length;

        const attended = present + late + excused;

        return {
          courseId,
          courseCode: course?.code ?? "—",
          courseName: course?.name ?? "—",
          totalClasses: courseRows.length,
          present,
          absent,
          late,
          percentage:
            courseRows.length === 0
              ? 0
              : Math.round((attended / courseRows.length) * 1000) / 10,
        };
      }
    );

    return mockOk(summaries.sort((a, b) => a.courseCode.localeCompare(b.courseCode)));
  }

  return apiRequest<AttendanceSummary[]>(`/api/attendance/report/${studentId}`);
}

/** The current semester, for screens that default to it. */
export function currentSemesterId(): string {
  return CURRENT_SEMESTER.id;
}
