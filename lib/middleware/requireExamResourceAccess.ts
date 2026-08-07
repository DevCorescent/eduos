// ============================================================================
// OWNER  : Gauransh
// MODULE : Question Paper & Solution Repository (Phase 26)
// LAYER  : Middleware (route guard)
// PURPOSE: Decide how much of the tenant's repository a staff caller may write
//          to, resolve their tenant, and gather the audit metadata — in ONE
//          call.
//
// WHY THE ELEVATED CHECK RUNS FIRST
//   Role precedence is administrative > faculty. Testing the admin set first
//   means the common HOD path costs ONE role call and only a faculty member
//   pays for a second. It also keeps the failure codes right: an anonymous
//   caller fails both and receives requireAuth's 401 from the second, so the
//   fallback cannot turn a 401 into a 403. Same arrangement as Phase 16's
//   requireResultAccess and Phase 23's requireFacultyProfileAccess.
//
// WHAT THIS DOES NOT DO
//   It never loads a resource and never compares uploadedById. It returns the
//   AUTHORITY; the service applies it, because enforcing the confinement needs
//   the repository and a route has no business holding one.
// ============================================================================

import type { NextResponse } from "next/server";
import { requireRole as defaultRequireRole } from "@/lib/middleware/requireRole";
import { requireTenant as defaultRequireTenant } from "@/lib/middleware/requireTenant";
import { readRequestOrigin } from "@/lib/middleware/requireAttendanceLockAccess";
import {
  EXAM_RESOURCE_ADMIN_ROLES,
  EXAM_RESOURCE_READ_ROLES,
} from "@/lib/constants/examResource";
import type { ExamResourceAccess } from "@/lib/services/examResource.service";
import type { ApiResponse } from "@/types";

/** Either the authority the caller holds, or the response to return as-is. */
export type ExamResourceAccessGuard =
  | { granted: true; access: ExamResourceAccess }
  | { granted: false; response: NextResponse<ApiResponse<never>> };

/** The guards this middleware composes. Injected so every branch is testable. */
export interface ExamResourceAccessDeps {
  requireRole: typeof defaultRequireRole;
  requireTenant: typeof defaultRequireTenant;
}

const DEFAULT_DEPS: ExamResourceAccessDeps = {
  requireRole: defaultRequireRole,
  requireTenant: defaultRequireTenant,
};

/**
 * Resolve a staff caller's repository authority and their tenant.
 *
 * ANY — an administrative caller: verifies, publishes, archives and deletes
 *       anything in their tenant.
 * OWN — a faculty member: reads everything, writes only their own uploads.
 *
 * COMPLEXITY : one or two role calls plus one tenant call.
 */
export async function requireExamResourceAccess(
  headers: Headers,
  deps: ExamResourceAccessDeps = DEFAULT_DEPS
): Promise<ExamResourceAccessGuard> {
  const origin = readRequestOrigin(headers);

  const elevated = await deps.requireRole(...EXAM_RESOURCE_ADMIN_ROLES);

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
        ipAddress: origin.ipAddress,
        userAgent: origin.userAgent,
      },
    };
  }

  // The full read set rather than FACULTY alone, so an anonymous caller fails
  // this second check and receives requireAuth's 401 rather than the 403 the
  // first check produced.
  const own = await deps.requireRole(...EXAM_RESOURCE_READ_ROLES);

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
      // The authenticated subject. The service compares this against
      // uploadedById; nothing a client sends can influence it.
      userId: own.session.sub,
      scope: "OWN",
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
    },
  };
}
