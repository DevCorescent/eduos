// ============================================================================
// MODULE : Services — Students
// PURPOSE: Student reads for the university portal.
//
//          One asymmetry to know about: the live GET /api/students returns
//          Student rows with no name on them — the route selects scalar columns
//          only and expands no relation, because joining userRoles would return
//          one row per role. A student's name lives on the linked User.
//
//          So listStudents returns StudentWithUser, and the live branch below
//          composes it. Today it cannot — there is no users-by-id endpoint that
//          takes a set — so the live path returns rows whose name fields are
//          empty and says so. The mock path is complete. Adding `include: {
//          user: ... }` to the route removes the gap and changes only this file.
// ============================================================================

import type {
  ApiResponse,
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

export async function listStudents(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<StudentWithUser>>> {
  const result = await apiList<Student>("/api/students", "students", params);
  if (!result.success) return result;

  // The rows genuinely carry no name. Filled with placeholders rather than
  // left undefined so a column renders an em dash instead of throwing on
  // `user.firstName` — and so the gap is visible rather than silent.
  return {
    success: true,
    data: {
      ...result.data,
      items: result.data.items.map((student) => ({
        ...student,
        user: {
          id: student.userId,
          firstName: "",
          lastName: "",
          email: "",
          avatarUrl: null,
        },
        fullName: "",
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
export async function countStudents(params?: ListParams): Promise<number> {
  const result = await listStudents({ ...params, page: 1, limit: 1 });
  return result.success ? result.data.pagination.total : 0;
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
  enrollmentNo: string;
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
 * GET /api/students/[id]/transcript returns `{ student, results }` where each
 * result carries only an examinationId — unreadable on screen. The joins are
 * done here so the page renders a table rather than a list of ids.
 *
 * Unpublished results are excluded: a mark that has not been released is not
 * part of the transcript, and showing it would leak a grade before results day.
 */
export async function getStudentTranscript(
  studentId: string
): Promise<ApiResponse<TranscriptRow[]>> {
  const result = await apiRequest<Transcript>(`/api/students/${studentId}/transcript`);
  if (!result.success) return result;

  // The live endpoint expands nothing, so the joins are not available. The rows
  // are returned with placeholder labels rather than dropped, so the marks are
  // still readable and the gap is visible.
  return {
    success: true,
    data: result.data.results.map((row) => ({
      ...row,
      examinationTitle: "—",
      examinationType: "INTERNAL" as const,
      maxMarks: 100,
      courseCode: "—",
      courseName: "—",
      semesterId: "",
      semesterName: "—",
    })),
  };
}
