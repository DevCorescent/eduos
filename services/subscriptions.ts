// ============================================================================
// MODULE : Services — Subscriptions
// PURPOSE: The platform's billing reads and writes.
//
//          Note the asymmetry with tenants: there is a GET for the collection
//          and a PATCH for one row, but no GET for a single subscription and no
//          POST at all. That is the backend's actual surface, not an omission
//          here — a subscription is created alongside its tenant, and the
//          console edits plan and status in place from the list.
// ============================================================================

import type { ApiResponse, ListParams, PaginatedResult, Subscription } from "@/types";
import { apiList, apiRequest } from "./client";

/** The `limit` cap the endpoint enforces. */
const SCAN_PAGE_SIZE = 100;

/** Pages the tenant lookup below will walk before giving up. */
const SCAN_PAGE_CAP = 10;

/** Writable fields. Mirrors updateSubscriptionSchema's console-facing subset. */
export interface UpdateSubscriptionInput {
  plan?: Subscription["plan"];
  status?: Subscription["status"];
  billingCycle?: Subscription["billingCycle"];
  maxStudents?: number;
  maxFaculty?: number;
  /** Decimal(10,2). Kept a string end-to-end so "1499.50" survives intact. */
  pricePerMonth?: string;
  currency?: string;
  /**
   * The tenant's feature flags.
   *
   * An untyped JSON column, and the only per-tenant capability switch the
   * schema has. PATCH replaces it wholesale rather than merging, so a caller
   * editing one flag must send the whole map — see the feature-flag screen,
   * which reads the current map and writes it back with one key changed.
   */
  features?: Record<string, unknown>;
}

export async function listSubscriptions(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<Subscription>>> {
  return apiList<Subscription>("/api/platform/subscriptions", "subscriptions", params);
}

/**
 * The subscription belonging to one tenant.
 *
 * NO ENDPOINT EXISTS FOR THIS, and GET /api/platform/subscriptions implements
 * no ?tenantId filter — listSubscriptionsQuerySchema takes page and limit and
 * nothing else. So the match is made here, by walking the collection and
 * comparing tenantId on each row.
 *
 * Sending ?tenantId and taking the first row back would be wrong, not merely
 * slow: the parameter is dropped by Zod's object parsing and the endpoint
 * answers with the newest subscription on the PLATFORM, which is somebody
 * else's. Returning null when the scan finds nothing is the honest outcome.
 *
 * Worth replacing with GET /api/platform/tenants/[id]/subscription if that is
 * ever added; the call site on the tenant detail page would not change.
 */
export async function getSubscriptionForTenant(
  tenantId: string
): Promise<ApiResponse<Subscription | null>> {
  for (let page = 1; page <= SCAN_PAGE_CAP; page++) {
    const result = await apiList<Subscription>(
      "/api/platform/subscriptions",
      "subscriptions",
      { page, limit: SCAN_PAGE_SIZE }
    );

    if (!result.success) return result;

    const match = result.data.items.find(
      (subscription) => subscription.tenantId === tenantId
    );
    if (match) return { success: true, data: match };

    if (page >= result.data.pagination.totalPages) break;
  }

  return { success: true, data: null };
}

export async function updateSubscription(
  id: string,
  input: UpdateSubscriptionInput
): Promise<ApiResponse<Subscription>> {
  return apiRequest<Subscription>(`/api/platform/subscriptions/${id}`, {
    method: "PATCH",
    body: input,
  });
}
