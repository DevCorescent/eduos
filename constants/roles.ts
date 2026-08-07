// ============================================================================
// MODULE : Constants — Roles & Portal Routing
// PURPOSE: The role vocabulary the frontend reasons about, and the rule that
//          decides which portal a signed-in user belongs in.
//
//          Role names are matched as strings because that is what the backend
//          stores and compares: Role.name is the stable identifier across
//          tenants (lib/middleware/requireRole.ts compares by name, never by
//          id), and it is Role.name that the JWT carries in its `roles` claim.
//          Roles are per-tenant rows, so a tenant may define custom roles
//          beyond the ones named here — which is why nothing in this file
//          assumes the list is exhaustive.
// ============================================================================

/**
 * The roles the frontend routes and gates on.
 *
 * SUPER_ADMIN and UNIVERSITY_ADMIN are seeded by prisma/seed.ts and enforced by
 * the API today. The remainder are named by the frontend plan and will exist as
 * tenant-defined rows; treating them as strings means no migration is needed
 * for the UI to recognise them.
 */
export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  UNIVERSITY_ADMIN: "UNIVERSITY_ADMIN",
  CAMPUS_ADMIN: "CAMPUS_ADMIN",
  HOD: "HOD",
  FACULTY: "FACULTY",
  STUDENT: "STUDENT",
  PARENT: "PARENT",

  // Phase 16 — the two roles the Advanced Result Management phase names but
  // that existed nowhere in the project: not in prisma/seed.ts ALL_ROLES, not
  // here, and not in any route guard.
  //
  // CONTROLLER_OF_EXAMINATION owns the examination lifecycle: it is the role
  // that authorises an evaluation regulation and, later, publishes results.
  //
  // DEPARTMENT_HOD is spelled as the Phase 16 specification names it. The
  // pre-existing HOD above is retained untouched because UNIVERSITY_ROLES and
  // homeRouteForRoles already branch on it and renaming it would change
  // frontend portal routing. The duplicate vocabulary is recorded as debt to
  // be converged in a dedicated pass, not silently resolved here.
  CONTROLLER_OF_EXAMINATION: "CONTROLLER_OF_EXAMINATION",
  DEPARTMENT_HOD: "DEPARTMENT_HOD",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/**
 * Roles permitted into the university admin portal.
 *
 * Matches the backend's own vocabulary, which is the only definition that
 * matters: lib/constants/evaluationScheme.ts, assessmentEvent.ts and result.ts
 * all grant CONTROLLER_OF_EXAMINATION and DEPARTMENT_HOD against the routes
 * this portal calls, and FRONTEND.md names the same four.
 *
 * Both were previously absent. The effect was not merely a hidden portal: a
 * user holding only DEPARTMENT_HOD was refused by the university layout, sent
 * to homeRouteForRoles, which matched nothing and returned /dashboard — the
 * route that had just refused them. That is an infinite redirect, and it is the
 * reason such an account appeared to "load forever" with no error.
 *
 * HOD is retained alongside DEPARTMENT_HOD. The two are the same office spelled
 * two ways, a duplication this file already records as debt; dropping either
 * would lock out whichever spelling a tenant happens to have seeded.
 */
export const UNIVERSITY_ROLES: readonly string[] = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CAMPUS_ADMIN,
  ROLES.HOD,
  ROLES.DEPARTMENT_HOD,
  ROLES.CONTROLLER_OF_EXAMINATION,
];

/**
 * Where a signed-in user goes when no portal accepts their roles.
 *
 * Deliberately NOT a portal route. Every portal layout redirects a caller it
 * refuses to homeRouteForRoles(), so if that function can return a portal the
 * caller cannot enter, the two bounce off each other forever. Returning a route
 * that is outside every portal layout — and therefore refuses nobody —
 * terminates the exchange no matter which roles are involved.
 */
export const NO_PORTAL_ROUTE = "/no-access";

/** True when `roles` contains at least one of `allowed`. */
export function hasAnyRole(roles: readonly string[], allowed: readonly string[]): boolean {
  return roles.some((role) => allowed.includes(role));
}

/**
 * The landing route for a signed-in user.
 *
 * Order is precedence, not preference: a user holding several roles lands in
 * the most privileged portal they can reach. Checking SUPER_ADMIN first matters
 * because the platform owner's account is also a User row inside a tenant, so
 * it can legitimately carry a university role too.
 *
 * Falls back to the university dashboard. A user with only unrecognised custom
 * roles is still a tenant user, and the layout guard there will decide
 * concretely — better than routing them nowhere.
 */
export function homeRouteForRoles(roles: readonly string[]): string {
  if (roles.includes(ROLES.SUPER_ADMIN)) return "/platform/dashboard";
  if (hasAnyRole(roles, UNIVERSITY_ROLES)) return "/dashboard";
  if (roles.includes(ROLES.FACULTY)) return "/faculty/dashboard";
  if (roles.includes(ROLES.STUDENT)) return "/student/dashboard";

  // Terminal, not /dashboard. See NO_PORTAL_ROUTE: returning a portal route
  // here is what created the redirect loop, because the portal that rejected
  // the user is the portal this function used to send them back to.
  return NO_PORTAL_ROUTE;
}

/** Human-readable role name for badges and profile cards. */
export function roleLabel(role: string): string {
  const known: Record<string, string> = {
    SUPER_ADMIN: "Super Admin",
    UNIVERSITY_ADMIN: "University Admin",
    CAMPUS_ADMIN: "Campus Admin",
    HOD: "Head of Department",
    FACULTY: "Faculty",
    STUDENT: "Student",
    PARENT: "Parent",
    CONTROLLER_OF_EXAMINATION: "Controller of Examination",
    DEPARTMENT_HOD: "Head of Department",
  };
  // A tenant's custom role is title-cased rather than shown as raw SNAKE_CASE.
  return (
    known[role] ??
    role
      .toLowerCase()
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}
