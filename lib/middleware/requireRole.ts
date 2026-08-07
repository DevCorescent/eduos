// ============================================================================
// OWNER  : Gauransh
// MODULE : Authentication — Role Authorization Middleware
// FLOW   : Validates authenticated user's roles and authorizes access.
// ACCESS : Authenticated Users
// BACKEND: Uses UserRole and Role through existing Prisma schema.
// PURPOSE: Enforce RBAC without modifying authentication or tenant logic.
// ============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/middleware/requireAuth";
import type { JwtPayload } from "@/lib/auth/jwt";
import { fail, type ApiResponse } from "@/types";
import { requestScoped } from "@/lib/middleware/requestCache";

/**
 * Result of a role check.
 *
 * On failure the guard hands back an already-built NextResponse using the
 * project's existing envelope, so the calling route early-returns it as-is
 * instead of re-declaring status codes or error shapes. Mirrors the
 * AuthGuardResult contract in requireAuth.ts.
 */
export type RoleGuardResult =
  | { authorized: true; session: JwtPayload }
  | { authorized: false; response: NextResponse<ApiResponse<never>> };

/** Built on the rejection path — existing FORBIDDEN code and 403 status. */
function forbidden(): NextResponse<ApiResponse<never>> {
  return NextResponse.json(fail("Forbidden", "FORBIDDEN"), { status: 403 });
}

/**
 * Guard a route handler behind one or more roles.
 *
 * INPUT      : roles — role names permitted to proceed, passed variadically.
 *              Calling with no roles permits nobody (always 403); this is
 *              intentional so an accidentally-empty list fails closed.
 * VALIDATION : No request body is read, so no Zod schema applies. Authentication
 *              is delegated entirely to requireAuth, which verifies the JWT, the
 *              live Session row and the owning User's isActive flag.
 * RULES      : Authorization runs only after authentication succeeds, so an
 *              anonymous caller receives requireAuth's 401 and a signed-in
 *              caller lacking the role receives 403. Holding any one of the
 *              permitted roles is sufficient. No role is treated as a super-set
 *              of another. Roles are compared by name — never by id — because
 *              Role.name is the stable identifier across tenants while ids are
 *              per-row cuids.
 * DATABASE   : One read — UserRole.findMany for the authenticated user,
 *              traversing the UserRole → Role relation and selecting only
 *              Role.name. Resolving live rather than trusting the role claims
 *              embedded in the token means a revoked role takes effect on the
 *              next request instead of at token expiry.
 * TENANCY    : No tenant filter is applied here — tenant scoping belongs to
 *              requireTenant. Isolation still holds structurally: the query is
 *              scoped by userId, and a User belongs to exactly one tenant via
 *              the required User.tenantId, so its UserRole rows can only
 *              reference roles within that tenant.
 * RETURNS    : { authorized: true, session } — session carries sub, tenantId,
 *              email and roles for the route's own use.
 *              { authorized: false, response } — requireAuth's 401, or a 403.
 *
 * @example
 * export async function GET() {
 *   const guard = await requireRole("SUPER_ADMIN");
 *   if (!guard.authorized) return guard.response;
 *
 *   const { session } = guard;
 *   // ... session.tenantId is available for tenant-scoped queries
 * }
 */
export async function requireRole(...roles: string[]): Promise<RoleGuardResult> {
  const auth = await requireAuth();

  if (!auth.authenticated) {
    return { authorized: false, response: auth.response };
  }

  const { session } = auth;

  // The query does not depend on `roles` — it reads everything the user holds
  // and the comparison happens below — so a route that asks this guard twice
  // for two different role sets can share one read. GET /api/assignments does
  // exactly that, testing for staff first and then for STUDENT.
  const assignments = await requestScoped(`auth:roles:${session.sub}`, () =>
    prisma.userRole.findMany({
      where: { userId: session.sub },
      select: { role: { select: { name: true } } },
    })
  );

  const assignedRoleNames = assignments.map((assignment) => assignment.role.name);
  const hasPermittedRole = assignedRoleNames.some((name) => roles.includes(name));

  if (!hasPermittedRole) {
    return { authorized: false, response: forbidden() };
  }

  return { authorized: true, session };
}
