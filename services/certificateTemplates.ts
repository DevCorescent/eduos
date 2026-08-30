// ============================================================================
// MODULE : Services — Certificate templates (client-safe)
// PURPOSE: The template writes the builder performs, in a module a CLIENT
//          component may import.
//
// WHY THESE ARE NOT IN services/finance.ts
//   finance.ts imports ./reference, which imports ./session, which imports
//   lib/auth/session — server-only code that reads next/headers. A client
//   component importing finance.ts therefore drags all of that into the browser
//   bundle and the build fails. This module imports ./client and nothing else,
//   so the builder can call it directly.
//
//   The READ side (listCertificateTemplates, getCertificateTemplate) stays in
//   finance.ts, where the certificates screens already call it from the server.
//
// It targets the SAME endpoints the rest of the product uses. No second store.
// ============================================================================

import type { ApiResponse, CertificateTemplate } from "@/types";
import { apiRequest } from "./client";

/** Fields an author may set on a template. Mirrors createCertificateTemplateSchema. */
export interface CertificateTemplateInput {
  name: string;
  type?: string;
  htmlTemplate: string;
  cssStyles?: string;
  variables?: Record<string, unknown>;
  isActive?: boolean;
}

/**
 * Create a template.
 *
 * Goes to the EXISTING POST /api/certificate-templates — the route the PRD
 * names and the one the list screen already reads from. No second store.
 */
export async function createCertificateTemplate(
  input: CertificateTemplateInput
): Promise<ApiResponse<CertificateTemplate>> {
  return apiRequest<CertificateTemplate>("/api/certificate-templates", {
    method: "POST",
    body: input,
  });
}

/**
 * Update a template.
 *
 * PATCH is partial: an omitted key is left alone. Archiving is `isActive:
 * false` on this same route rather than a delete, because a template may be
 * referenced by certificates that have already been issued.
 */
export async function updateCertificateTemplate(
  id: string,
  input: Partial<CertificateTemplateInput>
): Promise<ApiResponse<CertificateTemplate>> {
  return apiRequest<CertificateTemplate>(`/api/certificate-templates/${id}`, {
    method: "PATCH",
    body: input,
  });
}

export async function getCertificateTemplate(
  id: string
): Promise<ApiResponse<CertificateTemplate>> {
  return apiRequest<CertificateTemplate>(`/api/certificate-templates/${id}`);
}

/** One row of a template's version history. */
export interface CertificateTemplateVersion {
  id: string;
  name: string;
  version: number;
  isActive: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { certificates: number };
}

/**
 * Every version of one template, newest first.
 *
 * Read through the API like the rest of this module, so the same role, tenant
 * and module guards apply — the page adds no authorization of its own.
 */
export async function listCertificateTemplateVersions(
  id: string
): Promise<ApiResponse<CertificateTemplateVersion[]>> {
  return apiRequest<CertificateTemplateVersion[]>(`/api/certificate-templates/${id}/versions`);
}
