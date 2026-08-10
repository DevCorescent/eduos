// ============================================================================
// MODULE : Domain — which tenant statuses may serve traffic
// PURPOSE: One definition of "this university is usable", shared by tenant
//          resolution and the tenant login route.
//
// WHY THIS IS AN ALLOW-LIST AND NOT A DENY-LIST
//   Both call sites used to deny-list: `status === "CANCELLED" || status ===
//   "SUSPENDED"`. W1.5 added ARCHIVED and both checks silently kept returning
//   true for it — an archived university would have gone on resolving and
//   issuing sessions, which is the precise opposite of what archiving means.
//   Live verification caught it; a deny-list is why it was possible at all.
//
//   Stated positively, a new status is refused until somebody deliberately adds
//   it here. That is the safe direction to fail: an unusable university that
//   should have been usable is a visible bug, while a usable one that should
//   have been archived is a silent data-exposure.
// ============================================================================

import type { TenantStatus } from "@/app/generated/prisma/enums";

/**
 * The statuses that may serve traffic.
 *
 * TRIAL is included because a trial university is a working one — that is what
 * a trial is. ACTIVE is the ordinary case. SUSPENDED, CANCELLED and ARCHIVED
 * are all refused, and each for its own reason, but the effect is the same:
 * hostnames stop resolving and sessions stop being issued.
 */
const SERVABLE_STATUSES: readonly TenantStatus[] = ["ACTIVE", "TRIAL"];

/**
 * Whether a tenant in this status may resolve and authenticate.
 *
 * Takes the status rather than the tenant so both callers can use it against
 * their own differently-shaped selects.
 */
export function isServableStatus(status: string): boolean {
  return (SERVABLE_STATUSES as readonly string[]).includes(status);
}
