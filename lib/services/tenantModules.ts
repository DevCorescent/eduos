// ============================================================================
// OWNER  : Gauransh
// MODULE : Tenant — Enabled modules
// LAYER  : Service (data access)
// PURPOSE: Decide, in ONE place, which modules a tenant has enabled.
//
// WHERE THE SELECTION LIVES
//   Subscription.features — the existing column the platform's
//   PUT /api/platform/tenants/[id]/modules already writes, validated against
//   the PRD §57 catalogue. No new model and no new column: the configuration
//   was always being stored correctly. What was missing is anything that READS
//   it, which is this file and the two guards built on it.
//
// ABSENT CONFIGURATION MEANS NO MODULES, NOT ALL MODULES
//   A tenant with no subscription, a null features map, or a map holding only
//   unrecognised keys has enabled NOTHING. That is the deliberate reading: the
//   opposite — treating "never configured" as "everything on" — would make the
//   switches unable to express a closed university, and would mean the safe
//   default was the permissive one. Only `alwaysOn` catalogue entries survive,
//   because the PRD describes no university without a dashboard or settings.
//
// FAILURE IS CLOSED, WITH ONE DELIBERATE EXCEPTION
//   A read that throws yields the alwaysOn set — the same answer as an
//   unconfigured tenant — rather than an open console. The exception is the
//   navigation filter, which treats a failure the same way for the same reason:
//   showing a link that every click answers 403 is worse than not showing it.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { UNIVERSITY_MODULES, partitionFeatures } from "@/lib/constants/modules";

/** Catalogue entries present for every university, never switchable. */
const ALWAYS_ON_MODULES: readonly string[] = UNIVERSITY_MODULES.filter((m) => m.alwaysOn).map(
  (m) => m.key
);

/**
 * The modules this tenant may use.
 *
 * INPUT   : a tenant id, always one already resolved by requireTenant — never a
 *           value from a request.
 * RETURNS : a set containing every explicitly-enabled catalogue key plus the
 *           alwaysOn entries. Never throws.
 *
 * A tenant may hold more than one Subscription row. Every row's map is folded
 * in and a module counts as enabled if ANY row enables it: a university paying
 * for a second plan that adds Fees has Fees, and the alternative — picking one
 * row by some rule the PRD does not state — would be inventing precedence.
 *
 * COMPLEXITY : one indexed read per call. Callers that need it more than once
 *              in a request should pass the result down rather than re-reading.
 */
export async function enabledModulesForTenant(tenantId: string): Promise<Set<string>> {
  const enabled = new Set<string>(ALWAYS_ON_MODULES);

  try {
    const subscriptions = await prisma.subscription.findMany({
      where: { tenantId },
      select: { features: true },
    });

    for (const subscription of subscriptions) {
      // partitionFeatures keeps unrecognised keys OUT of `modules`, so junk
      // already in the column — one tenant holds {"jhjj": true} — can never
      // become a capability. It is preserved in the column, just not honoured.
      const { modules } = partitionFeatures(
        subscription.features as Record<string, unknown> | null
      );

      for (const [key, isEnabled] of Object.entries(modules)) {
        if (isEnabled) enabled.add(key);
      }
    }
  } catch (err) {
    // Closed on failure: the caller receives exactly the alwaysOn set, which is
    // what an unconfigured tenant receives. An error must not open a module.
    console.error("[tenantModules] enabledModulesForTenant failed", err);
  }

  return enabled;
}
