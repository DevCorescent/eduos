// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance — Section Roster
// LAYER  : Middleware (route guard)
// PURPOSE: Decide whether a caller may read the student roster of ONE section
//          for ONE course, and resolve their tenant — in ONE call.
//
// WHY THIS EXISTS RATHER THAN WIDENING /api/students
//   Marking attendance needs the register for one class. The only endpoint that
//   could supply it, GET /api/students, is the institution-wide roster and is
//   UNIVERSITY_ADMIN-only, so a lecturer received 403 and the marking screen
//   rendered an empty register. Admitting FACULTY there would have handed every
//   lecturer the ability to enumerate every student in the institution —
//   programme, batch, section, semester, admission and graduation dates — which
//   is enormously wider than "the register for my class". This states the
//   narrow rule instead, and /api/students is left exactly as it was.
//
// THE OWNERSHIP PROOF IS THE POINT OF THIS MODULE
//   A section alone is NOT a teaching relationship: a lecturer teaches a COURSE
//   to a SECTION, and two different lecturers may each own a different course in
//   the same section. So the pair is what gets proven, never the section alone,
//   and courseId is required rather than optional for exactly that reason.
//
//   The proof accepts either of the two models that express the relationship:
//
//     Timetable                — a scheduled slot for (faculty, section, course)
//     FacultyCourseAssignment  — an explicit assignment of a course to a
//                                lecturer, optionally narrowed to a section
//
//   Either is sufficient because either is a true statement that this lecturer
//   teaches this class; requiring both would refuse a lecturer whose course is
//   assigned but not yet timetabled, which is an ordinary state at the start of
//   a term.
//
// NEVER TRUST A CLIENT facultyId
//   No facultyId is accepted from anywhere. The caller's FacultyMember row is
//   resolved from session.sub — the authenticated subject — exactly as
//   /api/faculty/me does. There is nothing here for a client to substitute.
//
// ORDER OF THE CHECKS, WHICH IS A SECURITY PROPERTY
//   role → tenant → section-in-tenant → ownership. A caller with the wrong role
//   never learns whether a tenant resolved. A section belonging to another
//   tenant is 404 before any ownership comparison runs, so a foreign section id
//   is never confirmed to exist. Only a section genuinely inside the caller's
//   own tenant can reach the 403, so that 403 discloses nothing a lecturer
//   could not already learn from their own institution's directory.
//
// TESTABILITY
//   Both guards AND the three reads are injected with defaults, matching the
//   `client: DbClient = prisma` convention the repositories use. Passing the
//   reads as functions rather than a Prisma client is what lets every branch
//   below be exercised with no Next.js request context, no cookies and no
//   database.
// ============================================================================

import type { NextResponse } from "next/server";
import { NextResponse as NextResponseImpl } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  findFacultyIdForUser as defaultFindFacultyIdForUser,
  teachesPair as defaultTeachesPair,
} from "@/lib/services/facultyTeaching";
import { requireRole as defaultRequireRole } from "@/lib/middleware/requireRole";
import { requireTenant as defaultRequireTenant } from "@/lib/middleware/requireTenant";
import { ROLES } from "@/constants/roles";
import { fail, type ApiResponse } from "@/types";

/**
 * Roles that read ANY section's roster within their tenant.
 *
 * Exactly the set that reaches the institution-wide roster today, so this
 * endpoint grants an administrator nothing they did not already hold.
 */
export const SECTION_ROSTER_ADMIN_ROLES = [ROLES.UNIVERSITY_ADMIN] as const;

/**
 * Every role permitted to reach the endpoint at all.
 *
 * FACULTY is admitted at the ROLE gate and narrowed at the DATA gate to the
 * (section, course) pairs they actually teach. STUDENT, PARENT and every other
 * role are absent and are refused 403, exactly as they are on /api/students.
 */
export const SECTION_ROSTER_ROLES = [
  ROLES.UNIVERSITY_ADMIN,
  ROLES.FACULTY,
] as const;

/** How much of the tenant the caller may reach. */
export type SectionRosterScope = "ANY" | "OWN";

/** Everything the roster route needs about its caller. */
export interface SectionRosterAccess {
  /** The tenant the request resolved to. Proven to match the session. */
  readonly tenantId: string;
  /** The authenticated subject. Never client-supplied. */
  readonly userId: string;
  /** ANY — administrative. OWN — proven to teach the requested pair. */
  readonly scope: SectionRosterScope;
}

/** Either the authority the caller holds, or the response to return as-is. */
export type SectionRosterAccessGuard =
  | { granted: true; access: SectionRosterAccess }
  | { granted: false; response: NextResponse<ApiResponse<never>> };

