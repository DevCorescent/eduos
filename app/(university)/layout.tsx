import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/services/session";
import { PortalShell } from "@/components/layout/PortalShell";
import { UNIVERSITY_NAV, filterNav } from "@/constants/navigation";
import { ROLES, UNIVERSITY_ROLES, hasAnyRole, homeRouteForRoles } from "@/constants/roles";
import { topbarUserFromSession } from "@/utils/user";

/**
 * University Admin portal — the tenant's own operations console.
 *
 * Open to UNIVERSITY_ADMIN, CAMPUS_ADMIN and HOD, who see progressively less of
 * the same portal rather than being routed to different ones: filterNav drops
 * the links their roles do not cover (a head of department gets no Users &
 * Roles or Finance entry). One portal with a role-shaped nav beats three
 * near-identical portals to keep in step.
 *
 * SUPER_ADMIN is admitted too. The platform owner needs to be able to open a
 * tenant's console to reproduce a support issue, and every API call they make
 * is still tenant-scoped by requireTenant against their own JWT.
 */
export default async function UniversityLayout({ children }: { children: ReactNode }) {
  const session = await getPortalSession();
  if (!session) redirect("/login");

  const isPermitted =
    hasAnyRole(session.roles, UNIVERSITY_ROLES) || session.roles.includes(ROLES.SUPER_ADMIN);

  if (!isPermitted) {
    redirect(homeRouteForRoles(session.roles));
  }

  return (
    <PortalShell
      sections={filterNav(UNIVERSITY_NAV, session.roles)}
      user={topbarUserFromSession(session)}
      portalName="University"
      homeHref="/dashboard"
    >
      {children}
    </PortalShell>
  );
}
