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
} from "@/types";
import { apiList, apiRequest } from "./client";
import { USE_MOCKS } from "./config";
import { MOCK_TENANT_ID, mockId } from "@/mock/data/context";
import { CURRENT_SEMESTER, PROGRAMME_BY_ID } from "@/mock/data/academics";
import { MOCK_FEE_COMPONENTS, MOCK_FEE_STRUCTURES } from "@/mock/data/finance";
import {
  MOCK_CERTIFICATE_TEMPLATES,
  MOCK_PAYMENTS,
  TEMPLATE_BY_ID,
} from "@/mock/data/certificates";
import { certificateStore, feeDemandStore } from "@/mock/financeStores";
import { studentStore } from "@/mock/studentStore";
import { mockFail, mockList, mockOk } from "@/mock/utils";

const now = () => new Date().toISOString();

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
  if (USE_MOCKS) {
    return mockList(MOCK_FEE_STRUCTURES, params, {
      searchFields: ["name"],
      filterKeys: ["programmeId", "academicYearId"],
    });
  }
  return apiList<FeeStructure>("/api/fee-structures", "feeStructures", params);
}

export async function getFeeStructure(
  id: string
): Promise<ApiResponse<FeeStructure>> {
  if (USE_MOCKS) {
    const structure = MOCK_FEE_STRUCTURES.find((s) => s.id === id);
    return structure
      ? mockOk(structure)
      : mockFail<FeeStructure>("Fee structure not found", "NOT_FOUND");
  }
  return apiRequest<FeeStructure>(`/api/fee-structures/${id}`);
}

/** The line items on a structure. Unpaginated — a fee plan is read whole. */
export async function listFeeComponents(
  feeStructureId: string
): Promise<ApiResponse<FeeComponent[]>> {
  if (USE_MOCKS) {
    return mockOk(
      MOCK_FEE_COMPONENTS.filter((c) => c.feeStructureId === feeStructureId)
    );
  }

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
  if (USE_MOCKS) {
    const rows: FeeDemandRow[] = feeDemandStore.all().map((demand) => {
      const student = studentStore.find(demand.studentId);
      const programme = student?.programmeId
        ? PROGRAMME_BY_ID.get(student.programmeId)
        : undefined;

      return {
        ...demand,
        studentName: student?.fullName ?? "—",
        enrollmentNo: student?.enrollmentNo ?? "—",
        programmeCode: programme?.code ?? null,
        outstanding: outstandingOf(demand),
      };
    });

    return mockList(rows, params, {
      searchFields: ["studentName", "enrollmentNo"],
      filterKeys: ["status", "semesterId"],
      // Overdue first, then by what is owed — the order a collections officer
      // actually works through the ledger in.
      sort: (a, b) =>
        Number(b.status === "OVERDUE") - Number(a.status === "OVERDUE") ||
        b.outstanding - a.outstanding,
    });
  }

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
  if (USE_MOCKS) {
    return mockOk(feeDemandStore.all().filter((d) => d.studentId === studentId));
  }

  const result = await apiList<FeeDemand>("/api/fee-demands", "feeDemands", {
    studentId,
    limit: 100,
  });
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
  if (USE_MOCKS) {
    const demand = feeDemandStore.find(id);
    if (!demand) return mockFail<FeeDemand>("Fee demand not found", "NOT_FOUND");

    if (demand.status === "PAID") {
      return mockFail<FeeDemand>("This demand is already settled", "CONFLICT");
    }

    const outstanding = outstandingOf(demand);
    const updated = feeDemandStore.update(id, {
      waivedAmount: (Number(demand.waivedAmount) + outstanding).toFixed(2),
      status: "WAIVED",
      updatedAt: now(),
    });

    return updated
      ? mockOk(updated, "Demand waived")
      : mockFail<FeeDemand>("Fee demand not found", "NOT_FOUND");
  }

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
  if (USE_MOCKS) {
    const structure = MOCK_FEE_STRUCTURES.find((s) => s.id === feeStructureId);
    if (!structure) {
      return mockFail<{ created: number; skipped: number }>(
        "Fee structure not found",
        "NOT_FOUND"
      );
    }

    const total = MOCK_FEE_COMPONENTS.filter(
      (c) => c.feeStructureId === feeStructureId
    ).reduce((sum, c) => sum + Number(c.amount), 0);

    const students = studentStore
      .all()
      .filter((s) => s.batchId === batchId && s.status === "ACTIVE");

    let created = 0;
    let skipped = 0;

    for (const student of students) {
      const alreadyBilled = feeDemandStore
        .all()
        .some(
          (d) =>
            d.studentId === student.id &&
            d.semesterId === semesterId &&
            d.feeStructureId === feeStructureId
        );

      if (alreadyBilled) {
        skipped++;
        continue;
      }

      feeDemandStore.insert({
        id: feeDemandStore.nextId(),
        tenantId: MOCK_TENANT_ID,
        studentId: student.id,
        semesterId,
        feeStructureId,
        totalAmount: `${total}.00`,
        paidAmount: "0.00",
        waivedAmount: "0.00",
        status: "PENDING",
        dueDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        createdAt: now(),
        updatedAt: now(),
      });
      created++;
    }

    return mockOk({ created, skipped }, `${created} demands raised`);
  }

  return apiRequest<{ created: number; skipped: number }>("/api/fee-demands/generate", {
    method: "POST",
    body: { batchId, semesterId, feeStructureId },
  });
}

