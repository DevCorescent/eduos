import { headers } from "next/headers";
import { prisma } from "../db/prisma";
import { getSession } from "@/lib/auth/session";
import { requestScoped } from "@/lib/middleware/requestCache";
import {
  isRootHost,
  normaliseHost,
  platformSubdomain,
} from "@/lib/domain/tenant/host";
import type { TenantBranding } from "@/lib/domain/tenant/branding";
import { isServableStatus } from "@/lib/domain/tenant/servable";

// ============================================================================
// OWNER  : Gauransh
// MODULE : Tenant resolution (WP-3, PRD §5.2)
// PURPOSE: Answer "which institution is this request for", from the hostname.
//
// WHAT CHANGED IN WP-3, AND WHY
//   Resolution used to be host → slug → Tenant, and never read the Domain
//   table. That worked for platform subdomains and made custom domains
//   impossible: portal.university.edu does not end in ".eduos.com", so it
//   resolved to nothing. PRD §5.2 makes custom domains a headline capability
//   and §56 lists them as differentiator #2.
//
//   Domain lookup is now tried FIRST and the slug path is kept as a fallback,
//   so every subdomain that worked before still works with no Domain row —
//   which matters because there are five tenants and zero Domain rows today.
//
// THE ORDER IS DELIBERATE
//   1. Exact Domain match — the configured, verified, active hostname.
//   2. Platform subdomain → slug — the built-in address every tenant has.
//   3. Root host + session — localhost and the platform root, where the
//      hostname carries no tenant and the JWT is the only signal.
//
//   A Domain row therefore OVERRIDES the slug convention, which is what lets an
//   institution move to its own hostname without renaming its slug.
//
// THIS FUNCTION ANSWERS "WHICH TENANT DOES THE HOST NAME", NOT "MAY THIS USER
// SEE IT". requireTenant compares this against the session's own tenantId and
// refuses a mismatch. Both halves are needed: this one alone would let an IPU
// user read AKTU data by visiting AKTU's hostname.
// ============================================================================

/** The tenant a request resolves to, with the branding needed to render it. */
export interface ResolvedTenant {
  readonly id: string;
  readonly slug: string;
  readonly branding: TenantBranding;
}

/** Columns every resolution path selects. One shape, one cache entry. */
const TENANT_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  logoUrl: true,
  faviconUrl: true,
  primaryColor: true,
  accentColor: true,
} as const;

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
};

/**
 * A tenant that cannot serve traffic resolves to nothing.
 *
 * SUSPENDED and CANCELLED are refused at the resolution boundary rather than
 * per-route, so a suspended institution's hostname stops working everywhere at
 * once instead of in whichever routes remembered to check.
 */
function servable(tenant: TenantRow | null): ResolvedTenant | null {
  if (!tenant) return null;
  // Allow-list, not deny-list. W1.5 added ARCHIVED and the old
  // `=== "CANCELLED" || === "SUSPENDED"` check let it through — an archived
  // university went on resolving. See lib/domain/tenant/servable.ts.
  if (!isServableStatus(tenant.status)) return null;

  return {
    id: tenant.id,
    slug: tenant.slug,
    branding: {
      name: tenant.name,
      logoUrl: tenant.logoUrl,
      faviconUrl: tenant.faviconUrl,
      primaryColor: tenant.primaryColor,
      accentColor: tenant.accentColor,
    },
  };
}

/**
 * Resolve the tenant for the current request, with its branding.
 *
 * ONE database read per request in the common case, memoised by requestScoped:
 * the layout, the metadata generator and every guard that asks during one
 * render share the same result. Without that a single page would resolve the
 * tenant four or five times against a database with ~250ms round trips.
 */
export async function resolveTenantForRequest(): Promise<ResolvedTenant | null> {
  const headerList = await headers();

  const host =
    normaliseHost(headerList.get("x-forwarded-host")) ??
    normaliseHost(headerList.get("host"));

  if (!host) return null;

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

  return requestScoped(`tenant:host:${host}`, async () => {
    // 1. A configured domain. Exact match on the normalised hostname; the row
    //    must be verified AND active, so an unproven or retired hostname
    //    resolves to nothing rather than to its tenant.
    const configured = await prisma.domain.findFirst({
      where: { domain: host, verified: true, isActive: true },
      select: { tenant: { select: TENANT_SELECT } },
    });

    if (configured) return servable(configured.tenant as TenantRow);

    // 2. The platform subdomain every tenant has by convention.
    const slug = platformSubdomain(host, rootDomain);
    if (slug) {
      const tenant = await prisma.tenant.findUnique({
        where: { slug },
        select: TENANT_SELECT,
      });
      return servable(tenant as TenantRow | null);
    }

    // 3. The platform root — localhost in development, eduos.com in production.
    //    The hostname names no tenant, so the only signal is the session, whose
    //    tenantId was fixed at login and is not client-controlled.
    //
    //    A public visitor gets null, which is correct: the root is the
    //    platform, not an institution.
    if (isRootHost(host, rootDomain)) {
      const session = await getSession();
      if (!session) return null;

      const tenant = await prisma.tenant.findUnique({
        where: { id: session.tenantId },
        select: TENANT_SELECT,
      });
      return servable(tenant as TenantRow | null);
    }

    // An unknown hostname. Null rather than an error, and identical to the
    // answer a suspended tenant gives, so probing hostnames reveals nothing
    // about which institutions exist.
    return null;
  });
}

/**
 * The tenant id for the current request, or null.
 *
 * The pre-WP-3 signature, preserved exactly. Every existing caller —
 * requireTenant and the guards built on it — keeps working unchanged, which is
 * what allowed domain resolution to be introduced without touching a single
 * authorization path.
 */
export async function getTenantFromRequest(): Promise<string | null> {
  const resolved = await resolveTenantForRequest();
  return resolved?.id ?? null;
}
