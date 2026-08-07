// ============================================================================
// MODULE : Services — Tenants
// PURPOSE: Every tenant read and write the platform console performs.
//
//          The live branch of each function names the key the route nests its
//          rows under ("tenants"), which apiList normalises to `items`. That
//          one string is the whole of the backend's per-entity list shape, and
//          it is confined here — no page sees it.
// ============================================================================

import type { ApiResponse, ListParams, PaginatedResult, Tenant, TenantStats } from "@/types";
import { apiList, apiRequest } from "./client";

/** Writable fields on create. Mirrors createTenantSchema. */
export interface CreateTenantInput {
  slug: string;
  name: string;
  type?: Tenant["type"];
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  establishedYear?: number;
}

/** Writable fields on update. Every key optional; `status` is update-only. */
export type UpdateTenantInput = Partial<CreateTenantInput> & {
  status?: Tenant["status"];
};

/**
 * One page of tenants.
 *
 * `q` searches name and slug, and `status`/`type` filter exactly. The live API
 * implements none of these yet — every route's VALIDATION note says no search
 * parameter is defined — so they are honoured by the mock and sent-and-ignored
 * against the real backend. Nothing breaks either way: Zod's object parsing
 * drops an unknown search param rather than rejecting the request.
 */
export async function listTenants(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<Tenant>>> {
  return apiList<Tenant>("/api/platform/tenants", "tenants", params);
}

export async function getTenant(id: string): Promise<ApiResponse<Tenant>> {
  return apiRequest<Tenant>(`/api/platform/tenants/${id}`);
}

/**
 * Student and faculty counts for one tenant.
 *
 * The live endpoint returns counts only — it deliberately produces no revenue
 * figure, because the README names the category without defining it. The mock
 * matches that shape exactly rather than inventing the missing metric.
 */
export async function getTenantStats(id: string): Promise<ApiResponse<TenantStats>> {
  return apiRequest<TenantStats>(`/api/platform/tenants/${id}/stats`);
}

/**
 * Onboard a tenant.
 *
 * The mock enforces slug uniqueness because that is the one conflict the real
 * endpoint returns 409 for, and it is the error the onboarding form has to
 * render against its slug field. A mock that always succeeded would leave that
 * path unbuilt.
 *
 * The fixture array is not mutated: it is module state shared by every request
 * on the server, so a push here would leak one reviewer's test row into
 * everyone's list and survive until restart.
 */
export async function createTenant(
  input: CreateTenantInput
): Promise<ApiResponse<Tenant>> {
  return apiRequest<Tenant>("/api/platform/tenants", { method: "POST", body: input });
}

export async function updateTenant(
  id: string,
  input: UpdateTenantInput
): Promise<ApiResponse<Tenant>> {
  return apiRequest<Tenant>(`/api/platform/tenants/${id}`, { method: "PATCH", body: input });
}
