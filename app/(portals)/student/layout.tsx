import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/services/session";
import { PortalShell } from "@/components/layout/PortalShell";
import { UniversityTheme } from "@/components/layout/UniversityTheme";
import { themeForTenant } from "@/lib/services/tenantTheme";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { STUDENT_NAV, filterNav } from "@/constants/navigation";
import { ROLES, homeRouteForRoles } from "@/constants/roles";
import { topbarUserFromSession } from "@/utils/user";

/**
 * Student portal — the learner's own attendance, assignments, results and fees.
 *
 * Gated to STUDENT alone, unlike the other portals. Everything here is scoped
 * to one person's own record, so admitting an administrator would put them on a
 * screen with no student to be. Staff view a student through the admin portal's
 * /students/[id] profile instead.
 */
export default async function StudentPortalLayout({ children }: { children: ReactNode }) {
  const session = await getPortalSession();

  if (!session) redirect("/login");

  if (!session.roles.includes(ROLES.STUDENT)) {
    redirect(homeRouteForRoles(session.roles));
  }


  // This university's own colours, from its own row. session.tenantId is
  // fixed at login and not client-controlled, so a portal can only ever be
  // painted with the theme of the tenant the caller belongs to.
  const universityTheme = await themeForTenant(session.tenantId);

  return (
    <UniversityTheme theme={universityTheme}>
      <PortalShell
        topbarActions={<NotificationBell />}
        sections={filterNav(STUDENT_NAV, session.roles)}
        user={topbarUserFromSession(session)}
        portalName="Student"
        homeHref="/student/dashboard"
      >
        {children}
      </PortalShell>
    </UniversityTheme>
  );
}
