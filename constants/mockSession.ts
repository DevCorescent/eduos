// ============================================================================
// MODULE : Constants — Mock Session Cookie
// PURPOSE: The wire format of the development-only session cookie, shared by
//          the client that writes it (services/auth.ts, on mock sign-in) and
//          the server that reads it (services/session.ts, in the portal guards).
//
//          It lives here rather than in either of those because
//          services/session.ts is marked "server-only" and so cannot be
//          imported from a client component. The encoding must be defined once:
//          two copies of a serialisation format is how a silent decode failure
//          gets introduced.
//
// SECURITY: Not a credential and not treated as one. It is unsigned and
//          readable by script, which is exactly why the reader gates on
//          NODE_ENV !== "production" before honouring it — a forged value must
//          not be able to grant anything in a deployed build. It carries no
//          secret; it records which demo account was chosen so the portal guards
//          and navigation have roles to work from.
// ============================================================================

/**
 * Not prefixed `edu_` like the real cookies (edu_access, edu_refresh).
 * The distinct name keeps it obvious in devtools that this is not a real
 * session, and guarantees it can never collide with one.
 */
export const MOCK_SESSION_COOKIE = "mock_session";

export interface MockSessionPayload {
  email: string;
  roles: string[];
}

/**
 * Encode for a cookie value.
 *
 * encodeURIComponent, because a cookie value may not contain the commas,
 * semicolons or spaces that JSON produces.
 */
export function encodeMockSession(payload: MockSessionPayload): string {
  return encodeURIComponent(JSON.stringify(payload));
}

/**
 * Decode a cookie value, or null if it is unusable.
 *
 * Every failure mode returns null rather than throwing: the value is
 * user-editable, so malformed input is expected, not exceptional. Throwing here
 * would crash a layout's render and lock the developer out of every portal with
 * no way back except clearing the cookie by hand.
 */
export function decodeMockSession(value: string | undefined): MockSessionPayload | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as MockSessionPayload).email === "string" &&
      Array.isArray((parsed as MockSessionPayload).roles) &&
      (parsed as MockSessionPayload).roles.every((role) => typeof role === "string")
    ) {
      return parsed as MockSessionPayload;
    }

    return null;
  } catch {
    return null;
  }
}
