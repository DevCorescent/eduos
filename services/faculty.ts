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
import { USE_MOCKS } from "./config";
import { createUser } from "./users";
import { MOCK_TENANT_ID } from "@/mock/data/context";
import { SECTION_BY_ID, SEMESTER_BY_ID } from "@/mock/data/academics";
import { COURSE_BY_ID } from "@/mock/data/courses";
import { assignmentStore, employeeStore, facultyStore } from "@/mock/staffStores";
import { mockFail, mockList, mockOk } from "@/mock/utils";

const now = () => new Date().toISOString();

/** Placeholder user block for live rows that carry no name. */
function placeholderUser(userId: string) {
  return { id: userId, firstName: "", lastName: "", email: "", avatarUrl: null };
}

export async function listFaculty(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<FacultyWithUser>>> {
  if (USE_MOCKS) {
    return mockList(facultyStore.all(), params, {
      searchFields: ["fullName", "employeeId", "designation"],
      filterKeys: ["status", "departmentId"],
    });
  }

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
  if (USE_MOCKS) {
    const faculty = facultyStore.find(id);
    return faculty
      ? mockOk(faculty)
      : mockFail<FacultyWithUser>("Faculty member not found", "NOT_FOUND");
  }

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

export async function countFaculty(params?: ListParams): Promise<number> {
  const result = await listFaculty({ ...params, page: 1, limit: 1 });
  return result.success ? result.data.pagination.total : 0;
}

// --- Employees --------------------------------------------------------------

export async function listEmployees(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<EmployeeWithUser>>> {
  if (USE_MOCKS) {
    return mockList(employeeStore.all(), params, {
      searchFields: ["fullName", "employeeId", "designation"],
      filterKeys: ["status", "type", "departmentId"],
    });
  }

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

export async function countEmployees(params?: ListParams): Promise<number> {
  const result = await listEmployees({ ...params, page: 1, limit: 1 });
  return result.success ? result.data.pagination.total : 0;
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
  employeeId: string;
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
  if (USE_MOCKS) {
    // @@unique([tenantId, employeeId]) — the staff number is the conflict the
    // form has to report against its own field.
    if (
      facultyStore
        .all()
        .some((f) => f.employeeId.toLowerCase() === input.employeeId.trim().toLowerCase())
    ) {
      return mockFail<FacultyMember>("Employee ID already in use", "CONFLICT");
    }

    const account = await createUser({
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
    });

    if (!account.success) {
      return account.code === "CONFLICT"
        ? mockFail<FacultyMember>("Email already in use", "CONFLICT")
        : mockFail<FacultyMember>(account.error, account.code);
    }

    const timestamp = now();
    const faculty: FacultyMember = {
      id: facultyStore.nextId(),
      tenantId: MOCK_TENANT_ID,
      userId: account.data.id,
      employeeId: input.employeeId.trim(),
      departmentId: input.departmentId || null,
      designation: input.designation || null,
      qualification: input.qualification || null,
      specialization: input.specialization || null,
      experience: input.experience ?? null,
      status: "ACTIVE",
      joinDate: new Date(input.joinDate).toISOString(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    facultyStore.insert({
      ...faculty,
      user: {
        id: account.data.id,
        firstName: account.data.firstName,
        lastName: account.data.lastName,
        email: account.data.email,
        avatarUrl: null,
      },
      fullName: `${account.data.firstName} ${account.data.lastName}`,
    });

    return mockOk(faculty, "Faculty member added");
  }

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
  if (USE_MOCKS) {
    const duplicate = facultyStore
      .all()
      .some(
        (f) =>
          f.id !== id &&
          input.employeeId &&
          f.employeeId.toLowerCase() === input.employeeId.toLowerCase()
      );
    if (duplicate) return mockFail<FacultyMember>("Employee ID already in use", "CONFLICT");

    const updated = facultyStore.update(id, {
      ...input,
      // A cleared select is "", which must land as null on a nullable column.
      ...(input.departmentId !== undefined
        ? { departmentId: input.departmentId || null }
        : {}),
      updatedAt: now(),
    });

    return updated
      ? mockOk(updated as FacultyMember, "Faculty member updated")
      : mockFail<FacultyMember>("Faculty member not found", "NOT_FOUND");
  }
  return apiRequest<FacultyMember>(`/api/faculty/${id}`, { method: "PATCH", body: input });
}

export interface AddEmployeeInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
  employeeId: string;
  departmentId?: string;
  designation?: string;
  type?: Employee["type"];
  joinDate: string;
}

export async function addEmployee(input: AddEmployeeInput): Promise<ApiResponse<Employee>> {
  if (USE_MOCKS) {
    if (
      employeeStore
        .all()
        .some((e) => e.employeeId.toLowerCase() === input.employeeId.trim().toLowerCase())
    ) {
      return mockFail<Employee>("Employee ID already in use", "CONFLICT");
    }

    const account = await createUser({
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
    });

    if (!account.success) {
      return account.code === "CONFLICT"
        ? mockFail<Employee>("Email already in use", "CONFLICT")
        : mockFail<Employee>(account.error, account.code);
    }

    const timestamp = now();
    const employee: Employee = {
      id: employeeStore.nextId(),
      tenantId: MOCK_TENANT_ID,
      userId: account.data.id,
      employeeId: input.employeeId.trim(),
      departmentId: input.departmentId || null,
      designation: input.designation || null,
      type: input.type ?? "NON_TEACHING",
      status: "ACTIVE",
      joinDate: new Date(input.joinDate).toISOString(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    employeeStore.insert({
      ...employee,
      user: {
        id: account.data.id,
        firstName: account.data.firstName,
        lastName: account.data.lastName,
        email: account.data.email,
        avatarUrl: null,
      },
      fullName: `${account.data.firstName} ${account.data.lastName}`,
    });

    return mockOk(employee, "Employee added");
  }

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
  if (USE_MOCKS) {
    const duplicate = employeeStore
      .all()
      .some(
        (e) =>
          e.id !== id &&
          input.employeeId &&
          e.employeeId.toLowerCase() === input.employeeId.toLowerCase()
      );
    if (duplicate) return mockFail<Employee>("Employee ID already in use", "CONFLICT");

    const updated = employeeStore.update(id, {
      ...input,
      ...(input.departmentId !== undefined
        ? { departmentId: input.departmentId || null }
        : {}),
      updatedAt: now(),
    });

    return updated
      ? mockOk(updated as Employee, "Employee updated")
      : mockFail<Employee>("Employee not found", "NOT_FOUND");
  }
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
  if (USE_MOCKS) {
    const rows: FacultyAssignmentRow[] = assignmentStore
      .all()
      .filter((assignment) => assignment.facultyId === facultyId)
      .map((assignment) => {
        const course = COURSE_BY_ID.get(assignment.courseId);
        const section = assignment.sectionId
          ? SECTION_BY_ID.get(assignment.sectionId)
          : undefined;
        const semester = assignment.semesterId
          ? SEMESTER_BY_ID.get(assignment.semesterId)
          : undefined;

        return {
          ...assignment,
          courseCode: course?.code ?? "—",
          courseName: course?.name ?? "—",
          courseCredits: course?.credits ?? 0,
          sectionName: section ? `Section ${section.name}` : null,
          semesterName: semester?.name ?? null,
        };
      });

    return mockList(rows, params, {
      sort: (a, b) => a.courseCode.localeCompare(b.courseCode),
    });
  }

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
  if (USE_MOCKS) {
    // @@unique([facultyId, courseId, sectionId, semesterId]) — the same
    // lecturer may teach one course to several sections, but not the identical
    // combination twice.
    const duplicate = assignmentStore
      .all()
      .some(
        (a) =>
          a.facultyId === facultyId &&
          a.courseId === input.courseId &&
          (a.sectionId ?? null) === (input.sectionId || null) &&
          (a.semesterId ?? null) === (input.semesterId || null)
      );

    if (duplicate) {
      return mockFail<FacultyCourseAssignment>(
        "This course is already assigned for that section and semester",
        "CONFLICT"
      );
    }

    return mockOk(
      assignmentStore.insert({
        id: assignmentStore.nextId(),
        tenantId: MOCK_TENANT_ID,
        facultyId,
        courseId: input.courseId,
        sectionId: input.sectionId || null,
        semesterId: input.semesterId || null,
        isActive: true,
        createdAt: now(),
      }),
      "Course assigned"
    );
  }

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
  if (USE_MOCKS) {
    const updated = assignmentStore.update(id, { isActive: false });
    return updated
      ? mockOk(null, "Assignment retired")
      : mockFail<null>("Assignment not found", "NOT_FOUND");
  }

  return apiRequest<null>(`/api/faculty/assignments/${id}`, {
    method: "PATCH",
    body: { isActive: false },
  });
}
