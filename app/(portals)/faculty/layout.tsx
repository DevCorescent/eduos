import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/services/session";
import { PortalShell } from "@/components/layout/PortalShell";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { FACULTY_NAV, filterNav } from "@/constants/navigation";
import { ROLES, homeRouteForRoles } from "@/constants/roles";
import { topbarUserFromSession } from "@/utils/user";

/**
 * Faculty portal — a teacher's own classes, schedule and grading.
 *
 * Distinct from the university portal's /faculty screens, which are the admin's
 * *directory* of faculty members. Same word, opposite direction: this portal is
 * "my teaching", that one is "our staff". The two coexist as sibling routes
 * (/faculty/dashboard here, /faculty there) because route groups contribute no
 * URL segment of their own.
 *
 * Admin roles are admitted alongside FACULTY so a head of department who also
 * teaches is not locked out of their own schedule.
 */
export default async function FacultyPortalLayout({ children }: { children: ReactNode }) {
  const session = await getPortalSession();

  if (!session) redirect("/login");

  const isPermitted =
    session.roles.includes(ROLES.FACULTY) ||
    session.roles.includes(ROLES.HOD) ||
    session.roles.includes(ROLES.UNIVERSITY_ADMIN);

  if (!isPermitted) {
    redirect(homeRouteForRoles(session.roles));
  }

  return (
    <PortalShell
      topbarActions={<NotificationBell />}
      sections={filterNav(FACULTY_NAV, session.roles)}
      user={topbarUserFromSession(session)}
      portalName="Faculty"
      homeHref="/faculty/dashboard"
    >
      {children}
    </PortalShell>
  );
}
