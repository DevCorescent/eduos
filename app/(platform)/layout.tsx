/* eslint-disable react-hooks/purity, react-hooks/refs -- TEMPORARY DIAGNOSTIC
   INSTRUMENTATION. console.log and Date.now() are impure, and the React
   Compiler is right to refuse them during render. They are here to trace a
   reported "dashboard never loads" and are meant to be removed with the rest of
   the tracing once the cause is settled. Nothing below changes behaviour. */
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
  // [GUARD] These layouts ARE this project's route guards — there is no
  // middleware.ts. A redirect logged here without a matching RENDER line
  // from the destination is a redirect that bounced straight back.
  const __t0 = Date.now();
  console.log("[GUARD:PLATFORM] ENTER  expects=SUPER_ADMIN");
  const session = await getPortalSession();
  console.log(
    "[GUARD:PLATFORM] session=" + (session ? `sub=${session.sub} roles=[${session.roles.join(",")}] tenantId=${session.tenantId}` : "NONE")
  );

  if (!session) {
    console.log("[GUARD:PLATFORM] REDIRECT -> /login  (no session)  in", Date.now() - __t0, "ms");
    redirect("/login");
  }

  // Sent to their own portal rather than to /login: they are signed in
  // correctly, just not entitled to this one.
  if (!session.roles.includes(ROLES.SUPER_ADMIN)) {
    console.log("[GUARD:PLATFORM] DENIED roles=[" + session.roles.join(",") + "] REDIRECT ->", homeRouteForRoles(session.roles), "in", Date.now() - __t0, "ms");
    redirect(homeRouteForRoles(session.roles));
  }

  console.log("[GUARD:PLATFORM] ALLOWED in", Date.now() - __t0, "ms");

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
