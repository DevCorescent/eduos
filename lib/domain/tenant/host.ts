// ============================================================================
// OWNER      : Gauransh
// MODULE     : Tenant Domains (WP-3, PRD §5.2)
// LAYER      : Domain
// PURPOSE    : Turn a raw request host into the exact string a Domain row is
//              stored as, and decide whether a host is a platform subdomain.
//              Pure — no database, no headers, no environment.
//
// WHY NORMALISATION IS ITS OWN TESTED FUNCTION
//   A hostname arrives in more shapes than it looks like it should:
//   "AKTU.Eduos.com", "aktu.eduos.com:3000", "aktu.eduos.com." (the DNS root
//   dot, which browsers do send), and via x-forwarded-host as a comma-separated
//   chain when proxies stack. Each of those is the SAME host, and a comparison
//   that misses one silently fails to resolve a tenant whose domain is
//   configured correctly — which looks like a database problem and is not.
//
//   Getting this wrong in the other direction is worse: matching too loosely
//   points one hostname at another institution's data.
// ============================================================================

/**
 * Reduce a request host to its canonical, comparable form.
 *
 * - takes the FIRST entry of an `x-forwarded-host` chain (the originating host;
 *   the rest are proxy hops)
 * - lower-cases, since DNS is case-insensitive but string comparison is not
 * - strips the port, which is transport and not identity
 * - strips one trailing dot, the fully-qualified DNS root that browsers send
 *
 * Returns null for anything that cannot be a hostname, so a caller cannot
 * accidentally look up the empty string.
 *
 * DELIBERATELY DOES NOT strip "www.". Whether `www.university.edu` and
 * `university.edu` are the same institution is a configuration decision — the
 * PRD's "Canonical domain configuration" (§5.2) — not a parsing one. Treating
 * them as identical here would silently resolve a hostname nobody registered.
 */
export function normaliseHost(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const first = raw.split(",")[0]?.trim();
  if (!first) return null;

  // Port. Guarded against an IPv6 literal, where colons are part of the address
  // rather than a separator — those arrive bracketed, e.g. "[::1]:3000".
  const withoutPort = first.startsWith("[")
    ? first.replace(/\](:\d+)$/, "]")
    : first.split(":")[0];

  const lowered = withoutPort.toLowerCase();

  // One trailing dot only. "host.." is malformed, not a fully-qualified name.
  const withoutRootDot = lowered.endsWith(".") ? lowered.slice(0, -1) : lowered;

  return withoutRootDot.length > 0 ? withoutRootDot : null;
}

/**
 * The platform subdomain a host names, if it names one.
 *
 * `aktu.eduos.com` under root `eduos.com` gives "aktu". Anything else gives
 * null, including the root itself and its www form.
 *
 * THE LEADING DOT IS THE WHOLE SECURITY PROPERTY. A bare
 * `host.endsWith(rootDomain)` also matches `evil-eduos.com`, which would hand
 * an attacker-registered domain a tenant slug of their choosing. Requiring
 * `.eduos.com` cannot match it: the character before the root must be a dot.
 *
 * A multi-label prefix — `a.b.eduos.com` — returns "a.b", which matches no slug
 * and therefore resolves to nothing. That is the correct outcome: it is not a
 * tenant subdomain, and inventing a rule to take only the first label would
 * make `evil.aktu.eduos.com` resolve to AKTU.
 */
export function platformSubdomain(
  normalisedHost: string,
  rootDomain: string
): string | null {
  const root = normaliseHost(rootDomain);
  if (!root) return null;

  if (normalisedHost === root || normalisedHost === `www.${root}`) return null;

  const suffix = `.${root}`;
  if (!normalisedHost.endsWith(suffix)) return null;

  const label = normalisedHost.slice(0, -suffix.length);
  return label.length > 0 ? label : null;
}

/** True when the host is the platform's own root, where no tenant is implied. */
export function isRootHost(normalisedHost: string, rootDomain: string): boolean {
  const root = normaliseHost(rootDomain);
  if (!root) return false;

  return normalisedHost === root || normalisedHost === `www.${root}`;
}
