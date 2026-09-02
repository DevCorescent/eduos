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
import { MAX_LIST_LIMIT } from "@/types/api";
import { courseIndex, semesterIndex } from "./reference";
import { mapWithConcurrency } from "./concurrency";

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
  semesters: Map<string, Semester>,
  resolveCounts = true
): Promise<ExaminationRow> {
  const course = courses.get(examination.courseId);
  const semester = semesters.get(examination.semesterId);

  // Skipped when the caller does not read the counts. There is no aggregate on
  // GET /api/examinations, so each count costs one request for that paper —
  // a page of a hundred exams was a hundred requests, and the faculty dashboard
  // paid all of them to render six fields, none of which is a count.
  //
  // Defaulted to true so every existing caller keeps the behaviour it has;
  // opting out is explicit and belongs to callers that have checked they read
  // neither resultCount nor publishedCount.
  if (!resolveCounts) {
    return {
      ...examination,
      courseCode: course?.code ?? "—",
      courseName: course?.name ?? "—",
      semesterName: semester?.name ?? "—",
      resultCount: 0,
      publishedCount: 0,
    };
  }

  const results = await apiList<ExamResult>(
    `/api/examinations/${examination.id}/results`,
    "results",
    { limit: MAX_LIST_LIMIT }
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
export interface ExaminationListOptions {
  /**
   * Whether to resolve resultCount and publishedCount for each paper.
   *
   * One request per row when true. Pass false only from a caller that reads
   * neither — see toRow.
   */
  resolveCounts?: boolean;
}

export async function listFacultyExaminations(
  facultyId: string,
  params?: ListParams,
  options: ExaminationListOptions = {}
): Promise<ApiResponse<PaginatedResult<ExaminationRow>>> {
  const result = await apiList<Examination>("/api/examinations", "examinations", {
    ...params,
    facultyId,
  });
  if (!result.success) return result;

  const [courses, semesters] = await Promise.all([courseIndex(), semesterIndex()]);

  // Bounded rather than all-at-once: see services/concurrency.ts for why a
  // hundred simultaneous per-row reads exhausted the connection pool.
  const items = await mapWithConcurrency(result.data.items, (exam) =>
    toRow(exam, courses, semesters, options.resolveCounts ?? true)
  );

  return { success: true, data: { ...result.data, items } };
}

/** The course and semester the API now joins onto every examination row. */
type ExaminationWithJoin = Examination & {
  course?: { code: string; name: string } | null;
  semester?: { name: string } | null;
};

/**
 * Every examination in the tenant, newest first.
 *
 * WHY THIS DOES NOT GO THROUGH courseIndex()
 *   The reference indexes resolve names by scanning /api/courses, which is
 *   COURSE_READ_ROLES. The Controller of Examination is deliberately NOT in
 *   that set — the examination office does not get the institutional course
 *   registry — so every name came back "—". GET /api/examinations now joins the
 *   course and semester itself, and this function reads that join, which is why
 *   it works for a caller who cannot read the catalogue.
 *
 * `resolveCounts` defaults to FALSE here, unlike the faculty list: the counts
 * cost one request per row and the calendar does not show them.
 */
export interface ExaminationFilters extends ListParams {
  /** ExaminationType. Validated against the enum by the route. */
  type?: string;
  semesterId?: string;
}

export async function listExaminations(
  params?: ExaminationFilters,
  options: ExaminationListOptions = {}
): Promise<ApiResponse<PaginatedResult<ExaminationRow>>> {
  const result = await apiList<ExaminationWithJoin>(
    "/api/examinations",
    "examinations",
    params
  );
  if (!result.success) return result;

  const resolveCounts = options.resolveCounts ?? false;

  const items = await mapWithConcurrency(result.data.items, async (exam) => {
    const { course, semester, ...examination } = exam;

    const base: ExaminationRow = {
      ...examination,
      courseCode: course?.code ?? "—",
      courseName: course?.name ?? "—",
      semesterName: semester?.name ?? "—",
      resultCount: 0,
      publishedCount: 0,
    };

    if (!resolveCounts) return base;

    const results = await apiList<ExamResult>(
      `/api/examinations/${examination.id}/results`,
      "results",
      { limit: MAX_LIST_LIMIT }
    );
    const rows = results.success ? results.data.items : [];

    return {
      ...base,
      resultCount: results.success ? results.data.pagination.total : 0,
      publishedCount: rows.filter((row) => row.publishedAt !== null).length,
    };
  });

  return { success: true, data: { ...result.data, items } };
}

/** The body POST /api/examinations accepts. See lib/validations/examination.ts. */
export interface ScheduleExaminationInput {
  semesterId: string;
  courseId: string;
  title: string;
  type?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  venue?: string;
  maxMarks: number;
  passMark?: number;
  duration?: number;
  instructions?: string;
}

/** Schedule an examination. PRD 17.2 — Examination Configuration. */
export async function scheduleExamination(
  input: ScheduleExaminationInput
): Promise<ApiResponse<Examination>> {
  return apiRequest<Examination>("/api/examinations", {
    method: "POST",
    body: input,
  });
}

/** One student's standing for one examination, as the eligibility route returns it. */
export interface EligibilityRowDTO {
  studentId: string;
  enrollmentNo: string;
  studentName: string;
  courseRegistrationId: string;
  registrationStatus: string;
  sessionsHeld: number;
  sessionsAttended: number;
  decision:
    | { eligible: true; attendancePercentage: number }
    | { eligible: false; reason: string; attendancePercentage: number };
  ticketNo: string | null;
  seatNo: string | null;
}

export interface EligibilityReport {
  examination: { id: string; title: string; courseId: string; semesterId: string };
  rows: EligibilityRowDTO[];
  summary: {
    total: number;
    eligible: number;
    ineligible: number;
    ticketsIssued: number;
    seated: number;
  };
}

/** The examination cohort with each student's eligibility. Examination office only. */
export async function getExaminationEligibility(
  examinationId: string
): Promise<ApiResponse<EligibilityReport>> {
  return apiRequest<EligibilityReport>(
    `/api/examinations/${examinationId}/eligibility`
  );
}

export interface IssueHallTicketsResult {
  issuedCount: number;
  alreadyIssuedCount: number;
  ineligibleCount: number;
}

/**
 * Issue hall tickets to the eligible cohort.
 *
 * No body: the cohort is derived from the examination server-side, so there is
 * no student for a caller to name and none to manipulate.
 */
export async function issueHallTickets(
  examinationId: string
): Promise<ApiResponse<IssueHallTicketsResult>> {
  return apiRequest<IssueHallTicketsResult>(
    `/api/examinations/${examinationId}/hall-tickets`,
    { method: "POST", body: {} }
  );
}

export interface AllocateSeatsResult {
  allocatedCount: number;
  alreadyAllocatedCount: number;
}

/**
 * Allocate seats to the tickets already issued for an examination.
 *
 * No body: the plan is derived server-side in enrolment order, so no seat and
 * no student can be named by a caller.
 */
export async function allocateExaminationSeats(
  examinationId: string
): Promise<ApiResponse<AllocateSeatsResult>> {
  return apiRequest<AllocateSeatsResult>(
    `/api/examinations/${examinationId}/seats`,
    { method: "POST", body: {} }
  );
}

/** One student's own hall tickets. Resolved from their session, never an id. */
export interface StudentHallTicket {
  id: string;
  ticketNo: string;
  seatNo: string | null;
  issuedAt: string;
  examination: {
    id: string;
    title: string;
    type: string;
    date: string | null;
    startTime: string | null;
    endTime: string | null;
    venue: string | null;
    maxMarks: number;
    course: { code: string; name: string } | null;
    semester: { name: string } | null;
  };
}

export async function getMyHallTickets(): Promise<ApiResponse<StudentHallTicket[]>> {
  const result = await apiRequest<{ hallTickets: StudentHallTicket[] }>(
    "/api/students/me/hall-tickets"
  );

  return result.success ? { success: true, data: result.data.hallTickets } : result;
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
    { limit: MAX_LIST_LIMIT }
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
