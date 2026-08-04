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
import { USE_MOCKS } from "./config";
import { createUser } from "./users";
import { MOCK_TENANT_ID } from "@/mock/data/context";
import { SEMESTER_BY_ID } from "@/mock/data/academics";
import { COURSE_BY_ID } from "@/mock/data/courses";
import {
  EXAMINATION_BY_ID,
  MOCK_STUDENT_DOCUMENTS,
  MOCK_STUDENT_PARENTS,
  PARENT_BY_ID,
  PERSONAL_BY_STUDENT,
  RESULTS_BY_STUDENT,
} from "@/mock/data/student-details";
import { studentStore } from "@/mock/studentStore";
import { mockFail, mockList, mockOk } from "@/mock/utils";

export async function listStudents(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<StudentWithUser>>> {
  if (USE_MOCKS) {
    // Read from the store, not the raw fixture, so a student enrolled this
    // session appears in the register immediately.
    return mockList(studentStore.all(), params, {
      // fullName is the flattened join; enrollmentNo is what staff actually
      // search by day to day.
      searchFields: ["fullName", "enrollmentNo"],
      filterKeys: ["status", "programmeId", "batchId", "sectionId"],
    });
  }

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
  if (USE_MOCKS) {
    const student = studentStore.find(id);
    return student
      ? mockOk(student)
      : mockFail<StudentWithUser>("Student not found", "NOT_FOUND");
  }

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
  if (USE_MOCKS) {
    if (
      studentStore.all().some(
        (s) => s.enrollmentNo.toLowerCase() === input.enrollmentNo.trim().toLowerCase()
      )
    ) {
      return mockFail<Student>("Enrollment number already in use", "CONFLICT");
    }

    // The account first, exactly as the live flow must: a Student with no User
    // cannot sign in, and the schema makes userId required and unique.
    const account = await createUser({
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
    });

    if (!account.success) {
      return account.code === "CONFLICT"
        ? mockFail<Student>("Email already in use", "CONFLICT")
        : mockFail<Student>(account.error, account.code);
    }

    const timestamp = new Date().toISOString();
    const student: Student = {
      id: studentStore.nextId(),
      tenantId: MOCK_TENANT_ID,
      userId: account.data.id,
      enrollmentNo: input.enrollmentNo.trim(),
      programmeId: input.programmeId || null,
      batchId: input.batchId || null,
      sectionId: input.sectionId || null,
      specialisationId: input.specialisationId || null,
      currentSemester: input.currentSemester ?? 1,
      status: "ACTIVE",
      admissionDate: new Date(input.admissionDate).toISOString(),
      graduationDate: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    studentStore.insert({
      ...student,
      user: {
        id: account.data.id,
        firstName: account.data.firstName,
        lastName: account.data.lastName,
        email: account.data.email,
        avatarUrl: null,
      },
      fullName: `${account.data.firstName} ${account.data.lastName}`,
    });

    return mockOk(student, "Student enrolled");
  }

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
  if (USE_MOCKS) {
    const duplicate = studentStore
      .all()
      .some(
        (s) =>
          s.id !== id &&
          input.enrollmentNo &&
          s.enrollmentNo.toLowerCase() === input.enrollmentNo.toLowerCase()
      );
    if (duplicate) return mockFail<Student>("Enrollment number already in use", "CONFLICT");

    const updated = studentStore.update(id, {
      ...input,
      // A cleared select sends "", which must become null on a nullable column
      // rather than an empty-string foreign key.
      ...(input.programmeId !== undefined ? { programmeId: input.programmeId || null } : {}),
      ...(input.batchId !== undefined ? { batchId: input.batchId || null } : {}),
      ...(input.sectionId !== undefined ? { sectionId: input.sectionId || null } : {}),
      updatedAt: new Date().toISOString(),
    });

    return updated
      ? mockOk(updated as Student, "Student updated")
      : mockFail<Student>("Student not found", "NOT_FOUND");
  }
  return apiRequest<Student>(`/api/students/${id}`, { method: "PATCH", body: input });
}

// --- Personal details -------------------------------------------------------

export async function getStudentPersonal(
  studentId: string
): Promise<ApiResponse<StudentPersonal | null>> {
  if (USE_MOCKS) {
    // null, not a 404: the endpoint returns the record if it exists, and a
    // student who has not completed their details is a normal state the
    // Personal tab renders a prompt for.
    return mockOk(PERSONAL_BY_STUDENT.get(studentId) ?? null);
  }

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
  if (USE_MOCKS) {
    const rows = MOCK_STUDENT_DOCUMENTS.filter((doc) => doc.studentId === studentId);
    return mockList(rows, params, {
      sort: (a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt),
    });
  }
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
  if (USE_MOCKS) {
    const rows = MOCK_STUDENT_PARENTS.filter((link) => link.studentId === studentId)
      .map((link) => {
        const parent = PARENT_BY_ID.get(link.parentId);
        return parent ? { ...link, parent } : null;
      })
      .filter((row): row is StudentParentWithParent => row !== null)
      // Primary contact first — it is the one anybody calling reads.
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

    return mockList(rows, params);
  }
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
  if (USE_MOCKS) {
    const rows = (RESULTS_BY_STUDENT.get(studentId) ?? [])
      .filter((result) => result.publishedAt !== null)
      .map((result): TranscriptRow | null => {
        const exam = EXAMINATION_BY_ID.get(result.examinationId);
        if (!exam) return null;

        const course = COURSE_BY_ID.get(exam.courseId);
        const semester = SEMESTER_BY_ID.get(exam.semesterId);

        return {
          ...result,
          examinationTitle: exam.title,
          examinationType: exam.type,
          maxMarks: exam.maxMarks,
          courseCode: course?.code ?? "—",
          courseName: course?.name ?? "—",
          semesterId: exam.semesterId,
          semesterName: semester?.name ?? "—",
        };
      })
      .filter((row): row is TranscriptRow => row !== null)
      .sort(
        (a, b) =>
          a.semesterName.localeCompare(b.semesterName) ||
          a.courseCode.localeCompare(b.courseCode)
      );

    return mockOk(rows);
  }

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
