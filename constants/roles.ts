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
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/** Roles permitted into the university admin portal. */
export const UNIVERSITY_ROLES: readonly string[] = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.CAMPUS_ADMIN,
  ROLES.HOD,
];

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
  return "/dashboard";
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
