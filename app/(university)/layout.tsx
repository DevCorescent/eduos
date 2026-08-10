import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/services/session";
import { mustChangePassword } from "@/lib/auth/mustChangePassword";
import { PortalShell } from "@/components/layout/PortalShell";
import { NotificationBell } from "@/components/shared/NotificationBell";
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

  // W1.4 — a University Admin provisioned by the platform holds a password
  // somebody else generated, and requireAuth refuses every tenant API until it
  // is replaced. Without this redirect they would reach a fully rendered
  // console in which every panel shows an error, which reads as a broken
  // product rather than as one required action.
  //
  // Read from the database rather than from the token: the flag is cleared
  // after the token was minted, so a JWT claim would be stale for the whole of
  // its lifetime. The cost is one indexed primary-key lookup per navigation in
  // this portal — the same shape of read the layout's own guard already makes.
  //
  // This is the portal a provisioned administrator lands in, which is why the
  // redirect lives here. The enforcement that matters is not location-dependent:
  // requireAuth refuses the APIs whichever screen is open.
  if (await mustChangePassword(session.sub)) redirect("/change-password");

  const isPermitted =
    hasAnyRole(session.roles, UNIVERSITY_ROLES) || session.roles.includes(ROLES.SUPER_ADMIN);

  if (!isPermitted) {
    redirect(homeRouteForRoles(session.roles));
  }

  return (
    <PortalShell
      topbarActions={<NotificationBell />}
      sections={filterNav(UNIVERSITY_NAV, session.roles)}
      user={topbarUserFromSession(session)}
      portalName="University"
      homeHref="/dashboard"
    >
      {children}
    </PortalShell>
  );
}
