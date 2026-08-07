// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : Middleware (route guard)
// PURPOSE: Authenticate, authorise and resolve the tenant for the five
//          open-elective routes — which do NOT share one entry rule.
//
// THIS MODULE IS DUAL-MODE, AND THAT IS THE WHOLE REASON IT EXISTS
//   Phases 17 and 18 were purely self-service: one guard, one rule, every
//   route. Phase 19 is not. Three different questions are asked:
//
//     READ    who may see the catalogue?          staff AND students
//     SELECT  who may submit preferences?         students ONLY
//     MANAGE  who may allocate or lock?           staff ONLY
//
//   Collapsing them into one guard would mean the widest rule applied
//   everywhere, and a student would reach the allocate endpoint. Three
//   functions with three role sets is not duplication — it is three rules
//   that genuinely differ, each stated once.
//
// READ RETURNS AN AUTHORITY, NOT A USER
//   The catalogue is the only endpoint both audiences reach, and they see
//   different things: staff get the plain list, a student gets it annotated
//   with their own eligibility. So the guard reports WHICH audience the caller
//   belongs to and the service acts on that — the same ANY/OWN split Phase 16's
//   requireResultAccess established, for the same reason.
//
// ROLE BEFORE TENANT, EVERYWHERE
//   An unauthenticated caller receives requireAuth's 401 through requireRole,
//   and a wrongly-roled one receives 403 without a tenant lookup running at
//   all. Reversing them would leak a tenant's existence to someone not
//   permitted to reach the module.
//
// NO STUDENT ID, EVER
//   None of these functions resolves a Student row and none returns one. That
//   resolution needs a repository, and a route has no business holding one —
//   the service does it, from `userId`, which comes from the authenticated
//   subject and not from anything a client sent.
//
// TESTABILITY
//   Both guards are injected with defaults, matching the `client: DbClient =
//   prisma` convention the repositories already use, so every branch below is
//   exercisable with no Next.js request context and no cookies.
// ============================================================================

import type { NextResponse } from "next/server";
import { requireRole as defaultRequireRole } from "@/lib/middleware/requireRole";
import { requireTenant as defaultRequireTenant } from "@/lib/middleware/requireTenant";
import {
  ELECTIVE_MANAGE_ROLES,
  ELECTIVE_READ_ROLES,
  ELECTIVE_SELECT_ROLES,
} from "@/lib/constants/openElective";
import { ROLES } from "@/constants/roles";
import type { ElectiveAccess } from "@/lib/services/openElective.service";
import type { ApiResponse } from "@/types";

/** What a route needs about its caller, plus the authority they hold. */
export interface OpenElectiveContext {
  readonly tenantId: string;
  /** The authenticated subject. Never client-supplied. */
  readonly userId: string;
  readonly access: ElectiveAccess;
}

/** Either the caller's context, or the response to return to them as-is. */
export type OpenElectiveGuard =
  | { granted: true; context: OpenElectiveContext }
  | { granted: false; response: NextResponse<ApiResponse<never>> };

/** The guards this middleware composes. Injected so every branch is testable. */
export interface OpenElectiveAccessDeps {
  requireRole: typeof defaultRequireRole;
  requireTenant: typeof defaultRequireTenant;
}

const DEFAULT_DEPS: OpenElectiveAccessDeps = {
  requireRole: defaultRequireRole,
  requireTenant: defaultRequireTenant,
};

/**
 * The shared half of all three guards: check a role set, then resolve a tenant.
 *
 * `access` is decided by the caller of this helper rather than derived here,
 * because the three entry points mean three different things by it — and a
 * helper that guessed would be the one place the dual-mode split could go
 * wrong silently.
 */
async function guardWith(
  roles: readonly string[],
  access: (userId: string) => ElectiveAccess,
  deps: OpenElectiveAccessDeps
): Promise<OpenElectiveGuard> {
  const guard = await deps.requireRole(...roles);

  if (!guard.authorized) {
    return { granted: false, response: guard.response };
  }

  const tenantGuard = await deps.requireTenant();

  if (!tenantGuard.resolved) {
    return { granted: false, response: tenantGuard.response };
  }

  return {
    granted: true,
    context: {
      tenantId: tenantGuard.tenant.id,
      userId: guard.session.sub,
      access: access(guard.session.sub),
    },
  };
}

/**
 * GET /api/open-electives — the catalogue.
 *
 * Admits staff and students alike, and reports WHICH. A caller holding an
 * elevated role is STAFF even if they also happen to be a student: the elevated
 * reading is the wider one, and a department head browsing the catalogue wants
 * the department's view rather than their own eligibility.
 *
 * The elevated set is tested FIRST so the common path costs one guard call and
 * only a student pays for a second.
 */
export async function requireElectiveRead(
  deps: OpenElectiveAccessDeps = DEFAULT_DEPS
): Promise<OpenElectiveGuard> {
  const elevated = await deps.requireRole(...ELECTIVE_MANAGE_ROLES);

  if (elevated.authorized) {
    return guardWith(ELECTIVE_MANAGE_ROLES, () => ({ scope: "STAFF" }), deps);
  }

  return guardWith(
    ELECTIVE_READ_ROLES,
    (userId) => ({ scope: "STUDENT", userId }),
    deps
  );
}

/**
 * POST /api/open-electives/select — submitting preferences.
 *
 * STUDENT alone. An administrator choosing on a student's behalf would be
 * indistinguishable in the data from the student choosing, and preference order
 * is the input to an allocation someone may later dispute.
 */
export async function requireElectiveSelect(
  deps: OpenElectiveAccessDeps = DEFAULT_DEPS
): Promise<OpenElectiveGuard> {
  return guardWith(
    ELECTIVE_SELECT_ROLES,
    (userId) => ({ scope: "STUDENT", userId }),
    deps
  );
}

/**
 * GET /api/open-electives/status — a student's own position.
 *
 * Same rule as SELECT: the endpoint answers "what did I choose and what came of
 * it", which only the student themselves is asking.
 */
export const requireElectiveStatus = requireElectiveSelect;

/**
 * POST /allocate and PATCH /lock — the offering's own lifecycle.
 *
 * Staff only. STUDENT is absent from ELECTIVE_MANAGE_ROLES, and that absence is
 * what stops a student allocating seats to themselves.
 */
export async function requireElectiveManage(
  deps: OpenElectiveAccessDeps = DEFAULT_DEPS
): Promise<OpenElectiveGuard> {
  return guardWith(ELECTIVE_MANAGE_ROLES, () => ({ scope: "STAFF" }), deps);
}

/** Exported for the guard's own test, so the role sets are asserted in one place. */
export const ELECTIVE_GUARD_ROLES = {
  READ: ELECTIVE_READ_ROLES,
  SELECT: ELECTIVE_SELECT_ROLES,
  MANAGE: ELECTIVE_MANAGE_ROLES,
  STUDENT: ROLES.STUDENT,
} as const;
