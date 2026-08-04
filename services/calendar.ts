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
import { USE_MOCKS } from "./config";
import { MOCK_TENANT_ID } from "@/mock/data/context";
import { academicYearStore, batchStore, sectionStore, semesterStore } from "@/mock/stores";
import { mockFail, mockList, mockOk } from "@/mock/utils";

const now = () => new Date().toISOString();

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
  if (USE_MOCKS) {
    return mockList(academicYearStore.all(), params, {
      searchFields: ["name"],
      // Newest first: the year staff work in is almost always the latest one.
      sort: (a, b) => Date.parse(b.startDate) - Date.parse(a.startDate),
    });
  }
  return apiList<AcademicYear>("/api/academic-years", "academicYears", params);
}

/**
 * Clear `isCurrent` on every other year.
 *
 * "Current" is a single-occupancy flag: two current years would make every
 * downstream default — which batches to show, which semester to bill —
 * ambiguous. The database has no partial unique index enforcing it, so it is
 * enforced at the point of write instead.
 */
function demoteOtherYears(exceptId: string): void {
  for (const year of academicYearStore.all()) {
    if (year.id !== exceptId && year.isCurrent) {
      academicYearStore.update(year.id, { isCurrent: false } as Partial<AcademicYear>);
    }
  }
}

export async function createAcademicYear(
  input: AcademicYearInput
): Promise<ApiResponse<AcademicYear>> {
  if (USE_MOCKS) {
    if (academicYearStore.all().some((y) => y.name.toLowerCase() === input.name.toLowerCase())) {
      return mockFail<AcademicYear>("Academic year name already in use", "CONFLICT");
    }

    const created = academicYearStore.insert({
      id: academicYearStore.nextId(),
      tenantId: MOCK_TENANT_ID,
      name: input.name,
      startDate: new Date(input.startDate).toISOString(),
      endDate: new Date(input.endDate).toISOString(),
      isCurrent: input.isCurrent ?? false,
      createdAt: now(),
    });

    if (created.isCurrent) demoteOtherYears(created.id);
    return mockOk(created, "Academic year created");
  }
  return apiRequest<AcademicYear>("/api/academic-years", { method: "POST", body: input });
}

export async function updateAcademicYear(
  id: string,
  input: Partial<AcademicYearInput>
): Promise<ApiResponse<AcademicYear>> {
  if (USE_MOCKS) {
    const updated = academicYearStore.update(id, {
      ...input,
      ...(input.startDate ? { startDate: new Date(input.startDate).toISOString() } : {}),
      ...(input.endDate ? { endDate: new Date(input.endDate).toISOString() } : {}),
    } as Partial<AcademicYear>);

    if (!updated) return mockFail<AcademicYear>("Academic year not found", "NOT_FOUND");
    if (updated.isCurrent) demoteOtherYears(id);

    return mockOk(updated, "Academic year updated");
  }
  return apiRequest<AcademicYear>(`/api/academic-years/${id}`, { method: "PATCH", body: input });
}

export async function deleteAcademicYear(id: string): Promise<ApiResponse<null>> {
  if (USE_MOCKS) {
    const hasChildren =
      semesterStore.all().some((s) => s.academicYearId === id) ||
      batchStore.all().some((b) => b.academicYearId === id);
    if (hasChildren) {
      return mockFail<null>("Academic year still has semesters or batches", "CONFLICT");
    }
    return academicYearStore.remove(id)
      ? mockOk(null, "Academic year deleted")
      : mockFail<null>("Academic year not found", "NOT_FOUND");
  }
  return apiRequest<null>(`/api/academic-years/${id}`, { method: "DELETE" });
}

export async function getAcademicYear(id: string): Promise<ApiResponse<AcademicYear>> {
  if (USE_MOCKS) {
    const year = academicYearStore.find(id);
    return year ? mockOk(year) : mockFail<AcademicYear>("Academic year not found", "NOT_FOUND");
  }
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
  if (USE_MOCKS) {
    const rows = semesterStore.all().filter((s) => s.academicYearId === academicYearId);
    return mockList(rows, params, {
      sort: (a, b) => a.semesterNumber - b.semesterNumber,
    });
  }
  return apiList<Semester>(`/api/academic-years/${academicYearId}/semesters`, "semesters", params);
}

export async function createSemester(
  academicYearId: string,
  input: SemesterInput
): Promise<ApiResponse<Semester>> {
  if (USE_MOCKS) {
    // @@unique([academicYearId, semesterNumber]) — the same number twice in one
    // year is the conflict the form reports against its number field.
    const duplicate = semesterStore
      .all()
      .some((s) => s.academicYearId === academicYearId && s.semesterNumber === input.semesterNumber);
    if (duplicate) {
      return mockFail<Semester>("That semester number already exists in this year", "CONFLICT");
    }

    const created = semesterStore.insert({
      id: semesterStore.nextId(),
      tenantId: MOCK_TENANT_ID,
      academicYearId,
      name: input.name,
      semesterNumber: input.semesterNumber,
      startDate: new Date(input.startDate).toISOString(),
      endDate: new Date(input.endDate).toISOString(),
      isCurrent: input.isCurrent ?? false,
      createdAt: now(),
    });

    if (created.isCurrent) {
      for (const semester of semesterStore.all()) {
        if (semester.id !== created.id && semester.isCurrent) {
          semesterStore.update(semester.id, { isCurrent: false } as Partial<Semester>);
        }
      }
    }

    return mockOk(created, "Semester created");
  }
  return apiRequest<Semester>(`/api/academic-years/${academicYearId}/semesters`, {
    method: "POST",
    body: input,
  });
}

