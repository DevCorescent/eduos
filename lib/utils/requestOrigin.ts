// ============================================================================
// MODULE : Utils — Request origin
// PURPOSE: Read the caller's IP and user agent from request headers, for the
//          audit trail.
//
// WHY THIS MOVED HERE
//   The implementation was written for Phase 22 and lived inside
//   requireAttendanceLockAccess.ts, where only attendance locks could reach it.
//   WP-2 makes every audited route need it, and importing an attendance-lock
//   middleware from the login handler to read a header would be a dependency
//   that says something untrue about the code. The original export remains as a
//   re-export so no Phase 22 caller changes.
// ============================================================================

/**
 * Read the caller's origin from the request headers.
 *
 * `x-forwarded-for` may carry a comma-separated chain when several proxies are
 * in front of the app; the FIRST entry is the originating client and the rest
 * are the hops. Trimmed because the separator is conventionally ", ".
 *
 * Returns null rather than a placeholder when no header is present. An audit
 * entry saying "unknown" is indistinguishable from one where a proxy sent the
 * literal string, and null is the honest answer.
 *
 * NOT TRUSTED AS IDENTITY. Both headers are client-supplied and trivially
 * forged. They are recorded as what the request claimed, and no authorization
 * decision anywhere reads them.
 */
export function readRequestOrigin(headers: Headers): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const forwarded = headers.get("x-forwarded-for");
  const realIp = headers.get("x-real-ip");

  const ipAddress = forwarded?.split(",")[0]?.trim() || realIp?.trim() || null;

  return {
    ipAddress: ipAddress && ipAddress.length > 0 ? ipAddress : null,
    userAgent: headers.get("user-agent"),
  };
}
