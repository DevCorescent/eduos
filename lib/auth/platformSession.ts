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
}

/** Matches the tenant access token's lifetime, for one session policy. */
const PLATFORM_TOKEN_TTL = "1h";
export const PLATFORM_COOKIE_MAX_AGE = 60 * 60;

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
