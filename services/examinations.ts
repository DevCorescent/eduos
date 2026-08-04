// ============================================================================
// MODULE : Services — Examinations
// PURPOSE: Scheduled papers and their results, from the lecturer's side.
//
//          No backend route serves this yet (backend Phase 10). Written against
//          the contract in types/entities.ts.
// ============================================================================

import type {
  ApiResponse,
  ExamResult,
  Examination,
  ListParams,
  PaginatedResult,
} from "@/types";
import { apiList, apiRequest } from "./client";
import { USE_MOCKS } from "./config";
import { SEMESTER_BY_ID } from "@/mock/data/academics";
import { COURSE_BY_ID, MOCK_FACULTY_ASSIGNMENTS } from "@/mock/data/courses";
import { MOCK_EXAM_RESULTS, MOCK_EXAMINATIONS } from "@/mock/data/student-details";
import { studentStore } from "@/mock/studentStore";
import { mockFail, mockList, mockOk } from "@/mock/utils";

/** An examination joined to its course and semester, with a result count. */
export interface ExaminationRow extends Examination {
  courseCode: string;
  courseName: string;
  semesterName: string;
  resultCount: number;
  publishedCount: number;
}

function toRow(examination: Examination): ExaminationRow {
  const course = COURSE_BY_ID.get(examination.courseId);
  const semester = SEMESTER_BY_ID.get(examination.semesterId);
  const results = MOCK_EXAM_RESULTS.filter((r) => r.examinationId === examination.id);

  return {
    ...examination,
    courseCode: course?.code ?? "—",
    courseName: course?.name ?? "—",
    semesterName: semester?.name ?? "—",
    resultCount: results.length,
    // Entered but not yet released — the state the results screen exists to
    // act on.
    publishedCount: results.filter((r) => r.publishedAt !== null).length,
  };
}

/**
 * Examinations for the courses one lecturer teaches.
 *
 * Derived from their teaching assignments rather than from the examination's
 * own columns: Examination carries no facultyId, so "my exams" can only mean
 * "exams for courses I am assigned to".
 */
export async function listFacultyExaminations(
  facultyId: string,
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<ExaminationRow>>> {
  if (USE_MOCKS) {
    const taughtCourseIds = new Set(
      MOCK_FACULTY_ASSIGNMENTS.filter(
        (assignment) => assignment.facultyId === facultyId && assignment.isActive
      ).map((assignment) => assignment.courseId)
    );

    const rows = MOCK_EXAMINATIONS.filter((exam) =>
      taughtCourseIds.has(exam.courseId)
    ).map(toRow);

    return mockList(rows, params, {
      searchFields: ["title", "courseCode"],
      filterKeys: ["status", "type"],
      // Most recent first: a lecturer opens this to enter marks for a paper
      // just sat, not to review one from two terms ago.
      sort: (a, b) =>
        Date.parse(b.date ?? b.createdAt) - Date.parse(a.date ?? a.createdAt),
    });
  }

  const result = await apiList<Examination>("/api/examinations", "examinations", {
    ...params,
    facultyId,
  });
  if (!result.success) return result;

  return {
    success: true,
    data: {
      ...result.data,
      items: result.data.items.map((exam) => ({
        ...exam,
        courseCode: "—",
        courseName: "—",
        semesterName: "—",
        resultCount: 0,
        publishedCount: 0,
      })),
    },
  };
}

/** One examination's results, joined to the students who sat it. */
export interface ExamResultRow extends ExamResult {
  studentName: string;
  enrollmentNo: string;
}

export async function listExaminationResults(
  examinationId: string
): Promise<ApiResponse<ExamResultRow[]>> {
  if (USE_MOCKS) {
    const rows = MOCK_EXAM_RESULTS.filter(
      (result) => result.examinationId === examinationId
    ).map((result): ExamResultRow => {
      const student = studentStore.find(result.studentId);
      return {
        ...result,
        studentName: student?.fullName ?? "—",
        enrollmentNo: student?.enrollmentNo ?? "—",
      };
    });

    // Unpublished first — those are what still need action.
    return mockOk(
      rows.sort(
        (a, b) =>
          Number(a.publishedAt !== null) - Number(b.publishedAt !== null) ||
          a.enrollmentNo.localeCompare(b.enrollmentNo)
      )
    );
  }

  const result = await apiList<ExamResult>(
    `/api/examinations/${examinationId}/results`,
    "results",
    { limit: 200 }
  );
  if (!result.success) return result;

  return {
    success: true,
    data: result.data.items.map((row) => ({
      ...row,
      studentName: "—",
      enrollmentNo: "—",
    })),
  };
}

export async function getExamination(id: string): Promise<ApiResponse<ExaminationRow>> {
  if (USE_MOCKS) {
    const examination = MOCK_EXAMINATIONS.find((exam) => exam.id === id);
    return examination
      ? mockOk(toRow(examination))
      : mockFail<ExaminationRow>("Examination not found", "NOT_FOUND");
  }

  const result = await apiRequest<Examination>(`/api/examinations/${id}`);
  return result.success ? { success: true, data: toRow(result.data) } : result;
}
