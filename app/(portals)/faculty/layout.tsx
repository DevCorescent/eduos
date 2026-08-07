/* eslint-disable react-hooks/purity, react-hooks/refs -- TEMPORARY DIAGNOSTIC
   INSTRUMENTATION. console.log and Date.now() are impure, and the React
   Compiler is right to refuse them during render. They are here to trace a
   reported "dashboard never loads" and are meant to be removed with the rest of
   the tracing once the cause is settled. Nothing below changes behaviour. */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/services/session";
import { PortalShell } from "@/components/layout/PortalShell";
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
  // [GUARD] These layouts ARE this project's route guards — there is no
  // middleware.ts. A redirect logged here without a matching RENDER line
  // from the destination is a redirect that bounced straight back.
  const __t0 = Date.now();
  console.log("[GUARD:FACULTY] ENTER  expects=FACULTY/HOD/UNIVERSITY_ADMIN");
  const session = await getPortalSession();
  console.log(
    "[GUARD:FACULTY] session=" + (session ? `sub=${session.sub} roles=[${session.roles.join(",")}] tenantId=${session.tenantId}` : "NONE")
  );

  if (!session) {
    console.log("[GUARD:FACULTY] REDIRECT -> /login  (no session)  in", Date.now() - __t0, "ms");
    redirect("/login");
  }

  const isPermitted =
    session.roles.includes(ROLES.FACULTY) ||
    session.roles.includes(ROLES.HOD) ||
    session.roles.includes(ROLES.UNIVERSITY_ADMIN);

  if (!isPermitted) {
    console.log("[GUARD:FACULTY] DENIED roles=[" + session.roles.join(",") + "] REDIRECT ->", homeRouteForRoles(session.roles), "in", Date.now() - __t0, "ms");
    redirect(homeRouteForRoles(session.roles));
  }

  console.log("[GUARD:FACULTY] ALLOWED in", Date.now() - __t0, "ms");

  return (
    <PortalShell
      sections={filterNav(FACULTY_NAV, session.roles)}
      user={topbarUserFromSession(session)}
      portalName="Faculty"
      homeHref="/faculty/dashboard"
    >
      {children}
    </PortalShell>
  );
}
