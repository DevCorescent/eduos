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
import { MAX_LIST_LIMIT } from "@/types/api";
import { courseIndex, currentSemester } from "./reference";

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
  // The route joins the course, so the code and name are real values rather
  // than the placeholders this function used to invent. facultyName stays a
  // placeholder deliberately: this endpoint only ever returns the CALLER'S own
  // slots, so naming the lecturer on every row would be repeating who is
  // already logged in, and joining User for it would widen the projection for
  // nothing.
  const result = await apiList<Timetable & { course?: { code: string; name: string } | null }>(
    `/api/timetables/faculty/${facultyId}`,
    "timetables",
    { limit: 100 }
  );
  if (!result.success) return result;

  return {
    success: true,
    data: result.data.items.map(({ course, ...slot }) => ({
      ...slot,
      courseCode: course?.code ?? "—",
      courseName: course?.name ?? "—",
      facultyName: "—",
    })),
  };
}

// --- Attendance -------------------------------------------------------------

/**
 * One student on a class register.
 *
 * Exactly the five fields GET /api/sections/[id]/roster returns. Declared here
 * rather than in types/ because nothing outside this flow consumes it, and a
 * shared name would invite it being widened for some other screen's benefit —
 * which is how a deliberately narrow payload stops being narrow.
 */
export interface RosterStudent {
  studentId: string;
  enrollmentNo: string;
  firstName: string;
  lastName: string;
  status: string;
}

/**
 * The ACTIVE students of one section, for the class a lecturer is marking.
 *
 * NOT listStudents(). That reads /api/students — the institution-wide roster,
 * which is UNIVERSITY_ADMIN-only, so a lecturer received 403 and the register
 * rendered empty. It also returns Student columns alone, so every row it
 * yields is nameless and this service fills the names with empty placeholders;
 * a register keyed on enrollment number is not one a lecturer can take.
 *
 * courseId travels with the section because it is what proves the caller may
 * read this roster at all — a lecturer teaches a COURSE to a SECTION, and the
 * pair is what the route's guard checks. It does not filter the rows.
 */
export async function getSectionRoster(
  sectionId: string,
  courseId: string
): Promise<ApiResponse<RosterStudent[]>> {
  const result = await apiRequest<{ roster: RosterStudent[] }>(
    `/api/sections/${sectionId}/roster`,
    { params: { courseId } }
  );

  return result.success ? { success: true, data: result.data.roster } : result;
}

/**
 * One session's register, for the mark-attendance screen.
 *
 * THE ENDPOINT IGNORES EVERY ONE OF THESE PARAMETERS.
 *   GET /api/attendance deliberately reads no filter — its own handler says so
 *   and explains why: whether `date` names a day or a range, and whether a
 *   filter is required at all, is an open contract question it declines to
 *   settle by implication. So it answers with the TENANT'S WHOLE REGISTER and
 *   the three arguments above travel as documentation of intent.
 *
 *   Left unfiltered that is not merely a wide read, it is a wrong answer. Every
 *   session of a course carries the same students, so the caller's
 *   `new Map(rows.map(r => [r.studentId, ...]))` keeps whichever row happens to
 *   come last — a different DAY's mark. The register then pre-fills from the
 *   wrong session, reports "already marked" for a day nobody has marked, and,
 *   since C13, hands the correction control the wrong attendance id: a lecturer
 *   disputing Monday's absence would have raised a request against a mark from
 *   three weeks earlier.
 *
 *   Narrowed here rather than in the route for the reason getAttendanceReport
 *   above gives: the route's shape is its published contract and other clients
 *   may rely on the unfiltered rows. This function's contract is one session,
 *   so this function is what must honour it.
 *
 * KNOWN LIMIT, STATED RATHER THAN HIDDEN
 *   The narrowing happens after pagination, so it can only see the first
 *   MAX_LIST_LIMIT records of the tenant's attendance. A session older than
 *   that window returns empty — an unmarked register — rather than wrong marks.
 *   Failing to the safe side is the point, but the real repair is a filter
 *   contract on the route.
 */
