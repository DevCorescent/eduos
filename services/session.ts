// ============================================================================
// MODULE : Services — Portal Session
// PURPOSE: Resolves the session a portal layout guards on, with a development
//          fallback so the UI can be built and reviewed before a database and
//          a JWT secret exist.
//
//          Without this the frontend is unbuildable in practice. Every portal
//          layout calls requireSession(), which needs a signed JWT in an
//          httpOnly cookie, which needs a live Postgres, a seeded tenant and a
//          seeded user. With no .env present, all four portals redirect to
//          /login and not one screen built in Phases 5-15 can be looked at.
//
// SECURITY: The fallback is gated on two independent conditions, both of which
//          must hold:
//            1. process.env.NODE_ENV !== "production"
//            2. USE_MOCKS (NEXT_PUBLIC_USE_MOCKS is not "false")
//
//          `next build` and `next start` both set NODE_ENV=production, so the
//          fallback is dead code in any deployed build regardless of how the
//          mock flag is set — condition 1 alone is sufficient, and condition 2
//          exists so that a developer running against a real API locally gets
//          the real guard too.
//
//          This changes nothing about the API. Every route still calls
//          requireRole / requireTenant against a real verified JWT, so the mock
//          session opens no data: with mocks on there is no request, and with
//          mocks off there is no mock session.
// ============================================================================

import "server-only";

import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import type { JwtPayload } from "@/lib/auth/jwt";
import { ROLES } from "@/constants/roles";
import { MOCK_SESSION_COOKIE, decodeMockSession } from "@/constants/mockSession";
import { USE_MOCKS } from "./config";

/**
 * The identity used when mocks are on and nobody has signed in.
 *
 * Holds every role, so a developer who lands on any portal URL directly — no
 * sign-in, no cookie — can still open it. Signing in through /login replaces
 * this with the chosen demo account's single role, which is what makes the
 * role-based redirect and the role-filtered navigation observable rather than
 * merely written.
 */
const DEFAULT_MOCK_SESSION: JwtPayload = {
  sub: "mock-user-1",
  tenantId: "mock-tenant-1",
  email: "admin@verify.edu",
  roles: [
    ROLES.SUPER_ADMIN,
    ROLES.UNIVERSITY_ADMIN,
    ROLES.CAMPUS_ADMIN,
    ROLES.HOD,
    ROLES.FACULTY,
    ROLES.STUDENT,
  ],
};

/** True only where the mock identity is permitted. See the SECURITY note above. */
export function isMockSessionEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && USE_MOCKS;
}

/**
 * The session a portal layout should guard on.
 *
 * RETURNS : the real JWT payload when a valid session cookie is present;
 *           otherwise the mock identity in development-with-mocks, or null.
 *
 * A real session always wins. Signing in for real during development gives the
 * real roles, so the guards can be exercised properly without touching this
 * file.
 *
 * @example
 * const session = await getPortalSession()
 * if (!session) redirect("/login")
 */
export async function getPortalSession(): Promise<JwtPayload | null> {
  // getSession() already swallows a malformed or unverifiable token and returns
  // null, which is the case that matters here: with no JWT_SECRET set,
  // verifyToken throws for every token.
  const session = await getSession();
  if (session) return session;

  if (!isMockSessionEnabled()) return null;

  // A demo account chosen at /login. Read only after the gate above, so a
  // forged cookie is inert in any production build.
  const cookieStore = await cookies();
  const chosen = decodeMockSession(cookieStore.get(MOCK_SESSION_COOKIE)?.value);

  if (chosen) {
    return {
      ...DEFAULT_MOCK_SESSION,
      sub: `mock-${chosen.email}`,
      email: chosen.email,
      roles: chosen.roles,
    };
  }

  return DEFAULT_MOCK_SESSION;
}
