// ============================================================================
// MODULE : Services — Tenant Domains and Branding (WP-3, PRD §5.2, §45)
// PURPOSE: The two configuration surfaces, each behind its own guard: domains
//          belong to the platform owner, branding to the university.
// ============================================================================

import type { ApiResponse } from "@/types";
import type { DomainType } from "@/app/generated/prisma/enums";
import { apiRequest } from "./client";

export interface DomainRow {
  id: string;
  tenantId: string;
  domain: string;
  type: DomainType;
  verified: boolean;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listTenantDomains(
  tenantId: string
): Promise<ApiResponse<{ domains: DomainRow[] }>> {
  return apiRequest<{ domains: DomainRow[] }>(
    `/api/platform/tenants/${tenantId}/domains`
  );
}

export interface DomainInput {
  domain: string;
  type?: DomainType;
  verified?: boolean;
  isPrimary?: boolean;
  isActive?: boolean;
}

export async function createTenantDomain(
  tenantId: string,
  input: DomainInput
): Promise<ApiResponse<DomainRow>> {
  return apiRequest<DomainRow>(`/api/platform/tenants/${tenantId}/domains`, {
    method: "POST",
    body: input,
  });
}

/** `domain` is absent — a live hostname is retired and replaced, never renamed. */
export async function updateTenantDomain(
  tenantId: string,
  domainId: string,
  input: Omit<DomainInput, "domain">
): Promise<ApiResponse<DomainRow>> {
  return apiRequest<DomainRow>(
    `/api/platform/tenants/${tenantId}/domains/${domainId}`,
    { method: "PATCH", body: input }
  );
}

export async function deleteTenantDomain(
  tenantId: string,
  domainId: string
): Promise<ApiResponse<{ id: string }>> {
  return apiRequest<{ id: string }>(
    `/api/platform/tenants/${tenantId}/domains/${domainId}`,
    { method: "DELETE" }
  );
}

// --- Branding ---------------------------------------------------------------

export interface TenantBrandingRow {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  /** The four theme tokens that have no column. Resolved by the route. */
  settings?: unknown;
}

export async function getMyBranding(): Promise<ApiResponse<TenantBrandingRow>> {
  return apiRequest<TenantBrandingRow>("/api/tenant/branding");
}

/**
 * `null` clears a field; an omitted key leaves it unchanged.
 *
 * The distinction is what lets a university return to the product's own design
 * system without a separate "reset" endpoint.
 */
export interface BrandingInput {
  logoUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  /**
   * The four tokens stored in Tenant.settings.theme.
   *
   * Same null-clears-it rule as the fields above, applied per token, which is
   * what "reset this one surface to the product default" means.
   */
  theme?: {
    sidebar?: string | null;
    sidebarText?: string | null;
    sidebarActive?: string | null;
    header?: string | null;
  };
}

export async function updateMyBranding(
  input: BrandingInput
): Promise<ApiResponse<TenantBrandingRow>> {
  return apiRequest<TenantBrandingRow>("/api/tenant/branding", {
    method: "PATCH",
    body: input,
  });
}
