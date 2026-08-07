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
import {
  MOCK_EXAMINATIONS,
  gradeFor,
  isRegisteredForExamination,
} from "@/mock/data/student-details";
import { examResultStore } from "@/mock/examStores";
import { studentStore } from "@/mock/studentStore";
import { mockFail, mockList, mockOk } from "@/mock/utils";

const now = () => new Date().toISOString();

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
  // Store, not the seed array — otherwise a paper whose marks were just entered
  // still reports a count of zero.
  const results = examResultStore
    .all()
    .filter((r) => r.examinationId === examination.id);

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
    const rows = examResultStore
      .all()
      .filter((result) => result.examinationId === examinationId)
      .map((result): ExamResultRow => {
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

// --- Marks entry ------------------------------------------------------------

/** One student on a paper's roster, with their result if one has been entered. */
export interface ExamRosterRow {
  studentId: string;
  studentName: string;
  enrollmentNo: string;
  /** Null until marks are entered for this student. */
  result: ExamResult | null;
}

/**
 * Everyone registered for a paper, marked or not.
 *
 * Distinct from listExaminationResults, which returns only rows that already
 * exist. Marks entry needs the students who have *no* row yet — that is the
 * entire point of the screen — so a paper that has never been marked would
 * otherwise open on an empty table.
 *
 * LIVE-MODE GAP: there is no roster endpoint. `GET /api/examinations/[id]/results`
 * returns entered results only, and no route exposes course registrations
 * (that is backend Phase 16). Against the live API this therefore degrades to
 * "students already marked", which makes the screen an edit surface rather than
 * an entry surface. Wiring it up properly needs a registrations endpoint first.
 */
export async function listExaminationRoster(
  examinationId: string
): Promise<ApiResponse<ExamRosterRow[]>> {
  if (USE_MOCKS) {
    const resultByStudent = new Map(
      examResultStore
        .all()
        .filter((result) => result.examinationId === examinationId)
        .map((result) => [result.studentId, result])
    );

    const rows = studentStore
      .all()
      .filter(
        (student) =>
          student.status === "ACTIVE" &&
          isRegisteredForExamination(examinationId, student.id)
      )
      .map(
        (student): ExamRosterRow => ({
          studentId: student.id,
          studentName: student.fullName,
          enrollmentNo: student.enrollmentNo,
          result: resultByStudent.get(student.id) ?? null,
        })
      )
      .sort((a, b) => a.enrollmentNo.localeCompare(b.enrollmentNo));

    return mockOk(rows);
  }

  const result = await listExaminationResults(examinationId);
  if (!result.success) return result;

  return {
    success: true,
    data: result.data.map((row) => ({
      studentId: row.studentId,
      studentName: row.studentName,
      enrollmentNo: row.enrollmentNo,
      result: row,
    })),
  };
}

/** One row of the marks sheet as the lecturer submits it. */
export interface ExamResultInput {
  studentId: string;
  /** Ignored when isAbsent — an absent student has no mark. */
  marksObtained: number | null;
  isAbsent: boolean;
  remarks: string | null;
}

/**
 * Save a whole marks sheet in one write.
 *
 * Row-at-a-time saving would leave a half-marked paper behind on any failure,
 * and the backend's POST takes the full `records` array, so the batch is the
 * unit here too. Existing rows are updated rather than duplicated — the
 * examination/student pair identifies a result.
 *
 * Grade and grade point are derived from the same band table the fixtures use,
 * so a mark entered here reads back identically on the transcript. `isPassed`
 * is derived from the paper's own passMark rather than taken from the client,
 * matching what the route handler does server-side.
 */
export async function saveExaminationResults(
  examinationId: string,
  records: ExamResultInput[]
): Promise<ApiResponse<null>> {
  if (USE_MOCKS) {
    const examination = MOCK_EXAMINATIONS.find((exam) => exam.id === examinationId);
    if (!examination) return mockFail<null>("Examination not found", "NOT_FOUND");

    // Every record is validated before any is written, so a rejected sheet
    // leaves the store exactly as it was — the same all-or-nothing the route
    // handler gives via its pre-write loop.
    for (const record of records) {
      if (record.isAbsent) continue;
      if (record.marksObtained === null) continue;
      if (record.marksObtained < 0 || record.marksObtained > examination.maxMarks) {
        return mockFail<null>(
          `Marks must be between 0 and ${examination.maxMarks}.`,
          "VALIDATION_ERROR"
        );
      }
    }

    const timestamp = now();

    for (const record of records) {
      const existing = examResultStore
        .all()
        .find(
          (row) => row.examinationId === examinationId && row.studentId === record.studentId
        );

      // An absent student has no mark, no grade and no pass — a supplied mark is
      // discarded rather than stored.
      const marks = record.isAbsent ? null : record.marksObtained;
      const band =
        marks === null ? null : gradeFor((marks / examination.maxMarks) * 100);

      const patch = {
        marksObtained: marks === null ? null : marks.toFixed(2),
        grade: band?.grade ?? null,
        gradePoint: band?.point ?? null,
        isPassed: record.isAbsent
          ? false
          : marks === null
            ? null
            : marks >= (examination.passMark ?? 0),
        isAbsent: record.isAbsent,
        remarks: record.remarks,
        updatedAt: timestamp,
      };

      if (existing) {
        examResultStore.update(existing.id, patch);
      } else {
        examResultStore.insert({
          id: examResultStore.nextId(),
          examinationId,
          studentId: record.studentId,
          ...patch,
          // Entered, not released. Publishing is a separate decision and a
          // separate action — saving a sheet must not put marks in front of
          // students.
          publishedAt: null,
          createdAt: timestamp,
        });
      }
    }

    return mockOk(null, "Marks saved");
  }

  return apiRequest<null>(`/api/examinations/${examinationId}/results`, {
    method: "POST",
    body: { records },
  });
}
