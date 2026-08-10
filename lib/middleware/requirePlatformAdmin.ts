// ============================================================================
// OWNER      : Gauransh
// MODULE     : Platform Authorization (W1.2)
// PURPOSE    : The single gate on every /api/platform route.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//   It never reads a tenant session, never reads `roles` from a tenant JWT, and
//   never compares a role NAME supplied by a token. That is the whole point:
//   the W1.1 audit reproduced a university admin granting themselves a tenant
//   Role called "SUPER_ADMIN" and reading every tenant on the platform, because
//   requireRole compared exactly such a string.
//
//   Authority here is proven by a PLATFORM session, which is minted only by the
//   platform login route, only after a PlatformUser authenticates. PlatformUser
//   has no tenantId and no tenant-writable column, so a tenant cannot cause one
//   to exist. A tenant token claiming roles: ["SUPER_ADMIN"] is inert — nothing
//   below looks at it.
//
// THE ROLE IS RE-READ FROM THE DATABASE, NOT TRUSTED FROM THE TOKEN
//   The token carries a role for convenience, but membership is confirmed
//   against PlatformUserRole on every request. A token issued before a role was
//   revoked would otherwise keep working until it expired — which for a
//   platform operator being removed is exactly the window that matters.
//   `isActive` is re-read for the same reason.
// ============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getPlatformSession, type PlatformJwtPayload } from "@/lib/auth/platformSession";
import { getSession } from "@/lib/auth/session";
import { fail } from "@/types";

/** The one platform role W1.2 defines. See the schema for why there is one. */
export const PLATFORM_ADMIN_ROLE = "PLATFORM_ADMIN";

/**
 * Why a refusal happened, for the ONE caller that must tell them apart.
 *
 * The platform layout redirects a "password change required" operator to the
 * form that fixes it, and everybody else to sign-in. Every API route ignores
 * this and simply returns `response` — the HTTP bodies are already correct.
 */
export type PlatformGuardDenial = "NO_SESSION" | "NOT_ADMIN" | "PASSWORD_CHANGE_REQUIRED";

export type PlatformGuardResult =
  | { authorized: true; session: PlatformJwtPayload; platformUserId: string }
  | { authorized: false; reason: PlatformGuardDenial; response: NextResponse };

/** No platform session at all — not signed in as an operator. */
function unauthenticated(): NextResponse {
  return NextResponse.json(fail("Unauthorized", "UNAUTHORIZED"), { status: 401 });
}

/**
 * Signed in, but not as a platform operator.
 *
 * Identical body whether the caller holds a tenant session, an expired platform
 * session or a platform identity whose role was revoked. Distinguishing them
 * would tell a probing tenant user which of those states they are in.
 */
function forbidden(): NextResponse {
  return NextResponse.json(fail("Forbidden", "FORBIDDEN"), { status: 403 });
}

/**
 * Require an active PLATFORM_ADMIN.
 *
 * @example
 * const guard = await requirePlatformAdmin()
 * if (!guard.authorized) return guard.response
 */
export async function requirePlatformAdmin(): Promise<PlatformGuardResult> {
  const session = await getPlatformSession();

  if (!session) {
    // No platform session. The STATUS depends on whether anybody is signed in
    // at all: an anonymous caller gets 401 ("authenticate"), a signed-in tenant
    // user gets 403 ("you are somebody, just not an operator").
    //
    // This is the ONE place a tenant session is read, and it is read ONLY to
    // choose a status code. It never grants anything: the tenant session's
    // roles are not inspected, and the function still returns unauthorized
    // whatever they contain. Removing this read would make every tenant user
    // see 401, which wrongly suggests signing in again would help.
    const tenantSession = await getSession();
    return {
      authorized: false,
      reason: "NO_SESSION",
      response: tenantSession ? forbidden() : unauthenticated(),
    };
  }

  const platformUser = await prisma.platformUser.findUnique({
    where: { id: session.sub },
    select: {
      id: true,
      isActive: true,
      mustChangePassword: true,
      platformUserRoles: { select: { platformRole: { select: { name: true } } } },
    },
  });

  // The identity was deleted while a valid token was still in circulation.
  if (!platformUser) return { authorized: false, reason: "NOT_ADMIN", response: forbidden() };

  if (!platformUser.isActive) {
    return { authorized: false, reason: "NOT_ADMIN", response: forbidden() };
  }

  const holdsAdmin = platformUser.platformUserRoles.some(
    (assignment) => assignment.platformRole.name === PLATFORM_ADMIN_ROLE
  );

  if (!holdsAdmin) return { authorized: false, reason: "NOT_ADMIN", response: forbidden() };

  // W1.3 — the account still holds a password another operator generated and
  // has seen. Refused HERE rather than in the UI, because a hint the frontend
  // may choose to honour is not a control: an operator with a temporary
  // password could otherwise call every /api/platform route directly.
  //
  // The one thing they CAN do is replace it, and that route deliberately does
  // not use this guard — it reads the platform session itself. This is not a
  // hole: it accepts nothing but the current password and a new one.
  //
  // The body names the state instead of answering a flat "Forbidden". Nothing
  // is disclosed by it — the caller has already authenticated as this account,
  // so they are being told something about themselves.
  if (platformUser.mustChangePassword) {
    return {
      authorized: false,
      reason: "PASSWORD_CHANGE_REQUIRED",
      response: NextResponse.json(
        fail("Password change required", "PASSWORD_CHANGE_REQUIRED"),
        { status: 403 }
      ),
    };
  }

  return { authorized: true, session, platformUserId: platformUser.id };
}
