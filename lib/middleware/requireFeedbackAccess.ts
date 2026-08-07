// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Feedback System
// LAYER  : Middleware (route guard)
// PURPOSE: Authenticate, authorise and resolve the tenant for the four feedback
//          routes — which ask FOUR different questions, not one.
//
// FOUR AUTHORITIES, DELIBERATELY NOT COLLAPSED
//
//     SUBMIT            who may give feedback?           STUDENT only
//     FACULTY ANALYTICS who may read their own record?   FACULTY only
//     HOD ANALYTICS     who may read a colleague's?      DEPARTMENT_HOD
//     ADMIN REPORT      who may read the institution?    UNIVERSITY_ADMIN
//
//   Collapsing these into one guard would apply the widest rule everywhere, and
//   a student would reach the report. Each is a separate function with its own
//   role set, and the two ROUTES that admit more than one audience compose the
//   primitives in a stated precedence rather than widening any of them.
//
// THE FACULTY IDENTITY IS RESOLVED HERE, AND ONLY HERE
//   `FeedbackAccess` carries a `facultyId` for a FACULTY caller, because the
//   service uses it to confine them to their own record. That id is resolved
//   from the AUTHENTICATED SUBJECT — session.sub -> FacultyMember — and never
//   from anything the client sent. There is no request parameter anywhere in
//   this module that could supply one.
//
//   Resolving it needs a database read, which is why `resolveFacultyId` is an
//   injected dependency with a Prisma-backed default. requireTenant already
//   reads the database for the same reason, so this is the project's existing
//   shape rather than a new one.
//
// ROLE BEFORE TENANT, EVERYWHERE
//   An unauthenticated caller receives requireAuth's 401 through requireRole,
//   and a wrongly-roled one receives 403 without a tenant lookup running at
//   all. Reversing them would leak a tenant's existence to someone not
//   permitted to reach the module.
//
// TESTABILITY
//   All three collaborators are injected with defaults, matching the
//   `client: DbClient = prisma` convention the repositories already use, so
//   every branch below runs with no request context, no cookies and no
//   database.
// ============================================================================

import type { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole as defaultRequireRole } from "@/lib/middleware/requireRole";
import { requireTenant as defaultRequireTenant } from "@/lib/middleware/requireTenant";
import { ROLES } from "@/constants/roles";
import type { FeedbackAccess } from "@/lib/services/feedback.service";
import type { ApiResponse } from "@/types";

/** What a feedback route needs about its caller. */
export interface FeedbackContext {
  readonly tenantId: string;
  /** The authenticated subject. Never client-supplied. */
  readonly userId: string;
  readonly access: FeedbackAccess;
}

/** Either the caller's context, or the response to return to them as-is. */
export type FeedbackGuard =
  | { granted: true; context: FeedbackContext }
  | { granted: false; response: NextResponse<ApiResponse<never>> };

/** The collaborators this middleware composes. Injected so every branch is testable. */
export interface FeedbackAccessDeps {
  requireRole: typeof defaultRequireRole;
  requireTenant: typeof defaultRequireTenant;
  /** Resolves the FacultyMember a signed-in user IS. Null when they are not one. */
  resolveFacultyId: (tenantId: string, userId: string) => Promise<string | null>;
}

/**
 * The default faculty resolution.
 *
 * Tenant-scoped, so a session carried into the wrong tenant resolves to
 * nothing rather than to a faculty member. Projects the id and nothing else —
 * a guard needs an identity, not a record.
 */
async function defaultResolveFacultyId(
  tenantId: string,
  userId: string
): Promise<string | null> {
  const found = await prisma.facultyMember.findFirst({
    where: { userId, tenantId },
    select: { id: true },
  });

  return found?.id ?? null;
}

const DEFAULT_DEPS: FeedbackAccessDeps = {
  requireRole: defaultRequireRole,
  requireTenant: defaultRequireTenant,
  resolveFacultyId: defaultResolveFacultyId,
};

/**
 * The shared half of every authority: check a role set, then resolve a tenant.
 *
 * `access` is built by the caller of this helper rather than derived here,
 * because the four entry points mean four different things by it — and a helper
 * that guessed would be the one place the separation could quietly fail.
 */
async function guardWith(
  roles: readonly string[],
  deps: FeedbackAccessDeps,
  buildAccess: (
    tenantId: string,
    userId: string
  ) => FeedbackAccess | Promise<FeedbackAccess>
): Promise<FeedbackGuard> {
  const guard = await deps.requireRole(...roles);

  if (!guard.authorized) {
    return { granted: false, response: guard.response };
  }

  const tenantGuard = await deps.requireTenant();

  if (!tenantGuard.resolved) {
    return { granted: false, response: tenantGuard.response };
  }

  const tenantId = tenantGuard.tenant.id;
  const userId = guard.session.sub;

  return {
    granted: true,
    context: { tenantId, userId, access: await buildAccess(tenantId, userId) },
  };
}

