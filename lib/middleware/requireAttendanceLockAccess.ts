// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Lock & Audit System (Phase 22)
// LAYER  : Middleware (route guard)
// PURPOSE: Authenticate the caller, check their role against the set the
//          PARTICULAR operation requires, resolve their tenant, and hand back
//          everything the route needs — in ONE call.
//
// TESTABILITY
//   The two guards are injected with defaults, matching the `client: DbClient =
//   prisma` convention the repositories use and the pattern
//   requireStudentProfileAccess established. That is what lets every branch be
//   exercised with no Next.js request context, no cookies and no database.
// ============================================================================

import type { NextResponse } from "next/server";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
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
 * Re-exported from lib/utils/requestOrigin.ts, where WP-2 moved it.
 *
 * Kept here so every Phase 22 caller keeps working unchanged. The
 * implementation is identical — it was moved, not rewritten — because the
 * login handler now needs it too and importing an attendance-lock middleware
 * to read a header would misdescribe the dependency.
 */
export { readRequestOrigin };

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
