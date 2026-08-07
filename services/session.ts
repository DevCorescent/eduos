// ============================================================================
// MODULE : Services — Portal Session
// PURPOSE: Resolves the session a portal layout guards on.
//
//          One function, one source: the signed JWT in the httpOnly session
//          cookie. There is no development fallback identity — a portal that
//          renders for nobody would show whatever the API returns for an
//          unauthenticated caller, which is an error state dressed up as a
//          page. Signing in is the only way in.
//
// SECURITY: This is a convenience wrapper for layouts, NOT access control.
//          Every route under app/api independently calls requireAuth /
//          requireRole / requireTenant against the same verified JWT, so a
//          layout that forgot to redirect still cannot read another tenant's
//          rows.
// ============================================================================

import "server-only";

import { getSession } from "@/lib/auth/session";
import type { JwtPayload } from "@/lib/auth/jwt";

/**
 * The session a portal layout should guard on.
 *
 * RETURNS the verified JWT payload, or null when the cookie is absent,
 * expired, or unverifiable — getSession() swallows those and returns null
 * rather than throwing, so a missing JWT_SECRET reads as "signed out".
 *
 * @example
 * const session = await getPortalSession()
 * if (!session) redirect("/login")
 */
export async function getPortalSession(): Promise<JwtPayload | null> {
  return getSession();
}
