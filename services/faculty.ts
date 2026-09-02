// ============================================================================
// MODULE : Services — Faculty & Employees
// PURPOSE: Staff reads for the university portal.
//
//          Same name-composition gap as students: GET /api/faculty and
//          /api/employees select scalar columns only, so neither returns a
//          name. See services/students.ts for the full note — the fix is the
//          same `include: { user: ... }` on the route.
// ============================================================================

import type {
  ApiResponse,
  Employee,
  EmployeeWithUser,
  FacultyAssignmentRow,
  FacultyCourseAssignment,
  FacultyMember,
  FacultyWithUser,
  ListParams,
  PaginatedResult,
} from "@/types";
import { apiList, apiRequest } from "./client";

/** Placeholder user block for live rows that carry no name. */
function placeholderUser(userId: string) {
  return { id: userId, firstName: "", lastName: "", email: "", avatarUrl: null };
}

export async function listFaculty(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<FacultyWithUser>>> {
  const result = await apiList<FacultyMember>("/api/faculty", "faculty", params);
  if (!result.success) return result;

  return {
    success: true,
    data: {
      ...result.data,
      items: result.data.items.map((faculty) => ({
        ...faculty,
        user: placeholderUser(faculty.userId),
        fullName: "",
      })),
    },
  };
}

export async function getFaculty(id: string): Promise<ApiResponse<FacultyWithUser>> {
  const result = await apiRequest<FacultyMember>(`/api/faculty/${id}`);
  if (!result.success) return result;

  return {
    success: true,
    data: {
      ...result.data,
      user: placeholderUser(result.data.userId),
      fullName: "",
    },
  };
}

/**
 * How many match, or null when the count could not be read. See countStudents
 * in services/students.ts: 0 asserts an empty institution, and a caller the API
 * refused has learned nothing about how many there are.
 */
export async function countFaculty(params?: ListParams): Promise<number | null> {
  const result = await listFaculty({ ...params, page: 1, limit: 1 });
  return result.success ? result.data.pagination.total : null;
}

// --- Employees --------------------------------------------------------------

export async function listEmployees(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<EmployeeWithUser>>> {
  const result = await apiList<Employee>("/api/employees", "employees", params);
  if (!result.success) return result;

  return {
    success: true,
    data: {
      ...result.data,
      items: result.data.items.map((employee) => ({
        ...employee,
        user: placeholderUser(employee.userId),
        fullName: "",
      })),
    },
  };
}

/**
 * How many match, or null when the count could not be read. See countStudents
 * in services/students.ts: 0 asserts an empty institution, and a caller the API
 * refused has learned nothing about how many there are.
 */
export async function countEmployees(params?: ListParams): Promise<number | null> {
  const result = await listEmployees({ ...params, page: 1, limit: 1 });
  return result.success ? result.data.pagination.total : null;
}

// --- Staff creation ---------------------------------------------------------

/**
 * Adding a staff member is two writes, exactly like enrolling a student.
 *
 * POST /api/faculty takes a `userId` — it links an existing User to a new
 * FacultyMember row rather than creating the person. The account is written
 * first and the staff record second, which is why the form asks for a name and
 * an email alongside the employment fields.
 */
export interface AddFacultyInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
  /**
   * Optional. Omit it and the identifier engine issues one — PRD 51
   * "Automated employee IDs". Supplying a value keeps the manual path.
   */
  employeeId?: string;
  departmentId?: string;
  designation?: string;
  qualification?: string;
  specialization?: string;
  experience?: number;
  joinDate: string;
}

export async function addFaculty(
  input: AddFacultyInput
): Promise<ApiResponse<FacultyMember>> {
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

  return apiRequest<FacultyMember>("/api/faculty", {
    method: "POST",
    body: {
      userId: account.data.id,
      employeeId: input.employeeId,
      departmentId: input.departmentId || undefined,
      designation: input.designation || undefined,
      qualification: input.qualification || undefined,
      specialization: input.specialization || undefined,
      experience: input.experience,
      joinDate: input.joinDate,
    },
  });
}

export interface UpdateFacultyInput {
  employeeId?: string;
  departmentId?: string;
  designation?: string;
  qualification?: string;
  specialization?: string;
  experience?: number;
  status?: FacultyMember["status"];
}

export async function updateFaculty(
  id: string,
  input: UpdateFacultyInput
): Promise<ApiResponse<FacultyMember>> {
  return apiRequest<FacultyMember>(`/api/faculty/${id}`, { method: "PATCH", body: input });
}

export interface AddEmployeeInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
  /**
   * Optional. Omit it and the identifier engine issues one — PRD 51
   * "Automated employee IDs". Supplying a value keeps the manual path.
   */
  employeeId?: string;
  departmentId?: string;
  designation?: string;
  type?: Employee["type"];
  joinDate: string;
}

export async function addEmployee(input: AddEmployeeInput): Promise<ApiResponse<Employee>> {
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

  return apiRequest<Employee>("/api/employees", {
    method: "POST",
    body: {
      userId: account.data.id,
      employeeId: input.employeeId,
      departmentId: input.departmentId || undefined,
      designation: input.designation || undefined,
      type: input.type,
      joinDate: input.joinDate,
    },
  });
}

export interface UpdateEmployeeInput {
  employeeId?: string;
  departmentId?: string;
  designation?: string;
  type?: Employee["type"];
  status?: Employee["status"];
}

export async function updateEmployee(
  id: string,
  input: UpdateEmployeeInput
): Promise<ApiResponse<Employee>> {
  return apiRequest<Employee>(`/api/employees/${id}`, { method: "PATCH", body: input });
}

// --- Teaching assignments ---------------------------------------------------

/**
 * What one lecturer teaches, joined to the course, section and semester.
 *
 * The endpoint returns bare ids, which are unreadable on screen, so the joins
 * are done here — the same pattern as the student transcript.
 */
export async function listFacultyAssignments(
  facultyId: string,
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<FacultyAssignmentRow>>> {
  const result = await apiList<FacultyCourseAssignment>(
    `/api/faculty/${facultyId}/assignments`,
    "assignments",
    params
  );
  if (!result.success) return result;

  // Live rows carry ids only — the route expands no relation. Labelled as
  // unavailable rather than dropped, so the assignment is still listed.
  return {
    success: true,
    data: {
      ...result.data,
      items: result.data.items.map((assignment) => ({
        ...assignment,
        courseCode: "—",
        courseName: "—",
        courseCredits: 0,
        sectionName: null,
        semesterName: null,
      })),
    },
  };
}

export interface AssignCourseInput {
  courseId: string;
  sectionId?: string;
  semesterId?: string;
}

export async function assignCourse(
  facultyId: string,
  input: AssignCourseInput
): Promise<ApiResponse<FacultyCourseAssignment>> {
  return apiRequest<FacultyCourseAssignment>(`/api/faculty/${facultyId}/assignments`, {
    method: "POST",
    body: input,
  });
}

/**
 * Retire an assignment.
 *
 * Flips isActive rather than deleting: past workload is what faculty-load
 * reporting and appraisal are computed from, and removing the row would erase
 * the fact that the course was ever taught. There is no DELETE endpoint for
 * this either, which is consistent with that.
 */
export async function retireAssignment(id: string): Promise<ApiResponse<null>> {
  return apiRequest<null>(`/api/faculty/assignments/${id}`, {
    method: "PATCH",
    body: { isActive: false },
  });
}
