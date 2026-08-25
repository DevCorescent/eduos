// ============================================================================
// OWNER  : Gauransh
// MODULE : Services — Website CMS (W4, PRD §7.3)
// PURPOSE: The CMS endpoints the editor calls, wrapped so no component touches
//          fetch directly.
//
// NOT "server-only": the editor is a client component, because editing is
// interaction. Everything goes through apiRequest, so a transport failure comes
// back as the standard envelope rather than as a thrown rejection inside an
// event handler.
//
// THREE SURFACES, ONE SHAPE
//   A university admin edits their own page; a platform operator edits any
//   tenant's page and the shared template. All three take and return the same
//   block array, which is what lets one editor component serve all three.
// ============================================================================

import type { ApiResponse } from "@/types";
import type { CmsBlocks } from "@/lib/domain/cms/blocks";
import type { SaveCmsSiteInput, SaveCmsTemplateInput } from "@/lib/validations/cms";
import { apiRequest } from "./client";

/** A page as the editor holds it. */
export interface CmsPageDto {
  id: string;
  path: string;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  draftBlocks: unknown;
  publishedBlocks: unknown;
  publishedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  updatedAt: string;
}

export interface SavePagePayload {
  title?: string;
  blocks: CmsBlocks;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogImageUrl?: string | null;
}

// --- This university's own website ------------------------------------------

export async function getMyPage(): Promise<ApiResponse<CmsPageDto | null>> {
  return apiRequest<CmsPageDto | null>("/api/tenant/cms/page");
}

export async function saveMyPage(
  payload: SavePagePayload
): Promise<ApiResponse<CmsPageDto>> {
  return apiRequest<CmsPageDto>("/api/tenant/cms/page", { method: "PUT", body: payload });
}

/** Make the saved draft live. Carries no blocks — see the route's own note. */
export async function publishMyPage(note?: string): Promise<ApiResponse<CmsPageDto>> {
  return apiRequest<CmsPageDto>("/api/tenant/cms/page/publish", {
    method: "POST",
    body: note ? { note } : {},
  });
}

export async function saveMySite(
  payload: SaveCmsSiteInput
): Promise<ApiResponse<unknown>> {
  return apiRequest("/api/tenant/cms/site", { method: "PUT", body: payload });
}

// --- Platform: the shared template ------------------------------------------

export interface CmsTemplateDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  blocks: unknown;
  navItems: unknown;
  footerColumns: unknown;
  socialLinks: unknown;
  enquireRail: unknown;
  typography: unknown;
  updatedAt: string;
}

/**
 * Write part of the template.
 *
 * EVERY FIELD IS OPTIONAL AND THAT IS LOAD-BEARING. The template is edited from
 * two screens — sections on one, navigation and typography on the other — and
 * each sends only what it owns. A save from the chrome screen must not carry a
 * block array it never displayed, because that array would overwrite the
 * sections with whatever it happened to be holding.
 */
export async function saveTemplate(
  payload: SaveCmsTemplateInput
): Promise<ApiResponse<CmsTemplateDto>> {
  return apiRequest<CmsTemplateDto>("/api/platform/cms/template", {
    method: "PUT",
    body: payload,
  });
}

// --- Platform: one university's page ----------------------------------------

export async function saveTenantPage(
  tenantId: string,
  payload: SavePagePayload
): Promise<ApiResponse<CmsPageDto>> {
  return apiRequest<CmsPageDto>(`/api/platform/tenants/${tenantId}/cms/page`, {
    method: "PUT",
    body: payload,
  });
}

export async function publishTenantPage(
  tenantId: string,
  note?: string
): Promise<ApiResponse<CmsPageDto>> {
  return apiRequest<CmsPageDto>(`/api/platform/tenants/${tenantId}/cms/page`, {
    method: "POST",
    body: note ? { note } : {},
  });
}
