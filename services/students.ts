// ============================================================================
// MODULE : Services — Students
// PURPOSE: Student reads for the university portal.
//
//          A student's name lives on the linked User, not on Student. The
//          LISTING now joins it: GET /api/students selects the five User fields
//          StudentWithUser declares, so listStudents composes a real name
//          instead of the empty placeholders it used to return. That gap was
//          visible as a blank Student column on /students and as a search box
//          labelled "Search by name" that could not match one.
//
//          The DETAIL read below still has the gap — GET /api/students/[id]
//          expands no relation — so getStudent continues to return empty name
//          fields. Closing that is the same one-line join on that route.
// ============================================================================

import type {
  ApiResponse,
  ExamResult,
  ListParams,
  PaginatedResult,
  Student,
  StudentDocument,
  StudentParentWithParent,
  StudentPersonal,
  StudentWithUser,
  Transcript,
  TranscriptRow,
} from "@/types";
import { apiList, apiRequest } from "./client";

/**
 * One row as GET /api/students returns it.
 *
 * Declared here rather than widening the shared `Student` interface: that type
 * documents itself as mirroring the scalar columns, and the DETAIL endpoint
 * still returns exactly those. Only this collection joins the user, so only
 * this call site needs to know.
 */
type StudentListRow = Student & {
  user: StudentWithUser["user"];
};

export async function listStudents(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<StudentWithUser>>> {
  const result = await apiList<StudentListRow>("/api/students", "students", params);
  if (!result.success) return result;

  // `fullName` is flattened alongside the nested user because a table cell and
  // an avatar both want one string — see StudentWithUser. Composed here rather
  // than sent by the API: it is a display convenience derived from two columns,
  // not a column of its own, and the API returns the columns.
  //
  // trim() covers the row whose User has an empty lastName: "Priya " would
  // otherwise render with a trailing space and sort oddly.
  return {
    success: true,
    data: {
      ...result.data,
      items: result.data.items.map((student) => ({
        ...student,
        fullName: `${student.user.firstName} ${student.user.lastName}`.trim(),
      })),
    },
  };
}

export async function getStudent(id: string): Promise<ApiResponse<StudentWithUser>> {
  const result = await apiRequest<Student>(`/api/students/${id}`);
  if (!result.success) return result;

  return {
    success: true,
    data: {
      ...result.data,
      user: {
        id: result.data.userId,
        firstName: "",
        lastName: "",
        email: "",
        avatarUrl: null,
      },
      fullName: "",
    },
  };
}

/**
 * How many students match, without fetching them.
 *
 * Asks for a single row and reads `pagination.total`. Every collection endpoint
 * returns that alongside the rows, so this is one cheap request — as opposed to
 * pulling a page and counting it, which is wrong the moment the result exceeds
 * one page.
 */
/**
 * How many students match, or null when the count could not be read.
 *
 * NULL RATHER THAN 0 ON FAILURE
 *   A caller refused by the API — a role the students collection does not admit
 *   — used to receive 0 here, and 0 is a claim: it says this university has no
 *   students. The dashboard rendered that claim as a stat tile, so a
 *   DEPARTMENT_HOD whose request was answered 403 was shown "0 students" for an
 *   institution with three. null is the honest answer, and formatNumber already
 *   renders it as an em dash — the same treatment courses and fee demands
 *   already received through countOf(), which has always returned null.
 */
export async function countStudents(params?: ListParams): Promise<number | null> {
  const result = await listStudents({ ...params, page: 1, limit: 1 });
  return result.success ? result.data.pagination.total : null;
}

// --- Enrolment --------------------------------------------------------------

/**
 * Enrolling a student is two writes, not one.
 *
 * POST /api/students takes a `userId` — it links an existing User to a new
 * Student row, it does not create the person. So the account is created first
 * and the student record second. That is why the enrolment form asks for a
 * name, an email and a password alongside the academic fields.
 */
export interface EnrolStudentInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
  /**
   * Optional. Omit it and the identifier engine issues one — PRD 51
   * "Automated student IDs". Supplying a value keeps the manual path, which the
   * API still accepts for migrated records.
   */
  enrollmentNo?: string;
  programmeId?: string;
  batchId?: string;
  sectionId?: string;
  specialisationId?: string;
  currentSemester?: number;
  admissionDate: string;
}

