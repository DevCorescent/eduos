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
import { USE_MOCKS } from "./config";
import {
  MOCK_SUBSCRIPTIONS,
  findMockSubscription,
  findMockSubscriptionForTenant,
} from "@/mock/data/subscriptions";
import { mockFail, mockList, mockOk } from "@/mock/utils";

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
}

export async function listSubscriptions(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<Subscription>>> {
  if (USE_MOCKS) {
    return mockList(MOCK_SUBSCRIPTIONS, params, {
      // No text field worth searching — a subscription's identifying detail is
      // its tenant, which the row does not carry. The page resolves tenant
      // names itself and filters on plan and status instead.
      filterKeys: ["status", "plan", "tenantId"],
    });
  }

  return apiList<Subscription>("/api/platform/subscriptions", "subscriptions", params);
}

/**
 * The subscription belonging to one tenant.
 *
 * No endpoint exists for this. The live path filters the collection by
 * tenantId, which the backend also does not implement yet — so it currently
 * costs a full first page to find one row. Worth replacing with
 * GET /api/platform/tenants/[id]/subscription if that is ever added; the call
 * site on the tenant detail page would not change.
 */
export async function getSubscriptionForTenant(
  tenantId: string
): Promise<ApiResponse<Subscription | null>> {
  if (USE_MOCKS) {
    return mockOk(findMockSubscriptionForTenant(tenantId) ?? null);
  }

  const result = await apiList<Subscription>(
    "/api/platform/subscriptions",
    "subscriptions",
    { tenantId, limit: 1 }
  );

  if (!result.success) return result;

  return { success: true, data: result.data.items[0] ?? null };
}

export async function updateSubscription(
  id: string,
  input: UpdateSubscriptionInput
): Promise<ApiResponse<Subscription>> {
  if (USE_MOCKS) {
    const subscription = findMockSubscription(id);
    if (!subscription) return mockFail<Subscription>("Subscription not found", "NOT_FOUND");

    return mockOk<Subscription>(
      { ...subscription, ...input, updatedAt: new Date().toISOString() },
      "Subscription updated"
    );
  }

  return apiRequest<Subscription>(`/api/platform/subscriptions/${id}`, {
    method: "PATCH",
    body: input,
  });
}
