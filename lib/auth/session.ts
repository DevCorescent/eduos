import { cookies, headers } from "next/headers";
import { verifyToken, type JwtPayload } from "./jwt";

const ACCESS_COOKIE = "edu_access";
const REFRESH_COOKIE = "edu_refresh";

/**
 * Read the raw access token for this request.
 *
 * Two transports are accepted, checked in this order:
 *
 *   1. `Authorization: Bearer <token>` — used by API clients (Postman, mobile,
 *      server-to-server), which have no browser cookie jar.
 *   2. The `edu_access` httpOnly cookie — used by the browser app.
 *
 * The header is checked first so an explicit credential always beats a stale
 * cookie. Both carry the same JWT that /api/auth/login issues and the same value
 * persisted on the Session row, so neither transport is privileged: whichever is
 * presented is verified and matched identically.
 *
 * Before this existed the system was cookie-only, so a Bearer token was silently
 * ignored and every authenticated request from an API client returned 401.
 */
export async function getAccessToken(): Promise<string | null> {
  const headerList = await headers();
  const authorization = headerList.get("authorization");

  if (authorization) {
    // Case-insensitive scheme, tolerant of surrounding whitespace, per RFC 7235.
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match) {
      const token = match[1].trim();
      if (token.length > 0) return token;
    }
  }

  const cookieStore = await cookies();
  return cookieStore.get(ACCESS_COOKIE)?.value ?? null;
}

/**
 * Read the raw refresh token for this request.
 *
 * Accepts the `edu_refresh` cookie or an `x-refresh-token` header, for the same
 * reason getAccessToken accepts a Bearer header. /api/auth/refresh additionally
 * accepts the token in its request body.
 */
export async function getRefreshTokenFromRequest(): Promise<string | null> {
  const headerList = await headers();
  const headerToken = headerList.get("x-refresh-token");
  if (headerToken && headerToken.trim().length > 0) return headerToken.trim();

  const cookieStore = await cookies();
  return cookieStore.get(REFRESH_COOKIE)?.value ?? null;
}

export async function getSession(): Promise<JwtPayload | null> {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<JwtPayload> {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export { ACCESS_COOKIE, REFRESH_COOKIE };
