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

/** Now, as an ISO string — what the API stamps on a created or updated row. */
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
  return apiList<Campus>("/api/campuses", "campuses", params);
}

export async function createCampus(input: CampusInput): Promise<ApiResponse<Campus>> {
  return apiRequest<Campus>("/api/campuses", { method: "POST", body: input });
}

export async function updateCampus(
  id: string,
  input: Partial<CampusInput>
): Promise<ApiResponse<Campus>> {
  return apiRequest<Campus>(`/api/campuses/${id}`, { method: "PATCH", body: input });
}

export async function deleteCampus(id: string): Promise<ApiResponse<null>> {
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
  return apiList<School>("/api/schools", "schools", params);
}

export async function createSchool(input: SchoolInput): Promise<ApiResponse<School>> {
  return apiRequest<School>("/api/schools", { method: "POST", body: input });
}

export async function updateSchool(
  id: string,
  input: Partial<SchoolInput>
): Promise<ApiResponse<School>> {
  return apiRequest<School>(`/api/schools/${id}`, { method: "PATCH", body: input });
}

export async function deleteSchool(id: string): Promise<ApiResponse<null>> {
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
  return apiList<Department>("/api/departments", "departments", params);
}

export async function createDepartment(
  input: DepartmentInput
): Promise<ApiResponse<Department>> {
  return apiRequest<Department>("/api/departments", { method: "POST", body: input });
}

export async function updateDepartment(
  id: string,
  input: Partial<DepartmentInput>
): Promise<ApiResponse<Department>> {
  return apiRequest<Department>(`/api/departments/${id}`, { method: "PATCH", body: input });
}

export async function deleteDepartment(id: string): Promise<ApiResponse<null>> {
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
  return apiList<Programme>("/api/programmes", "programmes", params);
}

export async function getProgramme(id: string): Promise<ApiResponse<Programme>> {
  return apiRequest<Programme>(`/api/programmes/${id}`);
}

export async function createProgramme(
  input: ProgrammeInput
): Promise<ApiResponse<Programme>> {
  return apiRequest<Programme>("/api/programmes", { method: "POST", body: input });
}

export async function updateProgramme(
  id: string,
  input: Partial<ProgrammeInput>
): Promise<ApiResponse<Programme>> {
  return apiRequest<Programme>(`/api/programmes/${id}`, { method: "PATCH", body: input });
}

export async function deleteProgramme(id: string): Promise<ApiResponse<null>> {
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
  return apiRequest<Specialisation>(`/api/programmes/${programmeId}/specialisations`, {
    method: "POST",
    body: input,
  });
}
