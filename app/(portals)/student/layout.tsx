/* eslint-disable react-hooks/purity, react-hooks/refs -- TEMPORARY DIAGNOSTIC
   INSTRUMENTATION. console.log and Date.now() are impure, and the React
   Compiler is right to refuse them during render. They are here to trace a
   reported "dashboard never loads" and are meant to be removed with the rest of
   the tracing once the cause is settled. Nothing below changes behaviour. */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/services/session";
import { PortalShell } from "@/components/layout/PortalShell";
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
  // [GUARD] These layouts ARE this project's route guards — there is no
  // middleware.ts. A redirect logged here without a matching RENDER line
  // from the destination is a redirect that bounced straight back.
  const __t0 = Date.now();
  console.log("[GUARD:STUDENT] ENTER  expects=STUDENT");
  const session = await getPortalSession();
  console.log(
    "[GUARD:STUDENT] session=" + (session ? `sub=${session.sub} roles=[${session.roles.join(",")}] tenantId=${session.tenantId}` : "NONE")
  );

  if (!session) {
    console.log("[GUARD:STUDENT] REDIRECT -> /login  (no session)  in", Date.now() - __t0, "ms");
    redirect("/login");
  }

  if (!session.roles.includes(ROLES.STUDENT)) {
    console.log("[GUARD:STUDENT] DENIED roles=[" + session.roles.join(",") + "] REDIRECT ->", homeRouteForRoles(session.roles), "in", Date.now() - __t0, "ms");
    redirect(homeRouteForRoles(session.roles));
  }

  console.log("[GUARD:STUDENT] ALLOWED in", Date.now() - __t0, "ms");

  return (
    <PortalShell
      sections={filterNav(STUDENT_NAV, session.roles)}
      user={topbarUserFromSession(session)}
      portalName="Student"
      homeHref="/student/dashboard"
    >
      {children}
    </PortalShell>
  );
}