export async function getSessionAttendance(
  sectionId: string,
  courseId: string,
  date: string
): Promise<ApiResponse<Attendance[]>> {
  const result = await apiList<Attendance>("/api/attendance", "attendance", {
    sectionId,
    courseId,
    date,
    limit: MAX_LIST_LIMIT,
  });

  if (!result.success) return result;

  // date arrives as a full ISO timestamp; Attendance.date is @db.Date, so only
  // the day it names is meaningful on either side.
  const session = result.data.items.filter(
    (row) =>
      row.sectionId === sectionId &&
      row.courseId === courseId &&
      String(row.date).slice(0, 10) === date
  );

  return { success: true, data: session };
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
 * THE ENDPOINT RETURNS RAW ROWS, NOT A SUMMARY.
 *   GET /api/attendance/report/[studentId] answers
 *   `{ attendance: Attendance[] }` — every individual register entry, nested
 *   under a key. This function previously declared the response to be a bare
 *   AttendanceSummary[] and returned it untouched, so callers received an
 *   object where they expected an array and every screen that summed it died
 *   with "summaries.reduce is not a function". The page still answered HTTP
 *   200, because Next.js renders the error boundary with a 200, which is why
 *   this looked like an intermittent display fault rather than a crash.
 *
 *   The aggregation is done here rather than by changing the route, because
 *   the route's shape is its published contract and other clients may rely on
 *   the raw rows.
 *
 * The percentage counts PRESENT and LATE as attended, and EXCUSED too — an
 * authorised absence must not count against a shortage calculation, which is
 * the whole reason the status exists as something other than ABSENT.
 *
 * courseCode and courseName come from the shared catalogue index when the
 * caller may read it. A student may not, so their rows carry an em dash rather
 * than a fabricated label — the same degradation every other student-facing
 * list applies.
 */
/** Bucket key for register entries recorded against no course. */
const UNATTRIBUTED_COURSE = "";

export async function getAttendanceReport(
  studentId: string
): Promise<ApiResponse<AttendanceSummary[]>> {
  const result = await apiRequest<{ attendance: Attendance[] }>(
    `/api/attendance/report/${studentId}`
  );
  if (!result.success) return result;

  const courses = await courseIndex();
  const byCourse = new Map<string, AttendanceSummary>();

  for (const row of result.data.attendance) {
    // Attendance.courseId is nullable in the schema — a register can be taken
    // against a section with no course attached. Those rows are kept under one
    // unattributed bucket rather than dropped: discarding them would quietly
    // shrink totalClasses and inflate every percentage, which on a screen that
    // decides examination eligibility is the worst possible direction to be
    // wrong in.
    const courseId = row.courseId ?? UNATTRIBUTED_COURSE;
    let summary = byCourse.get(courseId);

    if (!summary) {
      const course = row.courseId === null ? undefined : courses.get(row.courseId);
      summary = {
        courseId,
        courseCode: course?.code ?? "—",
        courseName: course?.name ?? (row.courseId === null ? "Unattributed" : "—"),
        totalClasses: 0,
        present: 0,
        absent: 0,
        late: 0,
        percentage: 0,
      };
      byCourse.set(courseId, summary);
    }

    summary.totalClasses += 1;
    if (row.status === "PRESENT") summary.present += 1;
    else if (row.status === "LATE") summary.late += 1;
    else if (row.status === "ABSENT") summary.absent += 1;
  }

  // Computed after tallying, not incrementally: a percentage is a property of
  // the finished count, and updating it per row would leave it correct only by
  // accident on the last iteration.
  for (const summary of byCourse.values()) {
    const attended = summary.totalClasses - summary.absent;
    summary.percentage =
      summary.totalClasses === 0 ? 0 : (attended / summary.totalClasses) * 100;
  }

  return { success: true, data: [...byCourse.values()] };
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

// --- Attendance corrections (PRD §13.2) -------------------------------------

/** One correction request, as the API returns it. */
export interface AttendanceCorrectionRow {
  id: string;
  attendanceId: string;
  currentStatus: string;
  requestedStatus: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedById: string | null;
  requestedAt: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  attendance: {
    id: string;
    date: string;
    status: string;
    sessionType: string;
    courseId: string | null;
    sectionId: string | null;
    student: { id: string; enrollmentNo: string } | null;
  } | null;
}

/** The correction queue, newest first. Optionally narrowed to one status. */
export async function listAttendanceCorrections(
  status?: string
): Promise<ApiResponse<AttendanceCorrectionRow[]>> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const result = await apiRequest<{ requests: AttendanceCorrectionRow[] }>(
    `/api/attendance/corrections${query}`
  );

  return result.success ? { success: true, data: result.data.requests } : result;
}

export interface RaiseAttendanceCorrectionInput {
  attendanceId: string;
  requestedStatus: string;
  reason: string;
}

/**
 * Raise a correction request.
 *
 * The register is NOT changed by this call — the mark keeps its value until a
 * reviewer approves. Nothing here names the requester; the API takes it from
 * the session.
 */
export async function raiseAttendanceCorrection(
  input: RaiseAttendanceCorrectionInput
): Promise<ApiResponse<AttendanceCorrectionRow>> {
  return apiRequest<AttendanceCorrectionRow>("/api/attendance/corrections", {
    method: "POST",
    body: input,
  });
}

/** Approve (applies the change) or reject (changes nothing) one request. */
export async function reviewAttendanceCorrection(
  id: string,
  decision: "APPROVE" | "REJECT",
  note?: string
): Promise<ApiResponse<AttendanceCorrectionRow>> {
  return apiRequest<AttendanceCorrectionRow>(`/api/attendance/corrections/${id}`, {
    method: "PATCH",
    body: { decision, ...(note ? { note } : {}) },
  });
}
