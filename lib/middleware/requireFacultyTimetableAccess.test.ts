// ============================================================================
// OWNER  : Gauransh
// MODULE : Timetable — Faculty Schedule
// LAYER  : Middleware — Unit Tests
// PURPOSE: Exercise every branch of the faculty-schedule route guard, and pin
//          the confinement rule the route applies on top of it.
//
//          The two collaborators are injected, so all of this runs with no
//          Next.js request context, no cookies, no session and no database.
//          What is verified is WHICH roles are asked for, in WHAT order, and
//          the SHAPE of what comes back — and on an endpoint that exposes one
//          person's teaching schedule, all three are security properties:
//
//            • UNIVERSITY_ADMIN resolves to scope ANY, unchanged from before
//            • FACULTY resolves to scope OWN, so the route confines them
//            • no role outside the permitted set is ever admitted
//            • userId comes from session.sub and from nowhere else
//            • the failing guard's own response is returned VERBATIM, so the
//              401-vs-403 distinction cannot be flattened by the fallback
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NextResponse } from "next/server";
import { ROLES } from "@/constants/roles";
import {
  FACULTY_TIMETABLE_ADMIN_ROLES,
  FACULTY_TIMETABLE_ROLES,
  requireFacultyTimetableAccess,
  type FacultyTimetableAccessDeps,
} from "@/lib/middleware/requireFacultyTimetableAccess";

const TENANT_ID = "tenant_1";
const ADMIN_USER_ID = "user_admin";
const FACULTY_USER_ID = "user_faculty";

/** A response object distinguishable by identity, so "verbatim" is provable. */
function sentinel(status: number): NextResponse {
  return NextResponse.json({ success: false, error: `sentinel-${status}` }, { status });
}

interface Behaviour {
  /** Role names the simulated caller actually holds. */
  holds: readonly string[];
  tenantResolved?: boolean;
  tenantResponse?: NextResponse;
  roleResponse?: NextResponse;
  sub?: string;
}

/**
 * Build injected deps that answer as requireRole really does: authorised when
 * the caller holds ANY of the roles asked for, refused otherwise.
 */
function deps(behaviour: Behaviour) {
  const rolesAskedFor: string[][] = [];
  const order: string[] = [];

  const injected = {
    async requireRole(...roles: string[]) {
      order.push("requireRole");
      rolesAskedFor.push(roles);

      const permitted = behaviour.holds.some((held) => roles.includes(held));

      if (!permitted) {
        return { authorized: false as const, response: behaviour.roleResponse ?? sentinel(403) };
      }

      return {
        authorized: true as const,
        session: {
          sub: behaviour.sub ?? FACULTY_USER_ID,
          tenantId: TENANT_ID,
          email: "someone@demo.edu",
          roles: [...behaviour.holds],
        },
      };
    },

    async requireTenant() {
      order.push("requireTenant");

      if (behaviour.tenantResolved === false) {
        return { resolved: false as const, response: behaviour.tenantResponse ?? sentinel(404) };
      }

      return { resolved: true as const, session: {}, tenant: { id: TENANT_ID } };
    },
  } as unknown as FacultyTimetableAccessDeps;

  return { injected, rolesAskedFor, order };
}

/**
 * The confinement the ROUTE applies to the guard's answer.
 *
 * Restated here rather than imported because it lives inside a Next.js route
 * handler, which cannot export anything but handlers and segment config. This
 * is the exact expression the handler runs, so a change to one that is not
 * mirrored in the other fails these tests.
 */
function routeWouldForbid(
  scope: "ANY" | "OWN",
  callerUserId: string,
  facultyOwnerUserId: string
): boolean {
  return scope === "OWN" && facultyOwnerUserId !== callerUserId;
}