// --- The four authorities ---------------------------------------------------

/**
 * POST /api/feedback/faculty and POST /api/feedback/lab.
 *
 * STUDENT alone. An administrator submitting on a student's behalf would be
 * indistinguishable in the data from the student submitting, and the opinion is
 * attributed to a person who did not hold it.
 */
export async function requireFeedbackSubmit(
  deps: FeedbackAccessDeps = DEFAULT_DEPS
): Promise<FeedbackGuard> {
  return guardWith([ROLES.STUDENT], deps, (_tenantId, userId) => ({
    scope: "STUDENT",
    userId,
  }));
}

/**
 * A FACULTY member reading their own analytics.
 *
 * The resolved `facultyId` is what confines them: the service refuses a faculty
 * caller whose id does not match the record they asked for. A caller holding
 * the role but owning no FacultyMember row resolves to null and is refused by
 * the domain engine — not served someone else's record.
 */
export async function requireFacultyAnalytics(
  deps: FeedbackAccessDeps = DEFAULT_DEPS
): Promise<FeedbackGuard> {
  return guardWith([ROLES.FACULTY], deps, async (tenantId, userId) => ({
    scope: "FACULTY",
    facultyId: await deps.resolveFacultyId(tenantId, userId),
  }));
}

/**
 * A DEPARTMENT_HOD reading analytics.
 *
 * No faculty id is resolved, because a head is not confined to a record — they
 * are gated by the disclosure threshold instead, which the domain engine
 * applies.
 */
export async function requireHodAnalytics(
  deps: FeedbackAccessDeps = DEFAULT_DEPS
): Promise<FeedbackGuard> {
  return guardWith([ROLES.DEPARTMENT_HOD], deps, () => ({ scope: "HOD" }));
}

/**
 * A UNIVERSITY_ADMIN reading anything.
 *
 * Never gated by the threshold and permitted attribution — the one audience
 * trusted with both.
 */
export async function requireAdminReport(
  deps: FeedbackAccessDeps = DEFAULT_DEPS
): Promise<FeedbackGuard> {
  return guardWith([ROLES.UNIVERSITY_ADMIN], deps, () => ({ scope: "ADMIN" }));
}

// --- The two composed routes ------------------------------------------------

/**
 * GET /api/feedback/faculty/[facultyId] — three audiences, one endpoint.
 *
 * Tried in PRECEDENCE order: admin, then head, then faculty. A caller holding
 * an elevated role is treated as elevated even if they are also a faculty
 * member, because the wider reading is the one they asked for by holding it —
 * and the narrower one would confine an administrator to their own record.
 *
 * The primitives are COMPOSED, not widened: each still names exactly its own
 * role, so no authority admits anyone it did not before.
 *
 * A caller holding none of the three receives the FACULTY guard's refusal,
 * which carries requireAuth's 401 for an anonymous caller rather than a 403.
 */
export async function requireFacultyFeedbackRead(
  deps: FeedbackAccessDeps = DEFAULT_DEPS
): Promise<FeedbackGuard> {
  const admin = await requireAdminReport(deps);

  if (admin.granted) {
    return admin;
  }

  const hod = await requireHodAnalytics(deps);

  if (hod.granted) {
    return hod;
  }

  return requireFacultyAnalytics(deps);
}

/**
 * GET /api/feedback/report — two audiences.
 *
 * FACULTY is absent, and the absence is the point: a cross-faculty report is a
 * comparison between colleagues, and it is a quality office's document rather
 * than a participant's. STUDENT is absent for the obvious reason.
 *
 * Neither is merely refused by the service afterwards — neither role appears in
 * either guard this composes, so they never reach it.
 */
export async function requireFeedbackReport(
  deps: FeedbackAccessDeps = DEFAULT_DEPS
): Promise<FeedbackGuard> {
  const admin = await requireAdminReport(deps);

  if (admin.granted) {
    return admin;
  }

  return requireHodAnalytics(deps);
}

/** The role sets, exported so a test asserts them in one place. */
export const FEEDBACK_GUARD_ROLES = {
  SUBMIT: [ROLES.STUDENT],
  FACULTY_ANALYTICS: [ROLES.FACULTY],
  HOD_ANALYTICS: [ROLES.DEPARTMENT_HOD],
  ADMIN_REPORT: [ROLES.UNIVERSITY_ADMIN],
} as const;
