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

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession, getAccessToken } from "@/lib/auth/session";
import type { JwtPayload } from "@/lib/auth/jwt";
import { fail, type ApiResponse } from "@/types";
import { requestScoped } from "@/lib/middleware/requestCache";

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
export interface RequireAuthOptions {
  /**
   * Permit a caller whose password must still be changed (W1.4).
   *
   * Set by exactly ONE route — POST /api/auth/change-password — which is the
   * act that clears the flag. Every other tenant route leaves it false, so an
   * account holding a password somebody else generated can do that one thing
   * and nothing else. Gating here rather than in the UI is what makes it a
   * control: the forced change cannot be skipped by calling the API directly.
   */
  readonly allowPasswordChangeRequired?: boolean;
}

export async function requireAuth(
  options: RequireAuthOptions = {}
): Promise<AuthGuardResult> {
  const session = await getSession();

  if (!session) {
    return { authenticated: false, response: unauthorized() };
  }

  // getSession() has already read and verified this token, but it returns the
  // decoded payload rather than the raw value. getAccessToken() re-reads that
  // raw value through the SAME transport resolution — Authorization: Bearer
  // first, then the edu_access cookie — so a Bearer-authenticated caller matches
  // its persisted Session row. Reading the cookie directly here (as this did
  // before) made every Bearer request fail the lookup and return 401 even with a
  // perfectly valid token.
  const token = await getAccessToken();

  if (!token) {
    return { authenticated: false, response: unauthorized() };
  }

  // Read once per request. requireRole and requireTenant both call this guard,
  // and a route that uses both was issuing this identical query two or three
  // times. The token is part of the key, so two different credentials in one
  // request could not share an entry even if that were possible.
  const storedSession = await requestScoped(`auth:session:${token}`, () =>
    prisma.session.findUnique({
      where: { token },
      select: {
        expiresAt: true,
        user: { select: { isActive: true, mustChangePassword: true } },
      },
    })
  );

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

  // W1.4 — the account still holds a password another person generated and has
  // seen. Read from the database on every request rather than from the token,
  // for the same reason isActive is: a token minted before the flag was set
  // would otherwise keep working until it expired, which for an initial
  // credential is the entire window that matters.
  //
  // The body names the state instead of answering a flat "Forbidden". Nothing
  // is disclosed by it — the caller has already authenticated as this account,
  // so they are being told something about themselves.
  if (storedSession.user.mustChangePassword && !options.allowPasswordChangeRequired) {
    return {
      authenticated: false,
      response: NextResponse.json(
        fail("Password change required", "PASSWORD_CHANGE_REQUIRED"),
        { status: 403 }
      ),
    };
  }

  return { authenticated: true, session };
}
