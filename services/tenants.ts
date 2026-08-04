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
import { USE_MOCKS } from "./config";
import { MOCK_TENANTS, findMockTenant } from "@/mock/data/tenants";
import { findMockSubscriptionForTenant } from "@/mock/data/subscriptions";
import { mockFail, mockList, mockOk } from "@/mock/utils";

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
  if (USE_MOCKS) {
    return mockList(MOCK_TENANTS, params, {
      searchFields: ["name", "slug"],
      filterKeys: ["status", "type"],
    });
  }

  return apiList<Tenant>("/api/platform/tenants", "tenants", params);
}

export async function getTenant(id: string): Promise<ApiResponse<Tenant>> {
  if (USE_MOCKS) {
    const tenant = findMockTenant(id);
    return tenant ? mockOk(tenant) : mockFail<Tenant>("Tenant not found", "NOT_FOUND");
  }

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
  if (USE_MOCKS) {
    const tenant = findMockTenant(id);
    if (!tenant) return mockFail<TenantStats>("Tenant not found", "NOT_FOUND");

    // Scaled off the subscription's seat limits so the counts sit plausibly
    // under the plan the tenant is actually on, instead of contradicting it.
    const subscription = findMockSubscriptionForTenant(id);
    const studentCap = subscription?.maxStudents ?? 500;
    const facultyCap = subscription?.maxFaculty ?? 50;
    const fill = tenant.status === "ACTIVE" ? 0.72 : tenant.status === "TRIAL" ? 0.04 : 0.38;

    const studentsTotal = Math.round(studentCap * fill);
    const facultyTotal = Math.round(facultyCap * fill);

    return mockOk({
      students: { total: studentsTotal, active: Math.round(studentsTotal * 0.94) },
      faculty: { total: facultyTotal, active: Math.round(facultyTotal * 0.97) },
    });
  }

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
  if (USE_MOCKS) {
    const slug = input.slug.trim().toLowerCase();

    if (MOCK_TENANTS.some((tenant) => tenant.slug === slug)) {
      return mockFail<Tenant>("Tenant slug already in use", "CONFLICT");
    }

    const now = new Date().toISOString();
    return mockOk<Tenant>(
      {
        id: `tnt_new_${slug}`,
        slug,
        name: input.name.trim(),
        type: input.type ?? "UNIVERSITY",
        // The schema defaults a new tenant to TRIAL, and status is not accepted
        // on create — PATCH owns status changes.
        status: "TRIAL",
        logoUrl: null,
        faviconUrl: null,
        primaryColor: null,
        accentColor: null,
        timezone: "Asia/Kolkata",
        locale: "en",
        country: "IN",
        address: null,
        contactEmail: input.contactEmail?.trim() || null,
        contactPhone: input.contactPhone?.trim() || null,
        website: input.website?.trim() || null,
        accreditationNo: null,
        establishedYear: input.establishedYear ?? null,
        settings: null,
        createdAt: now,
        updatedAt: now,
      },
      "Tenant created"
    );
  }

  return apiRequest<Tenant>("/api/platform/tenants", { method: "POST", body: input });
}

export async function updateTenant(
  id: string,
  input: UpdateTenantInput
): Promise<ApiResponse<Tenant>> {
  if (USE_MOCKS) {
    const tenant = findMockTenant(id);
    if (!tenant) return mockFail<Tenant>("Tenant not found", "NOT_FOUND");

    // Returns the merged record without writing it back, for the same reason
    // createTenant does not push: the fixture is shared server-side state.
    // The screen still updates, because the caller refreshes from this result.
    return mockOk<Tenant>(
      { ...tenant, ...input, updatedAt: new Date().toISOString() },
      "Tenant updated"
    );
  }

  return apiRequest<Tenant>(`/api/platform/tenants/${id}`, { method: "PATCH", body: input });
}
