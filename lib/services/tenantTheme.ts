// ============================================================================
// OWNER  : Gauransh
// MODULE : Tenant — University theme
// LAYER  : Service (data access)
// PURPOSE: Resolve one tenant's theme for the layout that is about to render it.
//
// THE TENANT IS NEVER TAKEN FROM A REQUEST
//   Every caller passes session.tenantId — fixed at login, carried in the signed
//   JWT and not client-controlled. There is no code path here that accepts a
//   tenant id from a body, a query or a header, so one university's portal can
//   never be painted with another's colours.
//
// FAILURE IS THE DEFAULT THEME, NOT A BROKEN PORTAL
//   A read that throws, or a tenant row that has gone, yields exactly what an
//   unconfigured university yields: the product's own colours. A portal must
//   not fail to render because a colour could not be looked up.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { resolveUniversityTheme, type UniversityTheme } from "@/lib/domain/tenant/theme";

/**
 * The theme to paint this tenant's portal with.
 *
 * INPUT   : a tenant id already resolved from the authenticated session.
 * RETURNS : a complete theme — every token present. Never throws.
 *
 * COMPLEXITY : one indexed primary-key read per portal navigation, the same
 *              shape of read the portal layouts already make for the session.
 */
export async function themeForTenant(tenantId: string): Promise<UniversityTheme> {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      // The two branding columns plus the settings bag that holds the other
      // four tokens. Nothing else — this read exists only to paint a portal.
      select: { primaryColor: true, accentColor: true, settings: true },
    });

    return resolveUniversityTheme(tenant ?? {});
  } catch (err) {
    console.error("[tenantTheme] themeForTenant failed", err);
    return resolveUniversityTheme({});
  }
}
