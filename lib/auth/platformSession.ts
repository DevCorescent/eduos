// ============================================================================
// OWNER      : Gauransh
// MODULE     : Platform Authentication (W1.2)
// PURPOSE    : Mint and read a PLATFORM session — the credential that proves
//              somebody operates the EduOS platform rather than a university.
//
// 
// ============================================================================

import { cookies } from "next/headers";
import jwt from "jsonwebtoken";

/** Distinct from the tenant cookie, so the two can never be confused. */
export const PLATFORM_COOKIE = "edu_platform";

/**
 * The platform claim.
 *
 * `sessionType` is present and literal so a verifier can reject a tenant token
 * structurally rather than by noticing which fields are missing. There is no
 * tenantId and no `roles` array — a platform operator is not a member of any
 * university, and W1.2 defines exactly one platform role.
 */
export interface PlatformJwtPayload {
  readonly sessionType: "PLATFORM";
  readonly sub: string;
  readonly email: string;
  readonly role: string;
  /** Issued-at and expiry, in seconds. Written by jwt.sign, read for renewal. */
  readonly iat?: number;
  readonly exp?: number;
}

/** Matches the tenant access token's lifetime, for one session policy. */
const PLATFORM_TOKEN_TTL = "1h";
export const PLATFORM_COOKIE_MAX_AGE = 60 * 60;

/**
 * Re-issue the cookie once a session is more than halfway through its life.
 *
 * WHY THIS EXISTS
 *   The tenant session renews: there is an `edu_refresh` cookie and an
 *   /api/auth/refresh endpoint behind it. The platform session had neither. The
 *   cookie was written at login and never touched again, so a platform operator
 *   was signed out on a hard one-hour boundary, mid-task, with no warning — the
 *   "Unauthorized" testers hit when changing a tenant's status or archiving a
 *   tenant after working for an hour. Presenting that refusal more clearly does
 *   not stop it happening; renewing an ACTIVE session does.
 *
 * WHY HALFWAY RATHER THAN EVERY REQUEST
 *   A Set-Cookie on every authenticated request is pure overhead on a console
 *   that makes several calls per screen. Renewing in the second half of the
 *   lifetime gives an operator who makes any request at least thirty minutes of
 *   further work, which is what actually matters.
 */
export const PLATFORM_RENEW_AFTER_SECONDS = PLATFORM_COOKIE_MAX_AGE / 2;

/**
 * The signing key, read at CALL time rather than at import time.
 *
 * Module-level capture looks equivalent and is not: it binds whatever the
 * environment held when this module was first imported, which in a test run is
 * before the suite can configure one, and in some deployment orders is before
 * the runtime has loaded its secrets. Reading it here makes the value correct
 * whenever it is set.
 */
function secret(): string {
  const SECRET = process.env.JWT_SECRET;

  if (!SECRET) {
    // Refused rather than defaulted. A development fallback secret is how a
    // forgeable production token gets shipped.
    throw new Error("JWT_SECRET is not configured; platform sessions cannot be signed.");
  }
  return SECRET;
}

export function signPlatformToken(payload: Omit<PlatformJwtPayload, "sessionType">): string {
  return jwt.sign({ ...payload, sessionType: "PLATFORM" }, secret(), {
    expiresIn: PLATFORM_TOKEN_TTL,
  });
}

/**
 * Verify a platform token.
 *
 * The `sessionType` check is not decoration. Without it, a tenant token signed
 * by the same secret would verify here and its `sub` would be read as a
 * PlatformUser id — the exact confusion this module exists to prevent.
 */
export function verifyPlatformToken(token: string): PlatformJwtPayload | null {
  try {
    const decoded = jwt.verify(token, secret());

    if (
      typeof decoded !== "object" ||
      decoded === null ||
      (decoded as { sessionType?: unknown }).sessionType !== "PLATFORM"
    ) {
      return null;
    }

    return decoded as unknown as PlatformJwtPayload;
  } catch {
    // Expired, tampered, or signed with another key. All indistinguishable to
    // the caller on purpose.
    return null;
  }
}

/** The current platform session, or null. Reads only the platform cookie. */
export async function getPlatformSession(): Promise<PlatformJwtPayload | null> {
  const store = await cookies();
  const token = store.get(PLATFORM_COOKIE)?.value;
  return token ? verifyPlatformToken(token) : null;
}

/**
 * Cookie options for the platform token.
 *
 * `path: "/"` rather than "/super-admin" — the platform APIs live under
 * /api/platform, so scoping the cookie to the UI path would stop the guard
 * seeing it on exactly the requests that need it.
 */
export function platformCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/**
 * Extend an ALREADY-VERIFIED platform session that is past halfway.
 *
 * THIS GRANTS NOTHING.
 *   It is called only after requirePlatformAdmin has verified the signature,
 *   confirmed `sessionType: "PLATFORM"`, re-read the PlatformUser from the
 *   database and confirmed the account is still active and still holds the
 *   admin role. An expired token never reaches here — verifyPlatformToken
 *   rejects it and the caller answers 401, exactly as before. This only means
 *   that continuing to work keeps you signed in.
 *
 * NOR DOES IT OUTLIVE A REVOKED OPERATOR.
 *   Role and `isActive` are re-read on EVERY request, so an operator whose
 *   grant is removed is refused on their next call no matter how recently the
 *   cookie was renewed. Session length is not what bounds their access.
 *
 * WHY THE WRITE IS ALLOWED TO FAIL
 *   Cookies can only be set from a Route Handler or Server Function; Next.js
 *   throws if you set one while rendering a Server Component. The platform
 *   guard runs in both — route handlers AND the console's page layouts — so the
 *   failure is expected on the render path rather than exceptional. A page
 *   render that cannot renew is harmless: every screen in the console loads its
 *   data through a route handler, which can. Swallowing it here keeps a page
 *   from crashing over a cookie refresh it was never able to perform.
 */
export function shouldRenewPlatformSession(
  session: Pick<PlatformJwtPayload, "exp">,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  // A token with no expiry cannot be reasoned about. Not renewed rather than
  // renewed forever.
  if (session.exp === undefined) return false;

  const secondsRemaining = session.exp - nowSeconds;

  // Already expired: verifyPlatformToken would have rejected it before we got
  // here, so this is unreachable in practice — but renewing off an expired
  // claim is the one thing this must never do, so it is refused explicitly
  // rather than left to the caller's ordering.
  if (secondsRemaining <= 0) return false;

  return secondsRemaining <= PLATFORM_RENEW_AFTER_SECONDS;
}

export async function renewPlatformSession(session: PlatformJwtPayload): Promise<boolean> {
  if (!shouldRenewPlatformSession(session)) return false;

  // iat and exp are stripped: jwt.sign refuses a payload carrying them
  // alongside `expiresIn`, and the whole point is a NEW expiry.
  const token = signPlatformToken({
    sub: session.sub,
    email: session.email,
    role: session.role,
  });

  try {
    const store = await cookies();
    store.set(PLATFORM_COOKIE, token, platformCookieOptions(PLATFORM_COOKIE_MAX_AGE));
    return true;
  } catch {
    // Server Component render — see above. Not an error worth surfacing.
    return false;
  }
}
