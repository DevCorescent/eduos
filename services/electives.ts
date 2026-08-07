// ============================================================================
// MODULE : Services — Open Electives
// PURPOSE: The elective catalogue, a student's ranked choices, and the staff
//          operations that close and settle an offering.
//
// TWO AUDIENCES, ONE CATALOGUE
//   GET /api/open-electives serves both, and the row it returns differs by
//   caller: a student's row carries `isEligible`, `ineligibilityReasons` and
//   their own `preferenceRank`, none of which exist on a staff row. That is why
//   listOfferings and listStudentOfferings below are separate functions over
//   the same path — the shape genuinely differs, and a single signature would
//   have to lie about one of them.
//
// THE WRITES ARE ASYMMETRIC ON PURPOSE
//   A student may only rank (POST /select). Locking and allocating are staff
//   operations, and a student calling either receives 403. The separation is
//   enforced by the API; it is mirrored here so a page imports only what its
//   own audience may do.
// ============================================================================

import type {
  AllocationReportDto,
  ElectiveStatusDto,
  OpenElectiveOfferingDto,
  PreferenceSubmissionDto,
  StudentOfferingDto,
} from "@/lib/dto/openElective.dto";
import type { OpenElectiveStatus } from "@/app/generated/prisma/enums";
import type { ApiResponse, ListParams, PaginatedResult } from "@/types";
import { apiList, apiRequest } from "./client";

export interface OfferingFilters extends ListParams {
  semesterId?: string;
  status?: OpenElectiveStatus;
  departmentId?: string;
}

/** The catalogue as staff see it. */
export async function listOfferings(
  params?: OfferingFilters
): Promise<ApiResponse<PaginatedResult<OpenElectiveOfferingDto>>> {
  return apiList<OpenElectiveOfferingDto>("/api/open-electives", "offerings", params);
}

/**
 * The catalogue as one student sees it.
 *
 * Same endpoint, richer row — the service decides eligibility per caller, so
 * nothing here re-derives it. A page must render `ineligibilityReasons` rather
 * than merely disabling the row: "you cannot pick this" without a reason is
 * the complaint the field exists to answer.
 */
export async function listStudentOfferings(
  params?: OfferingFilters
): Promise<ApiResponse<PaginatedResult<StudentOfferingDto>>> {
  return apiList<StudentOfferingDto>("/api/open-electives", "offerings", params);
}

/**
 * One student's own position for a semester: what they ranked, and what came
 * back. `semesterId` is required by the endpoint — defaulting it would answer
 * about a term the student did not ask about.
 */
export async function getMyElectiveStatus(
  semesterId: string
): Promise<ApiResponse<ElectiveStatusDto>> {
  return apiRequest<ElectiveStatusDto>("/api/open-electives/status", {
    params: { semesterId },
  });
}

export interface PreferenceItem {
  offeringId: string;
  /** 1 is most preferred. Ranks must be 1..n, contiguous and distinct. */
  preferenceRank: number;
}

/**
 * Record a student's ranked choices for a semester.
 *
 * REPLACES the previous set wholesale — the response's `recorded` is the new
 * count, not a delta. The API rejects duplicate offerings and non-contiguous
 * ranks, so a form must submit a clean 1..n sequence rather than relying on
 * the server to tidy one up.
 */
export async function submitPreferences(
  semesterId: string,
  preferences: PreferenceItem[]
): Promise<ApiResponse<PreferenceSubmissionDto>> {
  return apiRequest<PreferenceSubmissionDto>("/api/open-electives/select", {
    method: "POST",
    body: { semesterId, preferences },
  });
}

// --- Staff operations -------------------------------------------------------

/** Close an offering to further choices. Staff only. */
export async function lockOffering(
  offeringId: string
): Promise<ApiResponse<OpenElectiveOfferingDto>> {
  return apiRequest<OpenElectiveOfferingDto>("/api/open-electives/lock", {
    method: "PATCH",
    body: { offeringId },
  });
}

/**
 * Run allocation for one offering. Staff only.
 *
 * The report returned includes refusals as well as awards — a run that shows
 * only the winners explains nothing to the student who was not one.
 *
 * `force` discards a previous run's verdicts and recomputes. It defaults to
 * false so a re-run is an explicit act: whether one is permitted at all is a
 * lifecycle rule the service enforces, and this only carries the intent.
 */
export async function allocateOffering(
  offeringId: string,
  force = false
): Promise<ApiResponse<AllocationReportDto>> {
  return apiRequest<AllocationReportDto>("/api/open-electives/allocate", {
    method: "POST",
    body: { offeringId, force },
  });
}
