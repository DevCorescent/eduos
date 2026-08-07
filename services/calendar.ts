// ============================================================================
// MODULE : Services — Academic Calendar
// PURPOSE: CRUD for academic years, semesters, batches and sections.
//
//          Two entities here are addressed through their parent rather than as
//          top-level collections, matching the routes exactly:
//            semesters -> /api/academic-years/[id]/semesters
//            sections  -> /api/batches/[id]/sections
//          Updating and deleting them, however, uses the flat /api/semesters/[id]
//          and /api/sections/[id]. That asymmetry is the backend's, not an
//          inconsistency introduced here.
// ============================================================================

import type {
  AcademicYear,
  ApiResponse,
  Batch,
  ListParams,
  PaginatedResult,
  Section,
  Semester,
} from "@/types";
import { apiList, apiRequest } from "./client";

// --- Academic years ---------------------------------------------------------

export interface AcademicYearInput {
  name: string;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
}

export async function listAcademicYears(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<AcademicYear>>> {
  return apiList<AcademicYear>("/api/academic-years", "academicYears", params);
}

// "Current" is a single-occupancy flag, and it is enforced by the API: both
// POST /api/academic-years and PATCH /api/academic-years/[id] clear isCurrent on
// every other year of the tenant inside the same transaction whenever an
// explicit isCurrent: true arrives. Nothing is needed on this side.

export async function createAcademicYear(
  input: AcademicYearInput
): Promise<ApiResponse<AcademicYear>> {
  return apiRequest<AcademicYear>("/api/academic-years", { method: "POST", body: input });
}

export async function updateAcademicYear(
  id: string,
  input: Partial<AcademicYearInput>
): Promise<ApiResponse<AcademicYear>> {
  return apiRequest<AcademicYear>(`/api/academic-years/${id}`, { method: "PATCH", body: input });
}

export async function deleteAcademicYear(id: string): Promise<ApiResponse<null>> {
  return apiRequest<null>(`/api/academic-years/${id}`, { method: "DELETE" });
}

export async function getAcademicYear(id: string): Promise<ApiResponse<AcademicYear>> {
  return apiRequest<AcademicYear>(`/api/academic-years/${id}`);
}

// --- Semesters --------------------------------------------------------------

export interface SemesterInput {
  name: string;
  semesterNumber: number;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
}

export async function listSemesters(
  academicYearId: string,
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<Semester>>> {
  return apiList<Semester>(`/api/academic-years/${academicYearId}/semesters`, "semesters", params);
}

export async function createSemester(
  academicYearId: string,
  input: SemesterInput
): Promise<ApiResponse<Semester>> {
  return apiRequest<Semester>(`/api/academic-years/${academicYearId}/semesters`, {
    method: "POST",
    body: input,
  });
}

export async function deleteSemester(id: string): Promise<ApiResponse<null>> {
  return apiRequest<null>(`/api/semesters/${id}`, { method: "DELETE" });
}

// --- Batches ----------------------------------------------------------------

export interface BatchInput {
  programmeId: string;
  academicYearId: string;
  name: string;
  code: string;
  maxStrength?: number;
}

export async function listBatches(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<Batch>>> {
  return apiList<Batch>("/api/batches", "batches", params);
}

export async function getBatch(id: string): Promise<ApiResponse<Batch>> {
  return apiRequest<Batch>(`/api/batches/${id}`);
}

export async function createBatch(input: BatchInput): Promise<ApiResponse<Batch>> {
  return apiRequest<Batch>("/api/batches", { method: "POST", body: input });
}

export async function updateBatch(
  id: string,
  input: Partial<BatchInput>
): Promise<ApiResponse<Batch>> {
  return apiRequest<Batch>(`/api/batches/${id}`, { method: "PATCH", body: input });
}

export async function deleteBatch(id: string): Promise<ApiResponse<null>> {
  return apiRequest<null>(`/api/batches/${id}`, { method: "DELETE" });
}

// --- Sections ---------------------------------------------------------------

export interface SectionInput {
  semesterId: string;
  name: string;
  maxStrength?: number;
}

export async function listSections(
  batchId: string,
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<Section>>> {
  return apiList<Section>(`/api/batches/${batchId}/sections`, "sections", params);
}

export async function createSection(
  batchId: string,
  input: SectionInput
): Promise<ApiResponse<Section>> {
  return apiRequest<Section>(`/api/batches/${batchId}/sections`, { method: "POST", body: input });
}

export async function deleteSection(id: string): Promise<ApiResponse<null>> {
  return apiRequest<null>(`/api/sections/${id}`, { method: "DELETE" });
}
