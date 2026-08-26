import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/services/session";
import { PortalShell } from "@/components/layout/PortalShell";
import { UniversityTheme } from "@/components/layout/UniversityTheme";
import { themeForTenant } from "@/lib/services/tenantTheme";
import { PARENT_NAV, filterNav } from "@/constants/navigation";
import { ROLES, homeRouteForRoles } from "@/constants/roles";
import { mustChangePassword } from "@/lib/auth/mustChangePassword";
import { topbarUserFromSession } from "@/utils/user";

/**
 * Parent portal — PRD §32.
 *
 * Gated to PARENT alone, matching how the student portal is gated to STUDENT:
 * everything here is scoped to one family's children, so admitting an
 * administrator would put them on a screen with no children to be. Staff view a
 * student through the admin portal's /students/[id] profile instead.
 *
 * NO NOTIFICATION BELL
 *   The bell calls the tenant Notification Centre, whose API is not scoped to a
 *   parent's children. Rendering it would issue a request this role cannot
 *   satisfy, and §32's "Notices" is served by the parent-safe announcements
 *   route instead.
 *
 * THE FORCED PASSWORD CHANGE IS HONOURED HERE
 *   A parent account is created by an administrator who has seen the generated
 *   password (W1.6's policy, reused). requireAuth already refuses every tenant
 *   API until it is replaced; this redirect means the parent reaches the form
 *   rather than a portal in which every panel errors.
 */
export default async function ParentPortalLayout({ children }: { children: ReactNode }) {
  const session = await getPortalSession();

  if (!session) redirect("/login");

  if (!session.roles.includes(ROLES.PARENT)) {
    redirect(homeRouteForRoles(session.roles));
  }

  if (await mustChangePassword(session.sub)) redirect("/change-password");


  // This university's own colours, from its own row. session.tenantId is
  // fixed at login and not client-controlled, so a portal can only ever be
  // painted with the theme of the tenant the caller belongs to.
  const universityTheme = await themeForTenant(session.tenantId);

  return (
    <UniversityTheme theme={universityTheme}>
      <PortalShell
        sections={filterNav(PARENT_NAV, session.roles)}
        user={topbarUserFromSession(session)}
        portalName="Parent"
        homeHref="/parent/dashboard"
      >
        {children}
      </PortalShell>
    </UniversityTheme>
  );
}
