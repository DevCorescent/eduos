// ============================================================================
// MODULE : Utils — User Display
// PURPOSE: Derives the name and role label the top bar shows from the session
//          payload alone.
//
//          The JWT carries only { sub, tenantId, email, roles } — no name and
//          no avatar. Rendering the chrome from those claims keeps a portal
//          layout free of any data fetch, so the shell paints immediately and
//          a slow or failing profile request can never block navigation.
//
//          GET /api/auth/me returns the real firstName/lastName/avatarUrl. A
//          later phase can layer that in progressively, replacing the derived
//          name once it arrives; nothing here needs to change for that.
// ============================================================================

import type { TopbarUser } from "@/components/layout/Topbar";
import { roleLabel } from "@/constants/roles";

/**
 * Best-effort display name from an email address.
 *
 * "priya.sharma@uni.edu" -> "Priya Sharma". Dots, underscores and hyphens are
 * the conventional word separators in an institutional address, so splitting on
 * them recovers the name in the common case.
 *
 * Trailing digits are stripped: "rahul.verma2021@uni.edu" is an enrolment-year
 * suffix, not part of anyone's name. A local part that is *entirely* digits or
 * an opaque id is left alone rather than mangled — better to show it verbatim
 * than to invent a name from it.
 */
export function displayNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? email;

  const words = localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.replace(/\d+$/, ""))
    .filter(Boolean);

  if (words.length === 0) return localPart;

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Build the top bar's user object from JWT claims.
 *
 * The first role is used for the label. Precedence is the caller's business —
 * each portal layout has already established which role got the user in, so
 * ordering here would only second-guess it.
 */
export function topbarUserFromSession(session: {
  email: string;
  roles: string[];
}): TopbarUser {
  return {
    name: displayNameFromEmail(session.email),
    email: session.email,
    roleLabel: session.roles[0] ? roleLabel(session.roles[0]) : undefined,
  };
}
