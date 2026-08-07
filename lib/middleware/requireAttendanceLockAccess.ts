// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Lock & Audit System (Phase 22)
// LAYER  : Middleware (route guard)
// PURPOSE: Authenticate the caller, check their role against the set the
//          PARTICULAR operation requires, resolve their tenant, and hand back
//          everything the route needs — in ONE call.
//
// WHY THIS TAKES THE ROLE SET AS AN ARGUMENT
//   The four Phase 22 endpoints do NOT share one entry rule. Locking admits
//   FACULTY; unlocking must not, or the lock is a suggestion a faculty member
//   can talk their way past (see lib/constants/attendanceLock.ts). A single
//   fixed-role guard would have to be the union of the two, and the difference
//   between them is the entire security property of this phase. So the guard is
//   parameterised, and each route names the set it means.
//
// WHAT IT RETURNS
//   tenantId, the authenticated userId, and the request metadata every audited
//   write records. The metadata is gathered HERE rather than in each route
//   because all four headers are read the same way and an audit entry missing
//   its origin is materially less useful than one carrying it.
//
// ROLE THEN TENANT, IN THAT ORDER
//   requireRole runs first so an unauthenticated caller receives requireAuth's
//   401 rather than a tenant-shaped error, and a caller with a valid session but
//   the wrong role receives 403 without the tenant lookup happening at all.
//   Reversing them would leak the existence of a tenant to someone not
//   permitted to reach the module. Same ordering as
//   requireStudentProfileAccess and requireFeedbackAccess.
//
// TESTABILITY
//   The two guards are injected with defaults, matching the `client: DbClient =
//   prisma` convention the repositories use and the pattern
//   requireStudentProfileAccess established. That is what lets every branch be
//   exercised with no Next.js request context, no cookies and no database.
// ============================================================================

import type { NextResponse } from "next/server";
import { requireRole as defaultRequireRole } from "@/lib/middleware/requireRole";
import { requireTenant as defaultRequireTenant } from "@/lib/middleware/requireTenant";
import type { ApiResponse } from "@/types";

/** Everything a Phase 22 route needs about its caller. */
export interface AttendanceLockAccess {
  /** The tenant the request resolved to. Never client-supplied. */
  readonly tenantId: string;
  /** The authenticated subject. Never client-supplied. */
  readonly userId: string;
  /** Origin of the request, recorded on every audited write. */
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/** Either the caller's context, or the response to return to them as-is. */
export type AttendanceLockAccessGuard =
  | { granted: true; access: AttendanceLockAccess }
  | { granted: false; response: NextResponse<ApiResponse<never>> };

/** The guards this middleware composes. Injected so every branch is testable. */
export interface AttendanceLockAccessDeps {
  requireRole: typeof defaultRequireRole;
  requireTenant: typeof defaultRequireTenant;
}

const DEFAULT_DEPS: AttendanceLockAccessDeps = {
  requireRole: defaultRequireRole,
  requireTenant: defaultRequireTenant,
};

/**
 * Read the caller's origin from the request headers.
 *
 * `x-forwarded-for` may carry a comma-separated chain when several proxies are
 * in front of the app; the FIRST entry is the originating client and the rest
 * are the hops. Trimmed because the separator is conventionally ", ".
 *
 * Returns null rather than a placeholder when no header is present. An audit
 * entry saying "unknown" is indistinguishable from one where a proxy sent the
 * literal string, and null is the honest answer.
 */
export function readRequestOrigin(headers: Headers): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const forwarded = headers.get("x-forwarded-for");
  const realIp = headers.get("x-real-ip");

  const ipAddress =
    forwarded?.split(",")[0]?.trim() ||
    realIp?.trim() ||
    null;

  return {
    ipAddress: ipAddress && ipAddress.length > 0 ? ipAddress : null,
    userAgent: headers.get("user-agent"),
  };
}

/**
 * Guard a Phase 22 route behind a named role set.
 *
 * Returns `granted: false` carrying an already-built response, so the calling
 * route early-returns it verbatim rather than re-declaring status codes or
 * error shapes — the same contract requireRole and requireTenant use.
 *
 * @param roles the set THIS operation requires. Never a project-wide default:
 *        lock, unlock and read each name their own.
 * @param headers the request headers, for audit attribution.
 *
 * COMPLEXITY : two awaited guard calls, no database work of its own.
 */
export async function requireAttendanceLockAccess(
  roles: readonly string[],
  headers: Headers,
  deps: AttendanceLockAccessDeps = DEFAULT_DEPS
): Promise<AttendanceLockAccessGuard> {
  const guard = await deps.requireRole(...roles);

  if (!guard.authorized) {
    return { granted: false, response: guard.response };
  }

  const tenantGuard = await deps.requireTenant();

  if (!tenantGuard.resolved) {
    return { granted: false, response: tenantGuard.response };
  }

  const origin = readRequestOrigin(headers);

  return {
    granted: true,
    access: {
      tenantId: tenantGuard.tenant.id,
      userId: guard.session.sub,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
    },
  };
}
