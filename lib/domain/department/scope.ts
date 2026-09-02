// ============================================================================
// OWNER  : Gauransh
// MODULE : Domain — department scope decision
// LAYER  : Domain. PURE — no database, no headers, no environment.
// PURPOSE: Decide, from a caller's roles and the department they head, whether
//          their queries must be narrowed and to what.
//
// WHY THIS IS ITS OWN PURE FUNCTION
//   This is the security-relevant branch of department authorization, and it is
//   three rules that are easy to state and easy to get wrong: who is narrowed,
//   who is not, and what happens to a head with no department. Separated from
//   the database read, it can be exercised directly — the same reason
//   lib/domain/tenant/servable.ts exists apart from tenant resolution.
//
// THE THIRD RULE IS THE ONE THAT MATTERS
//   A head with no department is REFUSED, not left unrestricted. The moment
//   "no department" is read as "every department", the whole mechanism becomes
//   decoration and a nullable column becomes an escalation.
// ============================================================================

import { ROLES } from "@/constants/roles";

/**
 * Every spelling of "head of department" this project recognises.
 *
 * HOD and DEPARTMENT_HOD are THE SAME OFFICE spelled two ways — constants/roles
 * says so outright and records the duplication as debt, UNIVERSITY_ROLES admits
 * both into the university portal, and INTERNAL_ASSESSMENT_ROLES and the
 * EXAM_RESOURCE arrays both list both.
 *
 * Recognising only DEPARTMENT_HOD here would FAIL OPEN, which is worse than
 * failing to recognise the role at all: a user holding HOD passes those role
 * guards, reaches this function, matches no head role, and is handed
 * `restricted: false` — the entire university. The narrowing would look
 * present in review and be absent in fact for that spelling.
 *
 * Roles are resolved live from tenant-defined Role rows by name, so this is not
 * hypothetical: any tenant that seeds the older spelling gets the unrestricted
 * behaviour. The lookup itself is unaffected — Department.hodUserId keys on the
 * user, not on how their role is spelled.
 */
export const HEAD_OF_DEPARTMENT_ROLES: readonly string[] = [
  ROLES.DEPARTMENT_HOD,
  ROLES.HOD,
];

/**
 * The narrowing to apply to a caller's queries.
 *
 * `restricted: false` means no DEPARTMENT narrowing. It does not mean
 * unrestricted access: a role check admitted the caller and requireTenant still
 * bounds them to their own institution.
 */
export type DepartmentScope =
  | { restricted: false }
  | { restricted: true; departmentId: string };

/** `denied` is a head who heads nothing — see the module header. */
export type DepartmentScopeDecision =
  | { allowed: true; scope: DepartmentScope }
  | { allowed: false; reason: "NO_DEPARTMENT_ASSIGNED" };

/**
 * Decide the narrowing.
 *
 * INPUT   : the caller's role names, and the id of the department they head
 *           (null when they head none). The department id must come from the
 *           authoritative relation, never from the request.
 *
 * PRECEDENCE : holding UNIVERSITY_ADMIN wins. A user who is both an
 *           administrator and a head is NOT narrowed — the admin role is the
 *           wider grant, and narrowing it would silently withdraw access the
 *           university deliberately gave.
 *
 * @example
 * decideDepartmentScope(["DEPARTMENT_HOD"], "dept_cse")
 * // { allowed: true, scope: { restricted: true, departmentId: "dept_cse" } }
 */
export function decideDepartmentScope(
  roles: readonly string[],
  headedDepartmentId: string | null
): DepartmentScopeDecision {
  if (roles.includes(ROLES.UNIVERSITY_ADMIN)) {
    return { allowed: true, scope: { restricted: false } };
  }

  if (!roles.some((role) => HEAD_OF_DEPARTMENT_ROLES.includes(role))) {
    return { allowed: true, scope: { restricted: false } };
  }

  if (!headedDepartmentId) {
    return { allowed: false, reason: "NO_DEPARTMENT_ASSIGNED" };
  }

  return { allowed: true, scope: { restricted: true, departmentId: headedDepartmentId } };
}
