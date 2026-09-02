// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Reporting
// LAYER  : Middleware (route guard)
// PURPOSE: Decide how much of the tenant a result caller may read.
//
// WHY THIS IS ONE FUNCTION AND NOT THREE COPIES
//   The student, transcript and analytics endpoints share one authorisation
//   rule exactly: an examination-office caller reads anyone, a student reads
//   only themselves. Written inline it would be the same thirty lines in three
//   files, and the day the rule changed two of them would be updated and one
//   forgotten — which is how a student ends up reading someone else's record.
//
// WHY THE ELEVATED CHECK RUNS FIRST
//   Role precedence is elevated > student. Testing the elevated set first means
//   the common path costs ONE guard call and only a student pays for a second.
//   It also keeps the failure codes right: an anonymous caller fails both and
//   receives requireAuth's 401 from the second, so the fallback cannot turn a
//   401 into a 403.
//
// WHAT THIS DOES NOT DO
//   It never resolves a student. It returns the AUTHORITY; the service applies
//   it, because enforcing the confinement needs the repository and a route has
//   no business holding one.
//
//   It DOES read the database now, but only for a head of department, and only
//   to answer "which department do you head?" from the authenticated subject.
//   That read is memoised per request and an examination-office caller never
//   pays for it. It is a database read rather than a token claim for the reason
//   requireRole resolves roles live: a seven-day token would otherwise carry a
//   department assignment a week after it was revoked.
// ============================================================================

import type { NextResponse } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { resolveDepartmentScope } from "@/lib/auth/departmentScope";
import { RESULT_READ_ANY_ROLES, RESULT_READ_OWN_ROLES } from "@/lib/constants/result";
import type { ResultAccess } from "@/lib/services/result.service";
import type { ApiResponse } from "@/types";

/** Either the authority the caller holds, or the response to return as-is. */
export type ResultAccessGuard =
  | { granted: true; access: ResultAccess }
  | { granted: false; response: NextResponse<ApiResponse<never>> };

/**
 * Resolve a caller's result-reading authority.
 *
 * Returns ANY for the examination office, DEPARTMENT for a head of department,
 * and OWN — carrying the caller's own user id — for a student. The requested
 * student id is deliberately NOT a parameter: this function decides WHAT the
 * caller may read, never WHICH record they asked for, and keeping the two apart
 * is what stops a comparison being skipped by accident.
 *
 * WHY THE HEAD IS NARROWED HERE AND NOT IN THE ROLE LIST
 *   RESULT_READ_ANY_ROLES admits DEPARTMENT_HOD, and a role list is the wrong
 *   instrument for "some of the tenant": it can only say yes or no. Until this
 *   narrowing existed the yes was tenant-wide, and a head read any student's
 *   transcript in the university. Removing the role instead would have taken
 *   away access the product deliberately grants.
 *
 *   The head/department rule is NOT restated here. resolveDepartmentScope owns
 *   it — including the precedence that leaves a UNIVERSITY_ADMIN who also heads
 *   a department unnarrowed, and the refusal of a head with no department. A
 *   second copy of that rule is exactly how two answers to the same question
 *   drift apart.
 */
export async function requireResultAccess(): Promise<ResultAccessGuard> {
  const elevated = await requireRole(...RESULT_READ_ANY_ROLES);

  if (elevated.authorized) {
    const scope = await resolveDepartmentScope(elevated.session);

    // A head with no department assigned. Fail closed: the alternative is
    // reading "cannot be narrowed" as "needs no narrowing".
    if (!scope.ok) {
      return { granted: false, response: scope.response };
    }

    return {
      granted: true,
      access: scope.scope.restricted
        ? { scope: "DEPARTMENT", departmentId: scope.scope.departmentId }
        : { scope: "ANY" },
    };
  }

  const own = await requireRole(...RESULT_READ_OWN_ROLES);

  if (own.authorized) {
    return { granted: true, access: { scope: "OWN", userId: own.session.sub } };
  }

  return { granted: false, response: own.response };
}
