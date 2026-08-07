/* eslint-disable react-hooks/purity, react-hooks/refs -- TEMPORARY DIAGNOSTIC
   INSTRUMENTATION. console.log and Date.now() are impure, and the React
   Compiler is right to refuse them during render. They are here to trace a
   reported "dashboard never loads" and are meant to be removed with the rest of
   the tracing once the cause is settled. Nothing below changes behaviour. */
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
  // [GUARD] These layouts ARE this project's route guards — there is no
  // middleware.ts. A redirect logged here without a matching RENDER line
  // from the destination is a redirect that bounced straight back.
  const __t0 = Date.now();
  console.log("[GUARD:UNIVERSITY] ENTER  expects=UNIVERSITY_ROLES + SUPER_ADMIN");
  const session = await getPortalSession();
  console.log(
    "[GUARD:UNIVERSITY] session=" + (session ? `sub=${session.sub} roles=[${session.roles.join(",")}] tenantId=${session.tenantId}` : "NONE")
  );

  if (!session) {
    console.log("[GUARD:UNIVERSITY] REDIRECT -> /login  (no session)  in", Date.now() - __t0, "ms");
    redirect("/login");
  }

  const isPermitted =
    hasAnyRole(session.roles, UNIVERSITY_ROLES) || session.roles.includes(ROLES.SUPER_ADMIN);

  if (!isPermitted) {
    console.log("[GUARD:UNIVERSITY] DENIED roles=[" + session.roles.join(",") + "] REDIRECT ->", homeRouteForRoles(session.roles), "in", Date.now() - __t0, "ms");
    redirect(homeRouteForRoles(session.roles));
  }

  console.log("[GUARD:UNIVERSITY] ALLOWED in", Date.now() - __t0, "ms");

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
