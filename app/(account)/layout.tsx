import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/services/session";
import { PortalShell } from "@/components/layout/PortalShell";
import { NotificationBell } from "@/components/shared/NotificationBell";
import {
  FACULTY_NAV,
  PLATFORM_NAV,
  STUDENT_NAV,
  UNIVERSITY_NAV,
  filterNav,
  type NavGroup,
} from "@/constants/navigation";
import { ROLES, UNIVERSITY_ROLES, hasAnyRole } from "@/constants/roles";
import { topbarUserFromSession } from "@/utils/user";

/**
 * Which portal's chrome a person should see around their own account screens.
 *
 * Settings belongs to whoever is signed in, not to one portal — a lecturer and
 * a registrar both change their own password. But dropping them into a bare
 * page with no sidebar would strand them: there would be no way back to the
 * portal they came from. So the shell is chosen from their roles instead, using
 * the same trees and the same precedence as homeRouteForRoles, and Settings
 * appears as a page *inside* their own portal rather than a place apart.
 */
function shellFor(roles: readonly string[]): {
  nav: NavGroup[];
  portalName: string;
  homeHref: string;
} {
  if (roles.includes(ROLES.SUPER_ADMIN)) {
    return { nav: PLATFORM_NAV, portalName: "Platform", homeHref: "/platform/dashboard" };
  }
  if (hasAnyRole(roles, UNIVERSITY_ROLES)) {
    return { nav: UNIVERSITY_NAV, portalName: "University", homeHref: "/dashboard" };
  }
  if (roles.includes(ROLES.FACULTY)) {
    return { nav: FACULTY_NAV, portalName: "Faculty", homeHref: "/faculty/dashboard" };
  }
  if (roles.includes(ROLES.STUDENT)) {
    return { nav: STUDENT_NAV, portalName: "Student", homeHref: "/student/dashboard" };
  }
  return { nav: UNIVERSITY_NAV, portalName: "University", homeHref: "/dashboard" };
}

/**
 * Account portal — every signed-in person's own settings.
 *
 * The only layout in the app with no role gate beyond "is signed in". That is
 * deliberate: there is no role for which "change my own password" is the wrong
 * screen, so gating it could only ever lock somebody out of their own account.
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const session = await getPortalSession();
  if (!session) redirect("/login");

  const { nav, portalName, homeHref } = shellFor(session.roles);

  return (
    <PortalShell
      topbarActions={<NotificationBell />}
      sections={filterNav(nav, session.roles)}
      user={topbarUserFromSession(session)}
      portalName={portalName}
      homeHref={homeHref}
    >
      {children}
    </PortalShell>
  );
}