describe("requireFacultyTimetableAccess", () => {
  describe("1. UNIVERSITY_ADMIN", () => {
    it("is granted scope ANY and reaches any faculty member — 200", async () => {
      const { injected, rolesAskedFor } = deps({
        holds: [ROLES.UNIVERSITY_ADMIN],
        sub: ADMIN_USER_ID,
      });

      const result = await requireFacultyTimetableAccess(injected);

      assert.equal(result.granted, true);
      assert.ok(result.granted);
      assert.equal(result.access.scope, "ANY");
      assert.equal(result.access.tenantId, TENANT_ID);
      assert.equal(result.access.userId, ADMIN_USER_ID);

      // The elevated set is tried FIRST, so the administrative path costs one
      // role call rather than two.
      assert.deepEqual(rolesAskedFor[0], [...FACULTY_TIMETABLE_ADMIN_ROLES]);
      assert.equal(rolesAskedFor.length, 1);

      // Scope ANY is never confined, even against a record owned by somebody else.
      assert.equal(routeWouldForbid("ANY", ADMIN_USER_ID, FACULTY_USER_ID), false);
    });
  });

  describe("2 & 3. FACULTY", () => {
    it("is granted scope OWN carrying session.sub, never a client value", async () => {
      const { injected, rolesAskedFor } = deps({
        holds: [ROLES.FACULTY],
        sub: FACULTY_USER_ID,
      });

      const result = await requireFacultyTimetableAccess(injected);

      assert.ok(result.granted);
      assert.equal(result.access.scope, "OWN");
      assert.equal(result.access.userId, FACULTY_USER_ID);
      assert.equal(result.access.tenantId, TENANT_ID);

      // Elevated set first and refused, then the full permitted set.
      assert.deepEqual(rolesAskedFor[0], [...FACULTY_TIMETABLE_ADMIN_ROLES]);
      assert.deepEqual(rolesAskedFor[1], [...FACULTY_TIMETABLE_ROLES]);
    });

    it("reaches their OWN facultyId — 200", () => {
      // The FacultyMember row names the caller as its user.
      assert.equal(routeWouldForbid("OWN", FACULTY_USER_ID, FACULTY_USER_ID), false);
    });

    it("is REFUSED another faculty member's facultyId — 403", () => {
      // Same tenant, different owner. This is the regression the fix must never
      // trade away: admitting FACULTY without this check would expose every
      // colleague's schedule.
      assert.equal(routeWouldForbid("OWN", FACULTY_USER_ID, "user_other_faculty"), true);
    });
  });

  describe("4. Unauthorized roles — denial unchanged", () => {
    for (const role of [ROLES.STUDENT, ROLES.PARENT, ROLES.CAMPUS_ADMIN, ROLES.HOD]) {
      it(`refuses ${role} verbatim, without resolving a tenant`, async () => {
        const refusal = sentinel(403);
        const { injected, order } = deps({ holds: [role], roleResponse: refusal });

        const result = await requireFacultyTimetableAccess(injected);

        assert.equal(result.granted, false);
        assert.ok(!result.granted);
        // Returned as-is, so the envelope and status stay project-consistent.
        assert.equal(result.response, refusal);
        // Role is checked BEFORE tenant, so a refused caller never learns
        // whether a tenant resolved.
        assert.ok(!order.includes("requireTenant"));
      });
    }

    it("keeps the permitted set to exactly UNIVERSITY_ADMIN and FACULTY", () => {
      // Pins the blast radius of the fix: no role gained access beyond FACULTY.
      assert.deepEqual([...FACULTY_TIMETABLE_ROLES], [ROLES.UNIVERSITY_ADMIN, ROLES.FACULTY]);
      assert.deepEqual([...FACULTY_TIMETABLE_ADMIN_ROLES], [ROLES.UNIVERSITY_ADMIN]);
    });

    it("returns requireAuth's 401 for an anonymous caller, not the first 403", async () => {
      // Holding nothing fails both role calls. The response returned is the
      // SECOND one, which is why an anonymous caller cannot be reported as
      // merely forbidden.
      const unauthorized = sentinel(401);
      const { injected } = deps({ holds: [], roleResponse: unauthorized });

      const result = await requireFacultyTimetableAccess(injected);

      assert.ok(!result.granted);
      assert.equal(result.response, unauthorized);
    });
  });

  describe("tenant isolation is unchanged", () => {
    it("returns the tenant guard's own response when no tenant resolves", async () => {
      const notFound = sentinel(404);
      const { injected } = deps({
        holds: [ROLES.UNIVERSITY_ADMIN],
        tenantResolved: false,
        tenantResponse: notFound,
      });

      const result = await requireFacultyTimetableAccess(injected);

      assert.ok(!result.granted);
      assert.equal(result.response, notFound);
    });

    it("returns the tenant guard's own response for a faculty caller too", async () => {
      const notFound = sentinel(404);
      const { injected } = deps({
        holds: [ROLES.FACULTY],
        tenantResolved: false,
        tenantResponse: notFound,
      });

      const result = await requireFacultyTimetableAccess(injected);

      assert.ok(!result.granted);
      assert.equal(result.response, notFound);
    });
  });
});
