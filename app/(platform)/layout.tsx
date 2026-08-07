import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/services/session";
import { PortalShell } from "@/components/layout/PortalShell";
import { PLATFORM_NAV, filterNav } from "@/constants/navigation";
import { ROLES, homeRouteForRoles } from "@/constants/roles";
import { topbarUserFromSession } from "@/utils/user";

/**
 * Platform Admin portal — the tenant onboarding and billing console.
 *
 * A Server Component, which is what makes the guard below meaningful: the
 * session is read from the httpOnly cookie on the server, so a caller without
 * SUPER_ADMIN never receives the page's markup at all. A client-side check
 * would ship the page and then hide it.
 *
 * The API enforces the same rule independently — every route under
 * /api/platform calls requireRole("SUPER_ADMIN"). This guard decides who
 * reaches a screen; it is not what protects the data.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const session = await getPortalSession();

  if (!session) redirect("/login");

  // Sent to their own portal rather than to /login: they are signed in
  // correctly, just not entitled to this one.
  if (!session.roles.includes(ROLES.SUPER_ADMIN)) {
    redirect(homeRouteForRoles(session.roles));
  }

  return (
    <PortalShell
      sections={filterNav(PLATFORM_NAV, session.roles)}
      user={topbarUserFromSession(session)}
      portalName="Platform"
      homeHref="/platform/dashboard"
    >
      {children}
    </PortalShell>
  );
}
