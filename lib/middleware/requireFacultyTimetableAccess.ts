// ============================================================================
// OWNER  : Gauransh
// MODULE : Timetable — Faculty Schedule
// LAYER  : Middleware (route guard)
// PURPOSE: Decide how much of the tenant a faculty-schedule caller may reach,
//          and resolve their tenant — in ONE call.
//
// WHY THIS EXISTS
//   GET /api/timetables/faculty/[facultyId] was guarded by
//   requireRole("UNIVERSITY_ADMIN") alone, so a faculty member was refused
//   their OWN teaching schedule with 403. That is not a cosmetic gap: the
//   faculty dashboard, My Schedule and Attendance-marking screens all read this
//   endpoint, so all three rendered with zero slots for the person the schedule
//   belongs to.
//
//   The rule those screens need is the one Phase 23 already states for faculty
//   records: an administrative caller reaches anyone in their tenant, a faculty
//   member reaches only themselves. This states it for the timetable endpoint.
//
// WHY NOT REUSE requireFacultyProfileAccess
//   It resolves the same ANY/OWN authority and its shape is deliberately
//   mirrored here — but its role sets are Phase 23's, which admit DEPARTMENT_HOD
//   and HOD alongside UNIVERSITY_ADMIN. Borrowing it would hand two roles a
//   capability on this endpoint that they do not hold today, which is a widening
//   of access disguised as reuse. The permitted set below is exactly the one
//   this route already honoured, plus FACULTY confined to themselves.
//
// WHY THE ELEVATED CHECK RUNS FIRST
//   Role precedence is administrative > faculty, so the common administrative
//   path costs ONE role call and only a faculty member pays for a second. It
//   also keeps the failure codes right: an anonymous caller fails both and
//   receives requireAuth's 401 from the second, so the fallback cannot turn a
//   401 into a 403. requireRole memoises the underlying read per request
//   (requestScoped on the caller's id), so the second call costs no query.
//
// WHAT THIS DOES NOT DO
//   It never resolves a FacultyMember row and never compares ids. It returns the
//   AUTHORITY; the route applies it, because confining a caller to their own
//   record needs the row that names its owner and this guard performs no reads
//   of its own. Same split as requireFacultyProfileAccess.
// ============================================================================

import type { NextResponse } from "next/server";
import { requireRole as defaultRequireRole } from "@/lib/middleware/requireRole";
import { requireTenant as defaultRequireTenant } from "@/lib/middleware/requireTenant";
import { ROLES } from "@/constants/roles";
import type { ApiResponse } from "@/types";

/**
 * Roles that reach ANY faculty member's schedule within their tenant.
 *
 * Exactly the set this route already permitted. Nothing is added: the fix is
 * about admitting a faculty member to their own row, not about broadening who
 * may read a colleague's.
 */
export const FACULTY_TIMETABLE_ADMIN_ROLES = [ROLES.UNIVERSITY_ADMIN] as const;

/**
 * Every role permitted to reach the endpoint at all.
 *
 * FACULTY is admitted at the ROLE gate and narrowed at the DATA gate — the
 * route refuses a facultyId that is not theirs. STUDENT, PARENT and every other
 * role are absent, so they are refused here exactly as they were before.
 */
export const FACULTY_TIMETABLE_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.FACULTY,
] as const;

/** How much of the tenant the caller may reach. */
export type FacultyTimetableScope = "ANY" | "OWN";

/** Everything the schedule route needs about its caller. */
export interface FacultyTimetableAccess {
  /** The tenant the request resolved to. Proven to match the session. */
  readonly tenantId: string;
  /** The authenticated subject. Never client-supplied. */
  readonly userId: string;
  /** ANY — administrative. OWN — confined to the caller's own record. */
  readonly scope: FacultyTimetableScope;
}

/** Either the authority the caller holds, or the response to return as-is. */
export type FacultyTimetableAccessGuard =
  | { granted: true; access: FacultyTimetableAccess }
  | { granted: false; response: NextResponse<ApiResponse<never>> };

/** The guards this middleware composes. Injected so every branch is testable. */
export interface FacultyTimetableAccessDeps {
  requireRole: typeof defaultRequireRole;
  requireTenant: typeof defaultRequireTenant;
}

const DEFAULT_DEPS: FacultyTimetableAccessDeps = {
  requireRole: defaultRequireRole,
  requireTenant: defaultRequireTenant,
};

/**
 * Resolve a caller's faculty-schedule authority and their tenant.
 *
 * The requested facultyId is deliberately NOT a parameter: this function
 * decides WHAT the caller may reach, never WHICH record they asked for.
 *
 * COMPLEXITY : one or two role calls plus one tenant call. No database work of
 *              its own beyond what those guards perform.
 */
export async function requireFacultyTimetableAccess(
  deps: FacultyTimetableAccessDeps = DEFAULT_DEPS
): Promise<FacultyTimetableAccessGuard> {
  const elevated = await deps.requireRole(...FACULTY_TIMETABLE_ADMIN_ROLES);

  if (elevated.authorized) {
    const tenantGuard = await deps.requireTenant();

    if (!tenantGuard.resolved) {
      return { granted: false, response: tenantGuard.response };
    }

    return {
      granted: true,
      access: {
        tenantId: tenantGuard.tenant.id,
        userId: elevated.session.sub,
        scope: "ANY",
      },
    };
  }

  // The full set rather than FACULTY alone, so an anonymous caller fails this
  // second check and receives requireAuth's 401 rather than the 403 the first
  // check produced.
  const own = await deps.requireRole(...FACULTY_TIMETABLE_ROLES);

  if (!own.authorized) {
    return { granted: false, response: own.response };
  }

  const tenantGuard = await deps.requireTenant();

  if (!tenantGuard.resolved) {
    return { granted: false, response: tenantGuard.response };
  }

  return {
    granted: true,
    access: {
      tenantId: tenantGuard.tenant.id,
      // The authenticated subject. The route resolves this against the owner of
      // the requested FacultyMember row; nothing a client sends can influence it.
      userId: own.session.sub,
      scope: "OWN",
    },
  };
}
