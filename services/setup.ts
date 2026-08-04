// ============================================================================
// MODULE : Services — Academic Setup
// PURPOSE: CRUD for the organisational tree: campuses, schools, departments,
//          programmes and specialisations.
//
//          Each entity follows the same four-function shape (list / create /
//          update / remove) because the backend does. They are written out
//          rather than generated from a factory: the input types differ per
//          entity, and a generic `crud<T>()` would have to erase them to
//          Record<string, unknown> — trading the one thing this layer exists to
//          guarantee, which is that a page cannot send a field the API rejects.
//
//          Delete is a real capability here, unlike on the platform side: the
//          routes expose DELETE for campuses, schools, departments and
//          programmes, and each returns 409 when the row still has children.
// ============================================================================

import type {
  ApiResponse,
  Campus,
  Department,
  ListParams,
  PaginatedResult,
  Programme,
  School,
  Specialisation,
} from "@/types";
import { apiList, apiRequest } from "./client";
import { USE_MOCKS } from "./config";
import { MOCK_TENANT_ID } from "@/mock/data/context";
import {
  campusStore,
  departmentStore,
  programmeStore,
  schoolStore,
  specialisationStore,
} from "@/mock/stores";
import { mockFail, mockList, mockOk } from "@/mock/utils";

/** Now, as an ISO string — what the API stamps on a created or updated row. */
const now = () => new Date().toISOString();

// --- Campuses ---------------------------------------------------------------

export interface CampusInput {
  name: string;
  code: string;
  phone?: string;
  email?: string;
  isMain?: boolean;
}

