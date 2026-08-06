// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Profile Portal
// LAYER  : Middleware (route guard)
// PURPOSE: Authenticate the caller, check their role, resolve their tenant, and
//          hand back the two values every profile route needs — in ONE call.
//
// WHY THIS EXISTS RATHER THAN SIX INLINE LINES PER ROUTE
//   All three profile routes share one entry rule exactly: a permitted role,
//   a resolved tenant, and the caller's OWN user id. Written inline that is the
//   same six lines in three files, and the day the rule changes two get updated
//   and one is forgotten — which in a self-service module is how a student ends
//   up reading someone else's record. Stated once, it cannot drift.
//
// WHAT IT RETURNS, AND WHAT IT DELIBERATELY DOES NOT
//   It returns `tenantId` and `userId`. It does NOT return a studentId and has
//   no way to obtain one — resolving the caller to their Student row is the
//   SERVICE's job, because that resolution needs a repository and a route has
//   no business holding one. The split is the same one Phase 16's
//   requireResultAccess and Phase 17's finance routes already use: the route
//   layer decides WHO is asking, the service decides WHOSE record exists.
//
//   `userId` is taken from `session.sub` — the authenticated subject — and is
//   therefore not something a client can influence. No profile route reads an
//   identifier from the path or the query, so there is nothing for a caller to
//   substitute.
//
// ROLE THEN TENANT, IN THAT ORDER
//   requireRole runs first so an unauthenticated caller receives requireAuth's
//   401 from it rather than a tenant-shaped error, and a caller with a valid
//   session but the wrong role receives 403 without the tenant lookup being
//   performed at all. Reversing them would leak the existence of a tenant to
//   someone not permitted to reach the module.
//
// TESTABILITY
//   The two guards are injected with defaults, matching the `client: DbClient =
//   prisma` convention the repositories already use. That is what lets every
//   branch below be exercised with no Next.js request context, no cookies and
//   no database — see the accompanying test.
// ============================================================================

import type { NextResponse } from "next/server";
import { requireRole as defaultRequireRole } from "@/lib/middleware/requireRole";
import { requireTenant as defaultRequireTenant } from "@/lib/middleware/requireTenant";
import { STUDENT_PROFILE_ROLES } from "@/lib/constants/studentProfile";
import type { ApiResponse } from "@/types";

/** Everything a profile route needs about its caller. */
export interface StudentProfileAccess {
  /** The tenant the request resolved to. */
  readonly tenantId: string;
  /** The authenticated subject. Never client-supplied. */
  readonly userId: string;
}

/** Either the caller's context, or the response to return to them as-is. */
export type StudentProfileAccessGuard =
  | { granted: true; access: StudentProfileAccess }
  | { granted: false; response: NextResponse<ApiResponse<never>> };

/** The guards this middleware composes. Injected so every branch is testable. */
export interface StudentProfileAccessDeps {
  requireRole: typeof defaultRequireRole;
  requireTenant: typeof defaultRequireTenant;
}

const DEFAULT_DEPS: StudentProfileAccessDeps = {
  requireRole: defaultRequireRole,
  requireTenant: defaultRequireTenant,
};

/**
 * Guard a student-profile route.
 *
 * Returns `granted: false` carrying an already-built response, so the calling
 * route early-returns it verbatim rather than re-declaring status codes or
 * error shapes — the same contract requireRole and requireTenant themselves
 * use, and the reason the envelope stays consistent across the project.
 *
 * COMPLEXITY : two awaited guard calls, no database work of its own.
 */
export async function requireStudentProfileAccess(
  deps: StudentProfileAccessDeps = DEFAULT_DEPS
): Promise<StudentProfileAccessGuard> {
  const guard = await deps.requireRole(...STUDENT_PROFILE_ROLES);

  if (!guard.authorized) {
    return { granted: false, response: guard.response };
  }

  const tenantGuard = await deps.requireTenant();

  if (!tenantGuard.resolved) {
    return { granted: false, response: tenantGuard.response };
  }

  return {
    granted: true,
    access: {
      tenantId: tenantGuard.tenant.id,
      // The authenticated subject. A student who owns no Student row in this
      // tenant still reaches the service, which refuses them with 403 — the
      // route layer cannot make that determination without a repository.
      userId: guard.session.sub,
    },
  };
}
