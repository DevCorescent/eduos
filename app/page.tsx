import { redirect } from "next/navigation";
import { getPortalSession } from "@/services/session";
import { homeRouteForRoles } from "@/constants/roles";

/**
 * Root route — a router, not a page.
 *
 * There is no single "home" in a multi-portal product: the same URL has to mean
 * the platform console, a university dashboard, a teaching schedule or a
 * student's own record depending on who is asking. Resolving that here lets
 * every other entry point — a bookmark, an emailed link, the auth layout's
 * logo — point at "/" without knowing the answer.
 *
 * getPortalSession() returns null for a signed-out visitor rather than
 * throwing — at the root that is the expected case, not an error — and applies
 * the same development fallback the portal layouts use, so "/" lands somewhere
 * useful while screens are served from fixtures.
 */
export default async function RootPage() {
  const session = await getPortalSession();

  if (!session) redirect("/login");

  redirect(homeRouteForRoles(session.roles));
}
