// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty — Own Record (self-service)
// FLOW   : Guard (role → tenant) → resolve the caller's own FacultyMember →
//          response.
// ACCESS : FACULTY · UNIVERSITY_ADMIN · HOD, self-service only.
// BACKEND: Reads ONLY the existing FacultyMember model via lib/db/prisma.
//          Read-only — no write, no new model, no schema change.
// PURPOSE: Let a signed-in member of staff find the FacultyMember row they ARE.
//
// WHY THIS ROUTE EXISTS
//   GET /api/faculty is the staff DIRECTORY and is requireRole
//   ("UNIVERSITY_ADMIN") — correctly, because listing every colleague is an
//   administrative act. That left a lecturer with no way to discover their own
//   record at all: nothing else in app/api maps a User to a FacultyMember, and
//   /api/auth/me returns the User only. Every screen in the faculty portal
//   begins by resolving that row, so all six of them dead-ended on a 403 from
//   the directory before issuing a single further request.
//
//   This is the faculty counterpart of GET /api/student/profile, and it copies
//   that route's security model deliberately rather than inventing a second
//   one.
//
// SECURITY: There is no [id] segment on this route and no id in its query. The
//          caller is resolved from session.sub, so a client-supplied identifier
//          is not rejected here — it is UNEXPRESSIBLE, because nothing in the
//          path, the query or the lookup below can carry one. That is the same
//          property /api/student/profile relies on, and it is what makes this
//          route safe to open to a role that may not read the directory.
//
// TENANT ISOLATION: the tenant comes from requireTenant, never from the request,
//          and the lookup is filtered on it as well as on the user. A session
//          carried into the wrong tenant resolves to nothing rather than to a
//          colleague.
//
// QUERY BUDGET: one statement, on top of the guards' own reads.
// ============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { ROLES } from "@/constants/roles";
import { ok, fail } from "@/types";
import { handleRouteError } from "@/lib/utils/api-response";

const SCOPE = "GET /api/faculty/me";

/**
 * Columns returned for a faculty member.
 *
 * Restated rather than imported from the collection route, which is not a
 * stylistic choice: a Next.js route module may only export route handlers and
 * segment config, so a constant cannot be shared out of one. The same
 * restatement already exists in GET /api/faculty/[id], and TIMETABLE_SELECT,
 * COURSE_SELECT and FACULTY_SELECT are restated in their own detail routes for
 * this exact reason.
 *
 * It is byte-identical to the collection's shape ON PURPOSE — this route
 * answers with the same FacultyMember contract every other faculty endpoint
 * does, so a client can hold one type for all of them. No relation is expanded,
 * matching the collection: the linked User is reached through
 * GET /api/faculty/[id].
 */
const FACULTY_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  employeeId: true,
  departmentId: true,
  designation: true,
  qualification: true,
  specialization: true,
  experience: true,
  status: true,
  joinDate: true,
  createdAt: true,
  updatedAt: true,
} as const;

// FacultyMember holds no BigInt, Decimal or Json column, so the shared
// serialize() helper is not applied here — the same note as the collection.

// GET
// ACCESS     : requireRole(FACULTY, UNIVERSITY_ADMIN, HOD) then requireTenant,
//              in that order, so an unauthenticated caller receives
//              requireAuth's 401 and a wrongly-roled one receives 403 without a
//              tenant lookup ever being performed. Reversing them would leak
//              the existence of a tenant to someone not permitted to reach the
//              module — the ordering /api/student/profile's guard also uses.
// VALIDATION : None. There is no body and no parameter to validate; the only
//              input is the session, which the guards have already verified.
// FLOW       : Guard → resolve by (userId, tenantId) → return.
//
//              An administrator who holds no FacultyMember row of their own
//              receives 404, not an empty body and not somebody else's record.
//              UNIVERSITY_ADMIN and HOD are admitted because a head of
//              department who also teaches has a record here and needs their
//              own portal; they read the DIRECTORY through /api/faculty as
//              before, which this route does not touch.
// RESPONSE   : { success: true, data: <FacultyMember> }
// STATUS     : 200 OK · 401 UNAUTHORIZED · 403 FORBIDDEN · 404 NOT_FOUND
//              · 500 SERVER_ERROR
export async function GET() {
  try {
    const guard = await requireRole(ROLES.FACULTY, ROLES.UNIVERSITY_ADMIN, ROLES.HOD);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // findFirst rather than findUnique: FacultyMember is unique on userId
    // alone, but the tenant predicate is what makes this lookup safe, and a
    // unique lookup cannot carry it. The pairing matches the one
    // StudentProfileRepository.findStudentByUserId uses for the same reason.
    const member = await prisma.facultyMember.findFirst({
      where: {
        userId: guard.session.sub,
        tenantId: tenantGuard.tenant.id,
      },
      select: FACULTY_SELECT,
    });

    if (!member) {
      return NextResponse.json(
        fail("No faculty record exists for this account", "NOT_FOUND"),
        { status: 404 }
      );
    }

    return NextResponse.json(ok(member));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