/** The collaborators this middleware composes. Injected so every branch is testable. */
export interface SectionRosterAccessDeps {
  requireRole: typeof defaultRequireRole;
  requireTenant: typeof defaultRequireTenant;
  /** Does this section exist INSIDE this tenant? */
  sectionExists(tenantId: string, sectionId: string): Promise<boolean>;
  /** The caller's own FacultyMember id, resolved from the authenticated subject. */
  findFacultyIdForUser(tenantId: string, userId: string): Promise<string | null>;
  /** Does this faculty member teach this exact (section, course) pair? */
  teachesPair(
    tenantId: string,
    facultyId: string,
    sectionId: string,
    courseId: string
  ): Promise<boolean>;
}

const DEFAULT_DEPS: SectionRosterAccessDeps = {
  requireRole: defaultRequireRole,
  requireTenant: defaultRequireTenant,

  async sectionExists(tenantId, sectionId) {
    // tenantId is part of the lookup rather than checked afterwards, so another
    // tenant's section is never loaded and never acknowledged.
    const section = await prisma.section.findFirst({
      where: { id: sectionId, tenantId },
      select: { id: true },
    });

    return section !== null;
  },

  // Both delegate to lib/services/facultyTeaching.ts rather than querying here.
  // POST /api/attendance now confines a lecturer to the classes they teach
  // using the SAME predicate, and a read rule that drifted from the write rule
  // would show a lecturer a register they are then refused permission to
  // submit. Stated once, it cannot drift.
  findFacultyIdForUser: defaultFindFacultyIdForUser,
  teachesPair: defaultTeachesPair,
};

/** Built when the section names nothing inside this tenant — existing NOT_FOUND code. */
function sectionNotFound(): NextResponse<ApiResponse<never>> {
  return NextResponseImpl.json(fail("Section not found", "NOT_FOUND"), { status: 404 });
}

/** Built on the ownership-rejection path — existing FORBIDDEN code and 403 status. */
function forbidden(): NextResponse<ApiResponse<never>> {
  return NextResponseImpl.json(fail("Forbidden", "FORBIDDEN"), { status: 403 });
}

/**
 * Resolve a caller's authority over one section's roster.
 *
 * INPUT   : the section and course being asked for. Both are needed because the
 *           relationship that grants a lecturer access is the PAIR.
 * RETURNS : `granted: false` carrying an already-built response, so the calling
 *           route early-returns it verbatim rather than re-declaring status
 *           codes or error shapes — the same contract requireRole and
 *           requireTenant use.
 *
 * COMPLEXITY : one or two role calls, one tenant call, one section read, and —
 *              for a faculty caller only — one faculty read plus two ownership
 *              reads issued in parallel.
 */
export async function requireSectionRosterAccess(
  sectionId: string,
  courseId: string,
  deps: SectionRosterAccessDeps = DEFAULT_DEPS
): Promise<SectionRosterAccessGuard> {
  const elevated = await deps.requireRole(...SECTION_ROSTER_ADMIN_ROLES);

  if (elevated.authorized) {
    const tenantGuard = await deps.requireTenant();

    if (!tenantGuard.resolved) {
      return { granted: false, response: tenantGuard.response };
    }

    const tenantId = tenantGuard.tenant.id;

    if (!(await deps.sectionExists(tenantId, sectionId))) {
      return { granted: false, response: sectionNotFound() };
    }

    return {
      granted: true,
      access: { tenantId, userId: elevated.session.sub, scope: "ANY" },
    };
  }

  // The full set rather than FACULTY alone, so an anonymous caller fails this
  // second check and receives requireAuth's 401 rather than the 403 the first
  // check produced.
  const own = await deps.requireRole(...SECTION_ROSTER_ROLES);

  if (!own.authorized) {
    return { granted: false, response: own.response };
  }

  const tenantGuard = await deps.requireTenant();

  if (!tenantGuard.resolved) {
    return { granted: false, response: tenantGuard.response };
  }

  const tenantId = tenantGuard.tenant.id;

  // Before the ownership proof, so a section outside this tenant is 404 and is
  // never distinguishable from one that does not exist at all.
  if (!(await deps.sectionExists(tenantId, sectionId))) {
    return { granted: false, response: sectionNotFound() };
  }

  // Resolved from the authenticated subject. No facultyId is read from the
  // path, the query or the body, here or in the route.
  const facultyId = await deps.findFacultyIdForUser(tenantId, own.session.sub);

  // Holding the FACULTY role without a FacultyMember row is a misconfigured
  // account, not an authority. Refused rather than treated as elevated.
  if (facultyId === null) {
    return { granted: false, response: forbidden() };
  }

  if (!(await deps.teachesPair(tenantId, facultyId, sectionId, courseId))) {
    return { granted: false, response: forbidden() };
  }

  return {
    granted: true,
    access: { tenantId, userId: own.session.sub, scope: "OWN" },
  };
}
