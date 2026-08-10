// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Profile & Performance Analytics (Phase 23)
// LAYER  : Middleware (route guard)
// PURPOSE: Decide how much of the tenant a faculty-profile caller may reach,
//          and resolve their tenant — in ONE call.
//
// WHY THIS IS ONE FUNCTION AND NOT FIVE COPIES
//   All five Phase 23 endpoints share one authorisation rule exactly: an
//   administrative caller reaches anyone in their tenant, a faculty member
//   reaches only themselves. Written inline that is the same twenty lines in
//   five files, and the day the rule changed four would be updated and one
//   forgotten — which in a module exposing another person's feedback scores is
//   how a lecturer ends up reading a colleague's rating.
//
// WHY THE ELEVATED CHECK RUNS FIRST
//   Role precedence is administrative > faculty. Testing the elevated set first
//   means the common administrative path costs ONE role call and only a faculty
//   member pays for a second. It also keeps the failure codes right: an
//   anonymous caller fails both and receives requireAuth's 401 from the second,
//   so the fallback cannot turn a 401 into a 403. Same arrangement, and same
//   reasoning, as Phase 16's requireResultAccess.
//
// WHAT THIS DOES NOT DO
//   It never resolves a FacultyMember row and never compares ids. It returns
//   the AUTHORITY; the service applies it, because enforcing the confinement
//   needs the repository and a route has no business holding one.
// ============================================================================

import type { NextResponse } from "next/server";
import { requireRole as defaultRequireRole } from "@/lib/middleware/requireRole";
import { requireTenant as defaultRequireTenant } from "@/lib/middleware/requireTenant";
import {
  FACULTY_PROFILE_ADMIN_ROLES,
  FACULTY_PROFILE_ROLES,
} from "@/lib/constants/facultyProfile";
import type { FacultyAccessContext } from "@/lib/services/facultyProfile.service";
import type { ApiResponse } from "@/types";

/** Either the authority the caller holds, or the response to return as-is. */
export type FacultyProfileAccessGuard =
  | { granted: true; access: FacultyAccessContext }
  | { granted: false; response: NextResponse<ApiResponse<never>> };

/** The guards this middleware composes. Injected so every branch is testable. */
export interface FacultyProfileAccessDeps {
  requireRole: typeof defaultRequireRole;
  requireTenant: typeof defaultRequireTenant;
}

const DEFAULT_DEPS: FacultyProfileAccessDeps = {
  requireRole: defaultRequireRole,
  requireTenant: defaultRequireTenant,
};

/**
 * Resolve a caller's faculty-profile authority and their tenant.
 *
 * The requested facultyId is deliberately NOT a parameter: this function
 * decides WHAT the caller may reach, never WHICH record they asked for.
 *
 * COMPLEXITY : one or two role calls plus one tenant call. No database work of
 *              its own beyond what those guards perform.
 */
export async function requireFacultyProfileAccess(
  deps: FacultyProfileAccessDeps = DEFAULT_DEPS
): Promise<FacultyProfileAccessGuard> {
  const elevated = await deps.requireRole(...FACULTY_PROFILE_ADMIN_ROLES);

  if (elevated.authorized) {
    const tenantGuard = await deps.requireTenant();

    if (!tenantGuard.resolved) {
      return { granted: false, response: tenantGuard.response };
    }

    return {
      granted: true,
      access: {
        tenantId: tenantGuard.tenant.id,
        userId: elevated.session.sub,
        scope: "ANY",
      },
    };
  }

  // The full set rather than FACULTY alone, so an anonymous caller fails this
  // second check and receives requireAuth's 401 rather than the 403 the first
  // check produced.
  const own = await deps.requireRole(...FACULTY_PROFILE_ROLES);

  if (!own.authorized) {
    return { granted: false, response: own.response };
  }

  const tenantGuard = await deps.requireTenant();

  if (!tenantGuard.resolved) {
    return { granted: false, response: tenantGuard.response };
  }

  return {
    granted: true,
    access: {
      tenantId: tenantGuard.tenant.id,
      // The authenticated subject. The service resolves this to the caller's
      // OWN FacultyMember row; nothing a client sends can influence it.
      userId: own.session.sub,
      scope: "OWN",
    },
  };
}