// --- Payments ---------------------------------------------------------------

export async function listStudentPayments(
  studentId: string
): Promise<ApiResponse<Payment[]>> {
  if (USE_MOCKS) {
    return mockOk(
      MOCK_PAYMENTS.filter((p) => p.studentId === studentId).sort(
        (a, b) => Date.parse(b.paidAt ?? b.createdAt) - Date.parse(a.paidAt ?? a.createdAt)
      )
    );
  }

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
  if (USE_MOCKS) {
    const demands = feeDemandStore.all();

    const demanded = demands.reduce((sum, d) => sum + Number(d.totalAmount), 0);
    const collected = demands.reduce((sum, d) => sum + Number(d.paidAmount), 0);
    const waived = demands.reduce((sum, d) => sum + Number(d.waivedAmount), 0);

    const statuses: FeeDemand["status"][] = [
      "PENDING",
      "PARTIAL",
      "PAID",
      "OVERDUE",
      "WAIVED",
    ];

    return mockOk({
      demanded,
      collected,
      waived,
      // Not `demanded - collected`: a waived amount is never going to be
      // collected, and counting it as outstanding overstates what is owed.
      outstanding: demanded - collected - waived,
      overdueCount: demands.filter((d) => d.status === "OVERDUE").length,
      byStatus: statuses.map((status) => {
        const rows = demands.filter((d) => d.status === status);
        return {
          status,
          count: rows.length,
          amount: rows.reduce((sum, d) => sum + Number(d.totalAmount), 0),
        };
      }),
    });
  }

  return apiRequest<FinanceSummary>("/api/finance/report");
}

// --- Certificate templates --------------------------------------------------

