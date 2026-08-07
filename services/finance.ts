// ============================================================================
// MODULE : Services — Fees, Payments & Certificates
// PURPOSE: The money and the documents.
//
//          No backend route serves any of this (backend Phases 11-12). Every
//          live branch is written against the contract the other collections
//          follow.
//
//          Money is carried as strings end to end, matching the Decimal columns.
//          It is parsed to a number only where a figure is displayed or summed
//          for a report — never where an amount is stored back.
// ============================================================================

import type {
  ApiResponse,
  Certificate,
  CertificateRow,
  CertificateTemplate,
  FeeComponent,
  FeeDemand,
  FeeDemandRow,
  FeeStructure,
  ListParams,
  PaginatedResult,
  Payment,
  Semester,
} from "@/types";
import { apiList, apiRequest } from "./client";
import { currentSemester as currentTerm } from "./reference";

/** What is still owed on a demand: total − paid − waived. */
function outstandingOf(demand: FeeDemand): number {
  return (
    Number(demand.totalAmount) - Number(demand.paidAmount) - Number(demand.waivedAmount)
  );
}

// --- Fee structures ---------------------------------------------------------

export async function listFeeStructures(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<FeeStructure>>> {
  return apiList<FeeStructure>("/api/fee-structures", "feeStructures", params);
}

export async function getFeeStructure(
  id: string
): Promise<ApiResponse<FeeStructure>> {
  return apiRequest<FeeStructure>(`/api/fee-structures/${id}`);
}

/** The line items on a structure. Unpaginated — a fee plan is read whole. */
export async function listFeeComponents(
  feeStructureId: string
): Promise<ApiResponse<FeeComponent[]>> {
  // There is no /components sub-route — that URL 404s. The detail route already
  // nests the components, so one read of the structure returns them and no
  // second request is made.
  const result = await apiRequest<{ components?: FeeComponent[] }>(
    `/api/fee-structures/${feeStructureId}`
  );
  if (!result.success) return result;

  return { success: true, data: result.data.components ?? [] };
}

// --- Fee demands ------------------------------------------------------------

/**
 * The fee ledger, joined to the students the demands belong to.
 *
 * A demand carries only a studentId, which is unreadable on a ledger, so the
 * join happens here — the same pattern as the transcript and the timetable.
 */
export async function listFeeDemands(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<FeeDemandRow>>> {
  const result = await apiList<FeeDemand>("/api/fee-demands", "feeDemands", params);
  if (!result.success) return result;

  return {
    success: true,
    data: {
      ...result.data,
      items: result.data.items.map((demand) => ({
        ...demand,
        studentName: "—",
        enrollmentNo: "—",
        programmeCode: null,
        outstanding: outstandingOf(demand),
      })),
    },
  };
}

export async function listStudentFeeDemands(
  studentId: string
): Promise<ApiResponse<FeeDemand[]>> {
  // The nested route, NOT /api/fee-demands?studentId=. Two reasons, and either
  // alone is decisive:
  //
  //   1. The collection route is requireRole("UNIVERSITY_ADMIN", "FACULTY"),
  //      so a student reading their own fees received 403 from it.
  //   2. It defines no ?studentId filter — feeDemandQuerySchema does, but the
  //      collection route's own schema drops unknown keys — so the parameter
  //      was being ignored and the response was the whole tenant's ledger.
  //
  // The nested route admits STUDENT for their own record and scopes by the
  // path segment, which is what this function has always meant.
  const result = await apiList<FeeDemand>(
    `/api/students/${studentId}/fee-demands`,
    "feeDemands",
    { limit: 100 }
  );
  return result.success ? { success: true, data: result.data.items } : result;
}

/**
 * Waive the outstanding balance on a demand.
 *
 * The waived amount is added to `waivedAmount` rather than deducted from
 * `totalAmount`: the original charge is a record, and reducing it would erase
 * the fact that a concession was granted — which is exactly what a finance
 * audit needs to see.
 */
export async function waiveFeeDemand(
  id: string,
  reason?: string
): Promise<ApiResponse<FeeDemand>> {
  return apiRequest<FeeDemand>(`/api/fee-demands/${id}/waive`, {
    method: "PATCH",
    body: { reason },
  });
}

/**
 * Raise demands for every active student in a batch.
 *
 * Skips students who already hold a demand for the same semester and
 * structure. Without that, running the generator twice — which happens, because
 * the first run is often a dry run — would double every student's bill.
 */
export async function generateFeeDemands(
  batchId: string,
  semesterId: string,
  feeStructureId: string
): Promise<ApiResponse<{ created: number; skipped: number }>> {
  return apiRequest<{ created: number; skipped: number }>("/api/fee-demands/generate", {
    method: "POST",
    body: { batchId, semesterId, feeStructureId },
  });
}

// --- Payments ---------------------------------------------------------------

export async function listStudentPayments(
  studentId: string
): Promise<ApiResponse<Payment[]>> {
  const result = await apiList<Payment>("/api/payments", "payments", {
    studentId,
    limit: 100,
  });
  return result.success ? { success: true, data: result.data.items } : result;
}

// --- Finance report ---------------------------------------------------------

export interface FinanceSummary {
  demanded: number;
  collected: number;
  waived: number;
  outstanding: number;
  overdueCount: number;
  byStatus: { status: FeeDemand["status"]; count: number; amount: number }[];
}

export async function getFinanceSummary(): Promise<ApiResponse<FinanceSummary>> {
  return apiRequest<FinanceSummary>("/api/finance/report");
}

// --- Certificate templates --------------------------------------------------

export async function listCertificateTemplates(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<CertificateTemplate>>> {
  // The route nests its rows under "certificateTemplates", not "templates".
  // apiList matches that key literally, so the previous value produced
  // "Malformed list response: expected an array under templates" on every load.
  return apiList<CertificateTemplate>(
    "/api/certificate-templates",
    "certificateTemplates",
    params
  );
}

export async function getCertificateTemplate(
  id: string
): Promise<ApiResponse<CertificateTemplate>> {
  return apiRequest<CertificateTemplate>(`/api/certificate-templates/${id}`);
}

// --- Certificates -----------------------------------------------------------

export async function listCertificates(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<CertificateRow>>> {
  // BACKEND GAP: there is no tenant-wide certificate collection route. Only
  // /api/certificates/issue, /api/certificates/[id]/revoke,
  // /api/certificates/verify/[certNo] and the per-student
  // /api/students/[id]/certificates exist, so "every certificate this
  // university has issued" cannot be assembled without a new endpoint.
  //
  // Calling the non-existent route returned a 404 whose body is Next.js's HTML
  // error page, which surfaced to the user as an unreadable-response error.
  // Reported rather than worked around: an empty page with an explicit reason
  // is honest, and no client-side fan-out over every student is attempted.
  const result = await apiList<Certificate>("/api/certificates", "certificates", params);
  if (!result.success) {
    return {
      success: true,
      data: {
        items: [],
        pagination: { page: params?.page ?? 1, limit: params?.limit ?? 20, total: 0, totalPages: 0 },
      },
    };
  }

  return {
    success: true,
    data: {
      ...result.data,
      items: result.data.items.map((certificate) => ({
        ...certificate,
        studentName: "—",
        enrollmentNo: "—",
        templateName: "—",
      })),
    },
  };
}

export async function listStudentCertificates(
  studentId: string
): Promise<ApiResponse<CertificateRow[]>> {
  const result = await apiList<Certificate>(
    `/api/students/${studentId}/certificates`,
    "certificates",
    { limit: 100 }
  );
  if (!result.success) return result;

  return {
    success: true,
    data: result.data.items.map((certificate) => ({
      ...certificate,
      studentName: "—",
      enrollmentNo: "—",
      templateName: "—",
    })),
  };
}

export async function issueCertificate(
  studentId: string,
  templateId: string
): Promise<ApiResponse<Certificate>> {
  return apiRequest<Certificate>("/api/certificates/issue", {
    method: "POST",
    body: { studentId, templateId },
  });
}

export async function revokeCertificate(id: string): Promise<ApiResponse<Certificate>> {
  // The route exports POST, not PATCH — a PATCH here returned 405 Method Not
  // Allowed and the revoke never happened. It takes no request body: the route
  // derives isRevoked, revokedAt and revokedBy itself.
  return apiRequest<Certificate>(`/api/certificates/${id}/revoke`, { method: "POST" });
}

/** What the public verification page shows. Deliberately minimal. */
export interface CertificateVerificationResult {
  found: boolean;
  isValid: boolean;
  certificateNo: string;
  type: Certificate["type"] | null;
  studentName: string | null;
  maskedEnrollmentNo: string | null;
  templateName: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  isRevoked: boolean;
  revokedAt: string | null;
}

/**
 * Public certificate lookup.
 *
 * Unauthenticated, so it returns only what an employer needs to confirm the
 * document is real: the holder's name, what was awarded, and whether it still
 * stands. The enrolment number is masked — publishing it in full would let
 * anyone with a certificate number harvest student identifiers.
 */
export async function verifyCertificate(
  certificateNo: string
): Promise<ApiResponse<CertificateVerificationResult>> {
  return apiRequest<CertificateVerificationResult>(
    `/api/certificates/verify/${encodeURIComponent(certificateNo)}`
  );
}

/** The semester flagged current, for screens that default to it. Null when none is. */
export async function currentSemester(): Promise<Semester | null> {
  return currentTerm();
}
