// ============================================================================
// OWNER  : Gauransh
// MODULE : Tenant — Public website address
// LAYER  : Domain (pure)
// PURPOSE: Work out the address at which a university's public website is
//          actually served.
//
// WHY THIS IS NOT "the host the admin is on"
//   The Website editor used to point "View site" at the request's own hostname.
//   For an administrator working on a custom domain that happens to be right;
//   for everyone else it is wrong, and wrong in the way that is hardest to
//   notice — the button opens a real page, so it looks like it worked. On the
//   platform root host an anonymous visitor resolves to NO tenant, so the URL
//   the admin was handed to share with prospective students is a redirect to
//   the staff sign-in form.
//
//   The public address is a property of the INSTITUTION, not of the request:
//   its verified custom domain if it has one, otherwise its subdomain of the
//   platform root. That is exactly what resolveTenantForRequest matches on when
//   a visitor arrives, so building the URL from the same two rules is what
//   makes the link resolve back to this tenant.
//
// SCHEME
//   https everywhere except a local host, because a development root domain is
//   "localhost:3000" and there is no certificate for it. The check is on the
//   hostname rather than on NODE_ENV: what decides whether TLS is available is
//   the address, and a production build pointed at localhost is still http.
// ============================================================================

/** Hostnames that are served over plain http because no certificate exists. */
function isLocal(host: string): boolean {
  const name = host.split(":")[0]?.toLowerCase() ?? "";
  return name === "localhost" || name.endsWith(".localhost") || name === "127.0.0.1";
}

/**
 * Strip a scheme, path, credentials or whitespace from a configured value.
 *
 * The root domain arrives from an environment variable and a custom domain from
 * an operator-entered database row, so neither is guaranteed to be a bare host.
 * Everything after the authority is dropped: a stored "example.edu/admissions"
 * must not turn the site link into a link to one page of it.
 */
export function hostOnly(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const trimmed = raw.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const authority = trimmed.split("/")[0]?.split("@").pop() ?? "";
  const host = authority.trim().toLowerCase().replace(/\.$/, "");

  return host.length > 0 ? host : null;
}

/**
 * The origin of a university's public website — scheme and host, no trailing
 * slash.
 *
 * INPUT   : the tenant's slug, its verified custom domain if it has one, and
 *           the platform root domain.
 * RETURNS : an absolute origin, or null when neither a custom domain nor a
 *           usable root domain is configured. Null is a real answer and the
 *           caller must handle it: it means this institution has no public
 *           address yet, and inventing one would hand the admin a dead link.
 *
 * The custom domain wins. An institution that has gone to the trouble of
 * pointing its own domain at us expects that to be its address, and its
 * subdomain of the platform root is then an implementation detail.
 */
export function publicSiteOrigin(input: {
  slug: string;
  customDomain?: string | null;
  rootDomain?: string | null;
}): string | null {
  const custom = hostOnly(input.customDomain);
  if (custom) return `${isLocal(custom) ? "http" : "https"}://${custom}`;

  const root = hostOnly(input.rootDomain);
  const slug = input.slug.trim().toLowerCase();
  if (!root || slug.length === 0) return null;

  // The slug is a subdomain LABEL, so a slug that is not one would produce a
  // host that resolves to something else entirely. Slugs are constrained on
  // write; this refuses rather than trusts, because the result is a link the
  // institution publishes.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) return null;

  return `${isLocal(root) ? "http" : "https"}://${slug}.${root}`;
}