export async function listCertificateTemplates(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<CertificateTemplate>>> {
  if (USE_MOCKS) {
    return mockList(MOCK_CERTIFICATE_TEMPLATES, params, {
      searchFields: ["name"],
      filterKeys: ["type"],
    });
  }
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
  if (USE_MOCKS) {
    const template = TEMPLATE_BY_ID.get(id);
    return template
      ? mockOk(template)
      : mockFail<CertificateTemplate>("Template not found", "NOT_FOUND");
  }
  return apiRequest<CertificateTemplate>(`/api/certificate-templates/${id}`);
}

// --- Certificates -----------------------------------------------------------

export async function listCertificates(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<CertificateRow>>> {
  if (USE_MOCKS) {
    const rows: CertificateRow[] = certificateStore.all().map((certificate) => {
      const student = studentStore.find(certificate.studentId);
      return {
        ...certificate,
        studentName: student?.fullName ?? "—",
        enrollmentNo: student?.enrollmentNo ?? "—",
        templateName: TEMPLATE_BY_ID.get(certificate.templateId)?.name ?? "—",
      };
    });

    return mockList(rows, params, {
      searchFields: ["studentName", "enrollmentNo", "certificateNo"],
      filterKeys: ["type"],
      sort: (a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt),
    });
  }

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
  if (USE_MOCKS) {
    const rows = certificateStore
      .all()
      .filter((c) => c.studentId === studentId)
      .map((certificate) => {
        const student = studentStore.find(certificate.studentId);
        return {
          ...certificate,
          studentName: student?.fullName ?? "—",
          enrollmentNo: student?.enrollmentNo ?? "—",
          templateName: TEMPLATE_BY_ID.get(certificate.templateId)?.name ?? "—",
        };
      });
    return mockOk(rows);
  }

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
  if (USE_MOCKS) {
    const student = studentStore.find(studentId);
    if (!student) return mockFail<Certificate>("Student not found", "NOT_FOUND");

    const template = TEMPLATE_BY_ID.get(templateId);
    if (!template) return mockFail<Certificate>("Template not found", "NOT_FOUND");

    const serial = certificateStore.all().length + 1;
    const certificateNo = `CERT-${template.type}-2026-${String(serial).padStart(5, "0")}`;
    const issuedAt = now();

    return mockOk(
      certificateStore.insert({
        id: mockId("cert", serial, 4),
        tenantId: MOCK_TENANT_ID,
        templateId,
        studentId,
        certificateNo,
        type: template.type,
        // Snapshotted now, so a later edit to the student cannot rewrite an
        // already-issued document.
        data: {
          studentName: student.fullName,
          enrollmentNo: student.enrollmentNo,
          issuedFor: template.name,
        },
        issuedAt,
        expiresAt: null,
        pdfUrl: null,
        qrCode: `https://verify.eduos.dev/c/${certificateNo}`,
        isRevoked: false,
        revokedAt: null,
        revokedBy: null,
        createdAt: issuedAt,
      }),
      "Certificate issued"
    );
  }

  return apiRequest<Certificate>("/api/certificates/issue", {
    method: "POST",
    body: { studentId, templateId },
  });
}

export async function revokeCertificate(id: string): Promise<ApiResponse<Certificate>> {
  if (USE_MOCKS) {
    const certificate = certificateStore.find(id);
    if (!certificate) return mockFail<Certificate>("Certificate not found", "NOT_FOUND");
    if (certificate.isRevoked) {
      return mockFail<Certificate>("Certificate is already revoked", "CONFLICT");
    }

    const updated = certificateStore.update(id, {
      isRevoked: true,
      revokedAt: now(),
    });

    return updated
      ? mockOk(updated, "Certificate revoked")
      : mockFail<Certificate>("Certificate not found", "NOT_FOUND");
  }

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
  if (USE_MOCKS) {
    const certificate = certificateStore
      .all()
      .find((c) => c.certificateNo.toLowerCase() === certificateNo.trim().toLowerCase());

    if (!certificate) {
      // A successful response saying "not found", not a 404 envelope: the page
      // needs to render "no such certificate" as a result, which is different
      // from the lookup itself having failed.
      return mockOk({
        found: false,
        isValid: false,
        certificateNo: certificateNo.trim(),
        type: null,
        studentName: null,
        maskedEnrollmentNo: null,
        templateName: null,
        issuedAt: null,
        expiresAt: null,
        isRevoked: false,
        revokedAt: null,
      });
    }

    const student = studentStore.find(certificate.studentId);
    const expired =
      certificate.expiresAt !== null && Date.parse(certificate.expiresAt) < Date.now();

    return mockOk({
      found: true,
      isValid: !certificate.isRevoked && !expired,
      certificateNo: certificate.certificateNo,
      type: certificate.type,
      studentName: student?.fullName ?? null,
      // Last four characters only, e.g. "…0042".
      maskedEnrollmentNo: student ? `…${student.enrollmentNo.slice(-4)}` : null,
      templateName: TEMPLATE_BY_ID.get(certificate.templateId)?.name ?? null,
      issuedAt: certificate.issuedAt,
      expiresAt: certificate.expiresAt,
      isRevoked: certificate.isRevoked,
      revokedAt: certificate.revokedAt,
    });
  }

  return apiRequest<CertificateVerificationResult>(
    `/api/certificates/verify/${encodeURIComponent(certificateNo)}`
  );
}

/** The current semester, for screens that default to it. */
export function currentSemester() {
  return CURRENT_SEMESTER;
}
