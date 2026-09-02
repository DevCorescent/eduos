// ============================================================================
// MODULE : Authorization — Department scope (DEPARTMENT_HOD)
// LAYER  : Auth helper, called from route handlers AFTER requireRole and
//          requireTenant have run.
// PURPOSE: Answer, from the server alone, "which department may this caller
//          see?" — so a head of department reads their own department and
//          nobody else's.
//
// THE ONE RULE THIS MODULE EXISTS TO ENFORCE
//   The department is derived from the AUTHENTICATED IDENTITY, never from the
//   request. No query parameter, no route segment, no body field and no header
//   reaches this function. A HOD who edits ?departmentId= in the URL changes
//   nothing, because nothing here reads it.
//
// WHY THE LOOKUP IS A DATABASE READ AND NOT A TOKEN CLAIM
//   The JWT carries { sub, tenantId, email, roles } and is minted for seven
//   days. A department reassignment — or a head being removed — would sit
//   unenforced for the whole of that window if the department travelled in the
//   token. The same reasoning requireRole gives for resolving roles live.
//
// FAIL CLOSED, ALWAYS
//   A DEPARTMENT_HOD with no department assigned is REFUSED, not treated as
//   unrestricted. That is the difference between a nullable column being a
//   modelling convenience and being an escalation: the moment "no department"
//   means "every department", the whole mechanism is decorative.
// ============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requestScoped } from "@/lib/middleware/requestCache";
import {
  decideDepartmentScope,
  type DepartmentScope,
} from "@/lib/domain/department/scope";
import type { JwtPayload } from "@/lib/auth/jwt";
import { fail, type ApiResponse } from "@/types";

export type { DepartmentScope };

/**
 * The department a user heads, or null.
 *
 * findUnique, because Department.hodUserId is @unique — one HOD heads at most
 * one department, enforced by the database rather than by a convention this
 * function would have to trust.
 *
 * Memoised per request: a route that scopes both its page query and its count
 * asks once.
 */
export async function departmentForHead(userId: string): Promise<string | null> {
  return requestScoped(`auth:hod-department:${userId}`, async () => {
    const department = await prisma.department.findUnique({
      where: { hodUserId: userId },
      select: { id: true },
    });

    return department?.id ?? null;
  });
}

export type DepartmentScopeResult =
  | { ok: true; scope: DepartmentScope }
  | { ok: false; response: NextResponse<ApiResponse<never>> };

/**
 * A head who heads nothing cannot be scoped, so they are refused.
 *
 * 403 rather than 404: they are authenticated and hold the role, and the
 * message names the caller's own configuration, which their university
 * administrator can see and fix. It discloses nothing about any department.
 */
function noDepartmentAssigned(): NextResponse<ApiResponse<never>> {
  return NextResponse.json(
    fail("No department is assigned to your account", "FORBIDDEN"),
    { status: 403 }
  );
}

/**
 * Resolve the department restriction for an authenticated session.
 *
 * INPUT   : the session requireRole/requireTenant already validated. Nothing
 *           from the request is read.
 * RETURNS : `restricted: true` with a department id for a DEPARTMENT_HOD;
 *           `restricted: false` for every other permitted role; or a 403 for a
 *           HOD with no department.
 *
 * ROLE PRECEDENCE
 *   A user holding BOTH UNIVERSITY_ADMIN and DEPARTMENT_HOD is not narrowed.
 *   The admin role is the wider grant and narrowing it would silently take
 *   away access the university deliberately gave — the restriction exists to
 *   bound a head, not to cap an administrator who also happens to head a
 *   department.
 *
 * @example
 * const guard = await requireRole(...STUDENT_READ_ROLES)
 * const tenantGuard = await requireTenant()
 * const scope = await resolveDepartmentScope(guard.session)
 * if (!scope.ok) return scope.response
 */
export async function resolveDepartmentScope(
  session: JwtPayload
): Promise<DepartmentScopeResult> {
  // The lookup is skipped entirely for a caller the decision cannot narrow, so
  // an administrator pays no query. decideDepartmentScope is asked first with a
  // null department precisely so this stays one rule rather than two copies of
  // "who counts as a head" that could drift apart.
  const withoutLookup = decideDepartmentScope(session.roles, null);
  if (withoutLookup.allowed) {
    return { ok: true, scope: withoutLookup.scope };
  }

  // Only a head reaches here, so only a head costs the read.
  const departmentId = await departmentForHead(session.sub);
  const decision = decideDepartmentScope(session.roles, departmentId);

  return decision.allowed
    ? { ok: true, scope: decision.scope }
    : { ok: false, response: noDepartmentAssigned() };
}

/**
 * The same decision as resolveDepartmentScope, flattened to the shape the
 * examination endpoints pass down their layers: a department id for a head, and
 * null for a caller who is not narrowed.
 *
 * WHY null RATHER THAN AN ABSENT ARGUMENT
 *   Every layer below takes `departmentId: string | null`, and null is checked
 *   with `=== null` at the query, so "not narrowed" is a value the code states
 *   rather than a case it forgets. An optional argument would let a route that
 *   omits it read as correct while silently serving the whole university —
 *   which is the exact failure this whole mechanism exists to prevent.
 *
 * The refusal for a head with no department is NOT re-implemented here; it is
 * resolveDepartmentScope's, so there is one answer to that question.
 */
export async function resolveDepartmentId(
  session: JwtPayload
): Promise<
  { ok: true; departmentId: string | null } | { ok: false; response: NextResponse<ApiResponse<never>> }
> {
  const scope = await resolveDepartmentScope(session);

  if (!scope.ok) return scope;

  return {
    ok: true,
    departmentId: scope.scope.restricted ? scope.scope.departmentId : null,
  };
}

/**
 * The programme ids belonging to a department.
 *
 * WHY THIS IS A SEPARATE QUERY RATHER THAN A NESTED `where`
 *   Student.programmeId is a plain scalar column: the schema declares NO
 *   relation from Student to Programme and no back-relation from Programme to
 *   Student, so `where: { programme: { departmentId } }` does not typecheck and
 *   cannot be written. Adding that relation would mean adding a foreign-key
 *   constraint to a column that has never had one, which fails outright if any
 *   existing row points at a programme that no longer exists — a real risk on a
 *   shared database, and a much larger change than this one needs.
 *
 *   So the ids are resolved first and applied with `programmeId: { in: [...] }`.
 *   One indexed read on Programme(departmentId), memoised per request.
 *
 * An empty array is a real answer — a department with no programmes has no
 * students — and the caller must apply it as `in: []`, which matches nothing.
 * It must NOT be treated as "no filter".
 */
export async function programmeIdsForDepartment(
  tenantId: string,
  departmentId: string
): Promise<string[]> {
  return requestScoped(`auth:dept-programmes:${tenantId}:${departmentId}`, async () => {
    const programmes = await prisma.programme.findMany({
      // tenantId as well as departmentId: a department id is opaque, and
      // pairing it with the caller's tenant means even a forged one cannot
      // reach another institution's programmes.
      where: { tenantId, departmentId },
      select: { id: true },
    });

    return programmes.map((programme) => programme.id);
  });
}
