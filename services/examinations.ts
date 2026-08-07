// ============================================================================
// MODULE : Services — Examinations
// PURPOSE: Scheduled papers and their results, from the lecturer's side.
//
//          GET /api/examinations returns scalar columns only — a courseId and a
//          semesterId, no names and no result counts. Every screen wants all
//          four, so the joins happen here rather than in a page.
// ============================================================================

import type {
  ApiResponse,
  Course,
  ExamResult,
  Examination,
  ListParams,
  PaginatedResult,
  Semester,
} from "@/types";
import { apiList, apiRequest } from "./client";
import { courseIndex, semesterIndex } from "./reference";

/** An examination joined to its course and semester, with a result count. */
export interface ExaminationRow extends Examination {
  courseCode: string;
  courseName: string;
  semesterName: string;
  resultCount: number;
  publishedCount: number;
}

/**
 * Join an examination to its course, its semester and its result counts.
 *
 * The names come from the shared reference indexes; GET /api/examinations
 * returns ids only. The counts come from the paper's own results endpoint —
 * there is no aggregate on the list route — so this costs one request per row.
 * `publishedCount` is what the results screen acts on: entered but not released.
 */
async function toRow(
  examination: Examination,
  courses: Map<string, Course>,
  semesters: Map<string, Semester>
): Promise<ExaminationRow> {
  const course = courses.get(examination.courseId);
  const semester = semesters.get(examination.semesterId);

  const results = await apiList<ExamResult>(
    `/api/examinations/${examination.id}/results`,
    "results",
    { limit: 200 }
  );
  const rows = results.success ? results.data.items : [];

  return {
    ...examination,
    courseCode: course?.code ?? "—",
    courseName: course?.name ?? "—",
    semesterName: semester?.name ?? "—",
    resultCount: results.success ? results.data.pagination.total : 0,
    publishedCount: rows.filter((row) => row.publishedAt !== null).length,
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
  const result = await apiList<Examination>("/api/examinations", "examinations", {
    ...params,
    facultyId,
  });
  if (!result.success) return result;

  const [courses, semesters] = await Promise.all([courseIndex(), semesterIndex()]);
  const items = await Promise.all(
    result.data.items.map((exam) => toRow(exam, courses, semesters))
  );

  return { success: true, data: { ...result.data, items } };
}

/** One examination's results, joined to the students who sat it. */
export interface ExamResultRow extends ExamResult {
  studentName: string;
  enrollmentNo: string;
}

export async function listExaminationResults(
  examinationId: string
): Promise<ApiResponse<ExamResultRow[]>> {
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
  const result = await apiRequest<Examination>(`/api/examinations/${id}`);
  if (!result.success) return result;

  const [courses, semesters] = await Promise.all([courseIndex(), semesterIndex()]);
  return { success: true, data: await toRow(result.data, courses, semesters) };
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
  return apiRequest<null>(`/api/examinations/${examinationId}/results`, {
    method: "POST",
    body: { records },
  });
}
