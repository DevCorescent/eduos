import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/services/session";
import { homeRouteForRoles } from "@/constants/roles";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

/**
 * Replace a provisioned password (W1.4).
 *
 * WHY THIS LIVES IN (auth) AND NOT IN A PORTAL
 *   Every portal layout renders a shell whose components call tenant APIs, and
 *   requireAuth refuses all of them while mustChangePassword is set — so a
 *   portal-hosted version of this page would render a console full of 403s
 *   around the one form that fixes them. (auth) has no guard and no data
 *   fetching, which is exactly what this screen needs.
 *
 *   It is not unguarded: the check below requires a session, and the route it
 *   posts to requires the CURRENT password on top of that.
 *
 * REACHED BY REDIRECT, NOT BY A LINK
 *   The login form sends a user here when the login response reports the flag,
 *   and the university layout sends them here if they arrive by any other
 *   route. Nothing in a sidebar points at it.
 *
 * The same page serves a voluntary change, which is why it does not assert that
 * the flag is set: a user who navigates here having chosen their own password
 * gets a working form rather than a redirect loop.
 */
export default async function ChangePasswordPage() {
  const session = await getPortalSession();

  // No session at all: this page can do nothing for an anonymous visitor, and
  // signing in is the step that precedes it.
  if (!session) redirect("/login");

  return (
    <div className="glass rounded-xl p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-heading">Choose a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          If your password was issued to you by somebody else, replace it here before using the
          system. Signed in as {session.email}.
        </p>
      </div>

      {/* Sent back to their own portal, resolved from the roles in their token
          rather than hard-coded to /dashboard — a faculty member or student
          changing a password should not land on the admin console. */}
      <ChangePasswordForm destination={homeRouteForRoles(session.roles)} />
    </div>
  );
}