export async function listCampuses(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<Campus>>> {
  if (USE_MOCKS) {
    return mockList(campusStore.all(), params, { searchFields: ["name", "code"] });
  }
  return apiList<Campus>("/api/campuses", "campuses", params);
}

export async function createCampus(input: CampusInput): Promise<ApiResponse<Campus>> {
  if (USE_MOCKS) {
    // Campus.code is unique per tenant — @@unique([tenantId, code]) — and a
    // clash is the 409 the form has to render against its code field.
    if (campusStore.all().some((c) => c.code.toLowerCase() === input.code.toLowerCase())) {
      return mockFail<Campus>("Campus code already in use", "CONFLICT");
    }

    const timestamp = now();
    return mockOk(
      campusStore.insert({
        id: campusStore.nextId(),
        tenantId: MOCK_TENANT_ID,
        name: input.name,
        code: input.code,
        address: null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        isMain: input.isMain ?? false,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      "Campus created"
    );
  }
  return apiRequest<Campus>("/api/campuses", { method: "POST", body: input });
}

export async function updateCampus(
  id: string,
  input: Partial<CampusInput>
): Promise<ApiResponse<Campus>> {
  if (USE_MOCKS) {
    const duplicate = campusStore
      .all()
      .some((c) => c.id !== id && input.code && c.code.toLowerCase() === input.code.toLowerCase());
    if (duplicate) return mockFail<Campus>("Campus code already in use", "CONFLICT");

    const updated = campusStore.update(id, { ...input, updatedAt: now() });
    return updated ? mockOk(updated, "Campus updated") : mockFail<Campus>("Campus not found", "NOT_FOUND");
  }
  return apiRequest<Campus>(`/api/campuses/${id}`, { method: "PATCH", body: input });
}

export async function deleteCampus(id: string): Promise<ApiResponse<null>> {
  if (USE_MOCKS) {
    // Mirrors the route's own guard: a campus with schools or departments
    // cannot be removed, because the rows beneath it would be orphaned.
    const hasChildren =
      schoolStore.all().some((s) => s.campusId === id) ||
      departmentStore.all().some((d) => d.campusId === id);
    if (hasChildren) {
      return mockFail<null>("Campus still has schools or departments", "CONFLICT");
    }

    return campusStore.remove(id)
      ? mockOk(null, "Campus deleted")
      : mockFail<null>("Campus not found", "NOT_FOUND");
  }
  return apiRequest<null>(`/api/campuses/${id}`, { method: "DELETE" });
}

// --- Schools ----------------------------------------------------------------

export interface SchoolInput {
  campusId: string;
  name: string;
  code: string;
  deanName?: string;
  email?: string;
}

export async function listSchools(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<School>>> {
  if (USE_MOCKS) {
    return mockList(schoolStore.all(), params, {
      searchFields: ["name", "code"],
      filterKeys: ["campusId"],
    });
  }
  return apiList<School>("/api/schools", "schools", params);
}

export async function createSchool(input: SchoolInput): Promise<ApiResponse<School>> {
  if (USE_MOCKS) {
    if (schoolStore.all().some((s) => s.code.toLowerCase() === input.code.toLowerCase())) {
      return mockFail<School>("School code already in use", "CONFLICT");
    }

    const timestamp = now();
    return mockOk(
      schoolStore.insert({
        id: schoolStore.nextId(),
        tenantId: MOCK_TENANT_ID,
        campusId: input.campusId,
        name: input.name,
        code: input.code,
        deanName: input.deanName ?? null,
        email: input.email ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      "School created"
    );
  }
  return apiRequest<School>("/api/schools", { method: "POST", body: input });
}

export async function updateSchool(
  id: string,
  input: Partial<SchoolInput>
): Promise<ApiResponse<School>> {
  if (USE_MOCKS) {
    const updated = schoolStore.update(id, { ...input, updatedAt: now() });
    return updated ? mockOk(updated, "School updated") : mockFail<School>("School not found", "NOT_FOUND");
  }
  return apiRequest<School>(`/api/schools/${id}`, { method: "PATCH", body: input });
}

export async function deleteSchool(id: string): Promise<ApiResponse<null>> {
  if (USE_MOCKS) {
    if (departmentStore.all().some((d) => d.schoolId === id)) {
      return mockFail<null>("School still has departments", "CONFLICT");
    }
    return schoolStore.remove(id)
      ? mockOk(null, "School deleted")
      : mockFail<null>("School not found", "NOT_FOUND");
  }
  return apiRequest<null>(`/api/schools/${id}`, { method: "DELETE" });
}

// --- Departments ------------------------------------------------------------

export interface DepartmentInput {
  campusId: string;
  schoolId?: string;
  name: string;
  code: string;
  hodName?: string;
  email?: string;
}

export async function listDepartments(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<Department>>> {
  if (USE_MOCKS) {
    return mockList(departmentStore.all(), params, {
      searchFields: ["name", "code"],
      filterKeys: ["campusId", "schoolId"],
    });
  }
  return apiList<Department>("/api/departments", "departments", params);
}

export async function createDepartment(
  input: DepartmentInput
): Promise<ApiResponse<Department>> {
  if (USE_MOCKS) {
    if (departmentStore.all().some((d) => d.code.toLowerCase() === input.code.toLowerCase())) {
      return mockFail<Department>("Department code already in use", "CONFLICT");
    }

    const timestamp = now();
    return mockOk(
      departmentStore.insert({
        id: departmentStore.nextId(),
        tenantId: MOCK_TENANT_ID,
        campusId: input.campusId,
        // Department.schoolId is nullable — a standalone administrative
        // department belongs to a campus but to no school.
        schoolId: input.schoolId || null,
        name: input.name,
        code: input.code,
        hodName: input.hodName ?? null,
        email: input.email ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      "Department created"
    );
  }
  return apiRequest<Department>("/api/departments", { method: "POST", body: input });
}

export async function updateDepartment(
  id: string,
  input: Partial<DepartmentInput>
): Promise<ApiResponse<Department>> {
  if (USE_MOCKS) {
    const updated = departmentStore.update(id, {
      ...input,
      // An empty selection means "no school", which is null on the column —
      // not the empty string the <Select> hands back.
      ...(input.schoolId !== undefined ? { schoolId: input.schoolId || null } : {}),
      updatedAt: now(),
    });
    return updated
      ? mockOk(updated, "Department updated")
      : mockFail<Department>("Department not found", "NOT_FOUND");
  }
  return apiRequest<Department>(`/api/departments/${id}`, { method: "PATCH", body: input });
}

export async function deleteDepartment(id: string): Promise<ApiResponse<null>> {
  if (USE_MOCKS) {
    if (programmeStore.all().some((p) => p.departmentId === id)) {
      return mockFail<null>("Department still has programmes", "CONFLICT");
    }
    return departmentStore.remove(id)
      ? mockOk(null, "Department deleted")
      : mockFail<null>("Department not found", "NOT_FOUND");
  }
  return apiRequest<null>(`/api/departments/${id}`, { method: "DELETE" });
}

// --- Programmes -------------------------------------------------------------

export interface ProgrammeInput {
  departmentId: string;
  name: string;
  code: string;
  type?: Programme["type"];
  durationValue: number;
  durationUnit?: Programme["durationUnit"];
  totalCredits?: number;
  eligibility?: string;
  isActive?: boolean;
}

export async function listProgrammes(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<Programme>>> {
  if (USE_MOCKS) {
    return mockList(programmeStore.all(), params, {
      searchFields: ["name", "code"],
      filterKeys: ["departmentId", "type"],
    });
  }
  return apiList<Programme>("/api/programmes", "programmes", params);
}

export async function getProgramme(id: string): Promise<ApiResponse<Programme>> {
  if (USE_MOCKS) {
    const programme = programmeStore.find(id);
    return programme ? mockOk(programme) : mockFail<Programme>("Programme not found", "NOT_FOUND");
  }
  return apiRequest<Programme>(`/api/programmes/${id}`);
}

export async function createProgramme(
  input: ProgrammeInput
): Promise<ApiResponse<Programme>> {
  if (USE_MOCKS) {
    if (programmeStore.all().some((p) => p.code.toLowerCase() === input.code.toLowerCase())) {
      return mockFail<Programme>("Programme code already in use", "CONFLICT");
    }

    const timestamp = now();
    return mockOk(
      programmeStore.insert({
        id: programmeStore.nextId(),
        tenantId: MOCK_TENANT_ID,
        departmentId: input.departmentId,
        name: input.name,
        code: input.code,
        type: input.type ?? "UNDERGRADUATE",
        durationValue: input.durationValue,
        durationUnit: input.durationUnit ?? "YEARS",
        totalCredits: input.totalCredits ?? null,
        eligibility: input.eligibility ?? null,
        description: null,
        isActive: input.isActive ?? true,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      "Programme created"
    );
  }
  return apiRequest<Programme>("/api/programmes", { method: "POST", body: input });
}

export async function updateProgramme(
  id: string,
  input: Partial<ProgrammeInput>
): Promise<ApiResponse<Programme>> {
  if (USE_MOCKS) {
    const updated = programmeStore.update(id, { ...input, updatedAt: now() });
    return updated
      ? mockOk(updated, "Programme updated")
      : mockFail<Programme>("Programme not found", "NOT_FOUND");
  }
  return apiRequest<Programme>(`/api/programmes/${id}`, { method: "PATCH", body: input });
}

export async function deleteProgramme(id: string): Promise<ApiResponse<null>> {
  if (USE_MOCKS) {
    if (specialisationStore.all().some((s) => s.programmeId === id)) {
      return mockFail<null>("Programme still has specialisations", "CONFLICT");
    }
    return programmeStore.remove(id)
      ? mockOk(null, "Programme deleted")
      : mockFail<null>("Programme not found", "NOT_FOUND");
  }
  return apiRequest<null>(`/api/programmes/${id}`, { method: "DELETE" });
}

// --- Specialisations --------------------------------------------------------

export interface SpecialisationInput {
  name: string;
  code: string;
  isActive?: boolean;
}

/**
 * Specialisations belong to a programme and are addressed through it —
 * GET /api/programmes/[id]/specialisations, not a top-level collection.
 */
export async function listSpecialisations(
  programmeId: string,
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<Specialisation>>> {
  if (USE_MOCKS) {
    const rows = specialisationStore.all().filter((s) => s.programmeId === programmeId);
    return mockList(rows, params, { searchFields: ["name", "code"] });
  }
  return apiList<Specialisation>(
    `/api/programmes/${programmeId}/specialisations`,
    "specialisations",
    params
  );
}

export async function createSpecialisation(
  programmeId: string,
  input: SpecialisationInput
): Promise<ApiResponse<Specialisation>> {
  if (USE_MOCKS) {
    if (specialisationStore.all().some((s) => s.code.toLowerCase() === input.code.toLowerCase())) {
      return mockFail<Specialisation>("Specialisation code already in use", "CONFLICT");
    }

    return mockOk(
      specialisationStore.insert({
        id: specialisationStore.nextId(),
        tenantId: MOCK_TENANT_ID,
        programmeId,
        name: input.name,
        code: input.code,
        description: null,
        isActive: input.isActive ?? true,
        createdAt: now(),
      }),
      "Specialisation created"
    );
  }
  return apiRequest<Specialisation>(`/api/programmes/${programmeId}/specialisations`, {
    method: "POST",
    body: input,
  });
}
