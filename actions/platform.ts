"use server";

// ============================================================================
// MODULE : Actions — Platform Administration
// PURPOSE: The platform console's mutations, as Server Actions.
//
//          Run on the server so the httpOnly session cookie never has to be
//          readable from client JavaScript; services/client.ts forwards it and
//          the tenant host onto the outbound request.
// ============================================================================

import { updateSubscription } from "@/services/subscriptions";
import type { ActionResult } from "./setup";

/**
 * Replace a tenant's feature flags.
 *
 * The WHOLE map is sent because PATCH replaces the `features` column rather
 * than merging into it — sending only the key that changed would delete every
 * other flag the tenant holds. The caller is responsible for passing the full
 * set, which is why the screen reads the current map before editing it.
 */
export async function updateFeatureFlagsAction(
  subscriptionId: string,
  features: Record<string, unknown>
): Promise<ActionResult> {
  return updateSubscription(subscriptionId, { features });
}
