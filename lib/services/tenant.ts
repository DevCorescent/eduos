import { headers } from "next/headers";
import { prisma } from "../db/prisma";
import { getSession } from "@/lib/auth/session";
import { requestScoped } from "@/lib/middleware/requestCache";

/**
 * Resolve the tenant for the current request.
 *
 * Resolution order:
 *
 * 1. Production subdomain
 *      akgec.eduos.com
 *
 * 2. Authenticated localhost/root domain
 *      use JWT tenantId
 *
 * 3. Public routes
 *      return null
 */
export async function getTenantFromRequest(): Promise<string | null> {
  const headerList = await headers();

  const host =
    headerList
      .get("x-forwarded-host")
      ?.split(",")[0]
      ?.trim()
      ?? headerList.get("host")
      ?? "";

  const rootDomain =
    process.env.NEXT_PUBLIC_ROOT_DOMAIN ??
    "localhost:3000";

  /**
   * ------------------------------------------------------------------
   * ROOT DOMAIN
   * ------------------------------------------------------------------
   *
   * Examples:
   *
   * localhost:3000
   * www.localhost:3000
   * eduos.com
   * www.eduos.com
   *
   * There is no tenant slug inside the hostname.
   *
   * If a user is authenticated,
   * their JWT already contains the tenantId issued during login.
   *
   * That tenantId is authoritative.
   *
   * Public routes still return null.
   */
  if (
    host === rootDomain ||
    host === `www.${rootDomain}`
  ) {
const session = await getSession();

if (!session) {
    return null;
}

const tenant = await requestScoped(`tenant:byId:${session.tenantId}`, () =>
    prisma.tenant.findUnique({
        where: {
            id: session.tenantId,
        },
        select: {
            id: true,
            status: true,
        },
    })
);

if (!tenant) {
    return null;
}

if (
    tenant.status === "CANCELLED" ||
    tenant.status === "SUSPENDED"
) {
    return null;
}

return tenant.id;
  }

  /**
   * ------------------------------------------------------------------
   * SUBDOMAIN
   * ------------------------------------------------------------------
   *
   * akgec.eduos.com
   * galgotias.eduos.com
   * lpu.eduos.com
   *
   * Production tenancy continues to rely on hostname.
   */
  if (!host.endsWith(`.${rootDomain}`)) {
    return null;
  }

  const slug = host.slice(
    0,
    host.length - (`.${rootDomain}`).length
  );

  if (!slug) {
    return null;
  }

  const tenant = await requestScoped(`tenant:bySlug:${slug}`, () =>
    prisma.tenant.findUnique({
      where: {
        slug,
      },
      select: {
        id: true,
        status: true,
      },
    })
  );

  if (!tenant) {
    return null;
  }

  if (
    tenant.status === "CANCELLED" ||
    tenant.status === "SUSPENDED"
  ) {
    return null;
  }

  return tenant.id;
}