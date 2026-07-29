// ============================================================================
// OWNER  : Gauransh
// MODULE : Core Infrastructure — Authentication Guard
// FLOW   : getSession() verifies the edu_access JWT → the same cookie value is
//          matched against the Session row that /api/auth/login persisted and
//          /api/auth/refresh keeps current → the owning User's isActive flag is
//          re-checked → returns the session, or a prepared error response.
// ACCESS : Any authenticated user, any tenant. Performs NO role check — role
//          gating stays in requireRole, per the existing RBAC design.
// BACKEND: Reads ONLY the existing Session and User models via lib/db/prisma.
//          Read-only — no write, no new model, no schema change.
// PURPOSE: Single reusable authentication gate for routes that require a
//          signed-in caller but no specific role, so no route re-implements the
//          cookie → JWT → live-session chain.
// ============================================================================

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, ACCESS_COOKIE } from "@/lib/auth/session";
import type { JwtPayload } from "@/lib/auth/jwt";
import { fail, type ApiResponse } from "@/types";

/**
 * Result of an authentication check.
 *
 * On failure the guard hands back an already-built NextResponse using the
 * project's existing envelope, so the calling route early-returns it as-is
 * instead of re-declaring status codes or error shapes. This mirrors the
 * RoleGuardResult contract in requireRole.ts.
 */
export type AuthGuardResult =
  | { authenticated: true; session: JwtPayload }
  | { authenticated: false; response: NextResponse<ApiResponse<never>> };

/** Built once per rejection path — same envelope and code as /api/auth/me. */
function unauthorized(): NextResponse<ApiResponse<never>> {
  return NextResponse.json(fail("Unauthorized", "UNAUTHORIZED"), { status: 401 });
}

/**
 * Guard a route handler behind a live authenticated session.
 *
 * INPUT      : None. The caller is identified entirely by the edu_access cookie.
 * VALIDATION : No request body is read, so no Zod schema applies. The JWT
 *              signature and expiry are validated by the existing verifyToken()
 *              inside getSession().
 * RULES      : A token that merely carries a valid signature is not sufficient.
 *              The matching Session row must still exist and not be past its
 *              expiresAt, so that /api/auth/logout (which deletes by token) and
 *              /api/auth/refresh (which rotates it) take effect immediately
 *              rather than after the 7-day token lifetime. A deactivated user
 *              is rejected as FORBIDDEN, not UNAUTHORIZED: identity is proven,
 *              access has been withdrawn.
 * DATABASE   : One read — Session.findUnique by the unique token, selecting
 *              only expiresAt and the owning User's isActive flag.
 * RETURNS    : { authenticated: true, session } — session carries sub, tenantId,
 *              email and roles for the route's own tenant scoping.
 *              { authenticated: false, response } — a 401 or 403 to return.
 *
 * @example
 * export async function GET() {
 *   const auth = await requireAuth();
 *   if (!auth.authenticated) return auth.response;
 *
 *   const { session } = auth;
 *   // ... session.tenantId is available for tenant-scoped queries
 * }
 */
export async function requireAuth(): Promise<AuthGuardResult> {
  const session = await getSession();

  if (!session) {
    return { authenticated: false, response: unauthorized() };
  }

  // getSession() has already read and verified this cookie, but it returns the
  // decoded payload rather than the token itself. Re-reading the raw value is
  // the only way to match the persisted Session row without altering
  // lib/auth/session.ts.
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_COOKIE)?.value;

  if (!token) {
    return { authenticated: false, response: unauthorized() };
  }

  const storedSession = await prisma.session.findUnique({
    where: { token },
    select: {
      expiresAt: true,
      user: { select: { isActive: true } },
    },
  });

  // A missing row means the session was ended by /api/auth/logout or superseded
  // by /api/auth/refresh. Either way the token is no longer live.
  if (!storedSession || storedSession.expiresAt < new Date()) {
    return { authenticated: false, response: unauthorized() };
  }

  if (!storedSession.user.isActive) {
    return {
      authenticated: false,
      response: NextResponse.json(fail("Account is inactive", "FORBIDDEN"), { status: 403 }),
    };
  }

  return { authenticated: true, session };
}
