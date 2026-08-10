// ============================================================================
// MODULE : Services — Admissions (W3, PRD §8.2, §8.5, §49.2)
// PURPOSE: Every admissions read and write the platform console performs.
//
//          Identifiers and workflow state are SERVER-controlled: no function
//          here sends applicantNo, applicationNo, stage or tenantId, because
//          the API refuses all four.
// ============================================================================

import type { ApiResponse, ListParams } from "@/types";
import { apiRequest } from "./client";

/** PRD §49.2, in order. Mirrors ADMISSION_STAGES on the server. */
export type AdmissionStageName =
  | "LEAD"
  | "COUNSELLING"
  | "APPLICATION"
  | "DOCUMENT_VERIFICATION"
  | "ELIGIBILITY_CHECK"
  | "ENTRANCE_EXAMINATION"
  | "MERIT_OR_SELECTION"
  | "OFFER_LETTER"
  | "FEE_PAYMENT"
  | "STUDENT_ID_GENERATION"
  | "COURSE_ALLOCATION"
  | "PORTAL_ACTIVATION";

export interface ApplicationPreferenceRow {
  priority: number;
  programme: { id: string; code: string; name: string };
}

export interface Application {
  id: string;
  tenantId: string;
  applicantNo: string;
  applicationNo: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  dateOfBirth: string | null;
  guardianName: string | null;
  guardianRelation: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  /** Free-form: PRD §8.2 names these and defines no field for either. */
  educationHistory: Record<string, string | number>[] | null;
  workHistory: Record<string, string | number>[] | null;
  stage: AdmissionStageName;
  studentId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  preferences: ApplicationPreferenceRow[];
}

export interface ApplicationPage {
  applications: Application[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface ApplicationInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth?: string;
  guardianName?: string;
  guardianRelation?: string;
  guardianPhone?: string;
  guardianEmail?: string;
  educationHistory?: Record<string, string | number>[];
  workHistory?: Record<string, string | number>[];
  preferences?: { programmeId: string; priority: number }[];
}

const base = (tenantId: string) => `/api/platform/tenants/${tenantId}/admissions`;

export async function listApplications(
  tenantId: string,
  params?: ListParams
): Promise<ApiResponse<ApplicationPage>> {
  return apiRequest<ApplicationPage>(base(tenantId), { params });
}

export async function getApplication(
  tenantId: string,
  applicationId: string
): Promise<ApiResponse<Application>> {
  return apiRequest<Application>(`${base(tenantId)}/${applicationId}`);
}

/** Both identifiers are issued server-side; neither is sent. */
export async function createApplication(
  tenantId: string,
  input: ApplicationInput
): Promise<ApiResponse<Application>> {
  return apiRequest<Application>(base(tenantId), { method: "POST", body: input });
}

export async function updateApplication(
  tenantId: string,
  applicationId: string,
  input: Partial<ApplicationInput>
): Promise<ApiResponse<Application>> {
  return apiRequest<Application>(`${base(tenantId)}/${applicationId}`, {
    method: "PATCH",
    body: input,
  });
}

/**
 * Advance exactly one §49.2 stage.
 *
 * The target is sent explicitly so a double-submit cannot advance twice — the
 * server refuses a target that is not one step ahead of what it reads.
 */
export async function advanceStage(
  tenantId: string,
  applicationId: string,
  toStage: AdmissionStageName,
  note?: string
): Promise<ApiResponse<Application>> {
  return apiRequest<Application>(`${base(tenantId)}/${applicationId}/stage`, {
    method: "POST",
    body: { toStage, ...(note ? { note } : {}) },
  });
}

export interface ConversionResult {
  studentId: string;
  enrollmentNo: string;
  email: string;
  /** Shown once. The server stores only its hash and cannot produce it again. */
  temporaryPassword: string;
}

/** PRD §8.5 — convert an admitted applicant into a Student. */
export async function convertApplication(
  tenantId: string,
  applicationId: string,
  input: { programmeId: string; batchId: string; admissionDate?: string }
): Promise<ApiResponse<ConversionResult>> {
  return apiRequest<ConversionResult>(`${base(tenantId)}/${applicationId}/convert`, {
    method: "POST",
    body: input,
  });
}

// --- Tenant-scoped surface (TD-W3-6, PRD §57) --------------------------------
//
// The SAME service and workflow as the platform functions above, reached
// through the university's own guard. The tenant is the authenticated session's
// and appears in no path and no body, so none of these takes a tenantId.

const mine = "/api/admissions";

export async function listMyApplications(
  params?: ListParams
): Promise<ApiResponse<ApplicationPage>> {
  return apiRequest<ApplicationPage>(mine, { params });
}

export async function getMyApplication(
  applicationId: string
): Promise<ApiResponse<Application>> {
  return apiRequest<Application>(`${mine}/${applicationId}`);
}

export async function createMyApplication(
  input: ApplicationInput
): Promise<ApiResponse<Application>> {
  return apiRequest<Application>(mine, { method: "POST", body: input });
}

export async function updateMyApplication(
  applicationId: string,
  input: Partial<ApplicationInput>
): Promise<ApiResponse<Application>> {
  return apiRequest<Application>(`${mine}/${applicationId}`, { method: "PATCH", body: input });
}

export async function advanceMyStage(
  applicationId: string,
  toStage: AdmissionStageName,
  note?: string
): Promise<ApiResponse<Application>> {
  return apiRequest<Application>(`${mine}/${applicationId}/stage`, {
    method: "POST",
    body: { toStage, ...(note ? { note } : {}) },
  });
}

export async function convertMyApplication(
  applicationId: string,
  input: { programmeId: string; batchId: string; admissionDate?: string }
): Promise<ApiResponse<ConversionResult>> {
  return apiRequest<ConversionResult>(`${mine}/${applicationId}/convert`, {
    method: "POST",
    body: input,
  });
}