export async function deleteSemester(id: string): Promise<ApiResponse<null>> {
  if (USE_MOCKS) {
    if (sectionStore.all().some((s) => s.semesterId === id)) {
      return mockFail<null>("Semester still has sections", "CONFLICT");
    }
    return semesterStore.remove(id)
      ? mockOk(null, "Semester deleted")
      : mockFail<null>("Semester not found", "NOT_FOUND");
  }
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
  if (USE_MOCKS) {
    return mockList(batchStore.all(), params, {
      searchFields: ["name", "code"],
      filterKeys: ["programmeId", "academicYearId"],
    });
  }
  return apiList<Batch>("/api/batches", "batches", params);
}

export async function getBatch(id: string): Promise<ApiResponse<Batch>> {
  if (USE_MOCKS) {
    const batch = batchStore.find(id);
    return batch ? mockOk(batch) : mockFail<Batch>("Batch not found", "NOT_FOUND");
  }
  return apiRequest<Batch>(`/api/batches/${id}`);
}

export async function createBatch(input: BatchInput): Promise<ApiResponse<Batch>> {
  if (USE_MOCKS) {
    if (batchStore.all().some((b) => b.code.toLowerCase() === input.code.toLowerCase())) {
      return mockFail<Batch>("Batch code already in use", "CONFLICT");
    }

    return mockOk(
      batchStore.insert({
        id: batchStore.nextId(),
        tenantId: MOCK_TENANT_ID,
        programmeId: input.programmeId,
        academicYearId: input.academicYearId,
        name: input.name,
        code: input.code,
        maxStrength: input.maxStrength ?? null,
        createdAt: now(),
      }),
      "Batch created"
    );
  }
  return apiRequest<Batch>("/api/batches", { method: "POST", body: input });
}

export async function updateBatch(
  id: string,
  input: Partial<BatchInput>
): Promise<ApiResponse<Batch>> {
  if (USE_MOCKS) {
    const updated = batchStore.update(id, input as Partial<Batch>);
    return updated ? mockOk(updated, "Batch updated") : mockFail<Batch>("Batch not found", "NOT_FOUND");
  }
  return apiRequest<Batch>(`/api/batches/${id}`, { method: "PATCH", body: input });
}

export async function deleteBatch(id: string): Promise<ApiResponse<null>> {
  if (USE_MOCKS) {
    if (sectionStore.all().some((s) => s.batchId === id)) {
      return mockFail<null>("Batch still has sections", "CONFLICT");
    }
    return batchStore.remove(id)
      ? mockOk(null, "Batch deleted")
      : mockFail<null>("Batch not found", "NOT_FOUND");
  }
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
  if (USE_MOCKS) {
    const rows = sectionStore.all().filter((s) => s.batchId === batchId);
    return mockList(rows, params, { sort: (a, b) => a.name.localeCompare(b.name) });
  }
  return apiList<Section>(`/api/batches/${batchId}/sections`, "sections", params);
}

export async function createSection(
  batchId: string,
  input: SectionInput
): Promise<ApiResponse<Section>> {
  if (USE_MOCKS) {
    // @@unique([batchId, semesterId, name]) — the same section letter twice in
    // one batch-and-semester.
    const duplicate = sectionStore
      .all()
      .some(
        (s) =>
          s.batchId === batchId &&
          s.semesterId === input.semesterId &&
          s.name.toLowerCase() === input.name.toLowerCase()
      );
    if (duplicate) {
      return mockFail<Section>("That section already exists for this semester", "CONFLICT");
    }

    return mockOk(
      sectionStore.insert({
        id: sectionStore.nextId(),
        tenantId: MOCK_TENANT_ID,
        batchId,
        semesterId: input.semesterId,
        name: input.name,
        maxStrength: input.maxStrength ?? null,
        createdAt: now(),
      }),
      "Section created"
    );
  }
  return apiRequest<Section>(`/api/batches/${batchId}/sections`, { method: "POST", body: input });
}

export async function deleteSection(id: string): Promise<ApiResponse<null>> {
  if (USE_MOCKS) {
    return sectionStore.remove(id)
      ? mockOk(null, "Section deleted")
      : mockFail<null>("Section not found", "NOT_FOUND");
  }
  return apiRequest<null>(`/api/sections/${id}`, { method: "DELETE" });
}