export async function enrolStudent(
  input: EnrolStudentInput
): Promise<ApiResponse<Student>> {
  // Live: the same two steps, in the same order.
  const account = await apiRequest<{ id: string }>("/api/users", {
    method: "POST",
    body: {
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
    },
  });
  if (!account.success) return account;

  return apiRequest<Student>("/api/students", {
    method: "POST",
    body: {
      userId: account.data.id,
      enrollmentNo: input.enrollmentNo,
      programmeId: input.programmeId || undefined,
      batchId: input.batchId || undefined,
      sectionId: input.sectionId || undefined,
      specialisationId: input.specialisationId || undefined,
      currentSemester: input.currentSemester,
      admissionDate: input.admissionDate,
    },
  });
}

export interface UpdateStudentInput {
  enrollmentNo?: string;
  programmeId?: string;
  batchId?: string;
  sectionId?: string;
  currentSemester?: number;
  status?: Student["status"];
}

export async function updateStudent(
  id: string,
  input: UpdateStudentInput
): Promise<ApiResponse<Student>> {
  return apiRequest<Student>(`/api/students/${id}`, { method: "PATCH", body: input });
}

// --- Personal details -------------------------------------------------------

export async function getStudentPersonal(
  studentId: string
): Promise<ApiResponse<StudentPersonal | null>> {
  const result = await apiRequest<StudentPersonal>(`/api/students/${studentId}/personal`);
  if (!result.success && result.code === "NOT_FOUND") {
    return { success: true, data: null };
  }
  return result.success ? { success: true, data: result.data } : result;
}

// --- Documents --------------------------------------------------------------

export async function listStudentDocuments(
  studentId: string,
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<StudentDocument>>> {
  return apiList<StudentDocument>(
    `/api/students/${studentId}/documents`,
    "documents",
    params
  );
}

// --- Guardians --------------------------------------------------------------

export async function listStudentParents(
  studentId: string,
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<StudentParentWithParent>>> {
  return apiList<StudentParentWithParent>(
    `/api/students/${studentId}/parents`,
    "parents",
    params
  );
}

// --- Transcript -------------------------------------------------------------

/**
 * A student's results, joined to their examination, course and semester.
 *
 * ACCESS: UNIVERSITY_ADMIN only. A student reading their own results goes
 * through getStudentExamResults below — this endpoint would answer 403.
 *
 * GET /api/students/[id]/transcript expands the examination, its course and its
 * semester, and lifts maxMarks and passMark to the top of each row. This only
 * flattens that nesting so a table column can name a single field.
 *
 * An earlier version believed the endpoint expanded nothing and overwrote every
 * joined value with a placeholder — including a fixed maxMarks of 100 and a
 * type of INTERNAL. Those are not placeholders but wrong answers: the first
 * drove the percentage column, the second mislabelled every external paper.
 * Nothing is substituted here.
 *
 * Unpublished results are excluded by the route: a mark that has not been
 * released is not part of the transcript.
 */
export async function getStudentTranscript(
  studentId: string
): Promise<ApiResponse<TranscriptRow[]>> {
  const result = await apiRequest<Transcript>(`/api/students/${studentId}/transcript`);
  if (!result.success) return result;

  return {
    success: true,
    data: result.data.results.map((row) => ({
      id: row.id,
      examinationId: row.examination.id,
      studentId,
      marksObtained: row.marksObtained,
      grade: row.grade,
      gradePoint: row.gradePoint,
      isPassed: row.isPassed,
      isAbsent: row.isAbsent,
      remarks: row.remarks,
      publishedAt: row.publishedAt,
      // The route selects no row timestamps for a transcript line, so these
      // carry the examination date rather than a fabricated "now".
      createdAt: row.examination.date,
      updatedAt: row.examination.date,
      examinationTitle: row.examination.title,
      examinationType: row.examination.type,
      maxMarks: row.maxMarks,
      courseCode: row.course.code,
      courseName: row.course.name,
      semesterId: row.semester.id,
      semesterName: row.semester.name,
    })),
  };
}

/**
 * A student's own published examination results.
 *
 * ACCESS: UNIVERSITY_ADMIN · FACULTY for any student, STUDENT for themselves.
 * This is the only results endpoint a student may call — /transcript above
 * requires UNIVERSITY_ADMIN, and pointing the student portal at it made the
 * whole Results screen a 403 for every student.
 *
 * The trade is detail: this route expands no relation, so each row names its
 * examination by id alone. The screen shows what the payload actually supports
 * rather than inventing course and semester labels to fill its columns.
 */
export async function getStudentExamResults(
  studentId: string
): Promise<ApiResponse<ExamResult[]>> {
  const result = await apiRequest<{ results: ExamResult[] }>(
    `/api/students/${studentId}/results`
  );
  if (!result.success) return result;

  return { success: true, data: result.data.results };
}
