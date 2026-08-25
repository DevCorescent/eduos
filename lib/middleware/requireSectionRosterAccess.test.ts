// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance — Section Roster
// LAYER  : Middleware — Unit Tests
// PURPOSE: Exercise every branch of the roster guard.
//
//          The two guards AND the three reads are injected, so all of this runs
//          with no Next.js request context, no cookies, no session and no
//          database. What is verified is WHICH roles are asked for, in WHAT
//          ORDER the checks run, and the SHAPE of what comes back — and on an
//          endpoint that hands over a list of named students, all three are
//          security properties:
//
//            • UNIVERSITY_ADMIN resolves to scope ANY, unchanged from the
//              institution-wide roster they already reach
//            • FACULTY resolves to scope OWN only after the (section, course)
//              pair is PROVEN, against either model that expresses teaching
//            • no role outside the permitted set is ever admitted
//            • a cross-tenant section is 404 BEFORE any ownership comparison,
//              so a foreign section id is never confirmed to exist
//            • no facultyId is ever taken from a caller — it is resolved from
//              session.sub and from nowhere else
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NextResponse } from "next/server";
import { ROLES } from "@/constants/roles";
import {
  SECTION_ROSTER_ADMIN_ROLES,
  SECTION_ROSTER_ROLES,
  requireSectionRosterAccess,
  type SectionRosterAccessDeps,
} from "@/lib/middleware/requireSectionRosterAccess";

const TENANT_ID = "tenant_1";
const ADMIN_USER_ID = "user_admin";
const FACULTY_USER_ID = "user_faculty";
const FACULTY_ID = "faculty_1";
const SECTION_ID = "section_1";
const COURSE_ID = "course_1";

/** A response object distinguishable by identity, so "verbatim" is provable. */
function sentinel(status: number): NextResponse {
  return NextResponse.json({ success: false, error: `sentinel-${status}` }, { status });
}

interface Behaviour {
  /** Role names the simulated caller actually holds. */
  holds: readonly string[];
  sub?: string;
  tenantResolved?: boolean;
  tenantResponse?: NextResponse;
  roleResponse?: NextResponse;
  /** Whether the section exists inside the resolved tenant. */
  sectionExists?: boolean;
  /** The caller's own FacultyMember id, or null when they have no row. */
  facultyId?: string | null;
  /** The (section, course) pairs this faculty member genuinely teaches. */
  teaches?: readonly (readonly [string, string])[];
}

function deps(behaviour: Behaviour) {
  const rolesAskedFor: string[][] = [];
  const order: string[] = [];
  /** Every argument tuple teachesPair was called with, to prove what got proven. */
  const ownershipChecks: string[][] = [];

  const injected: SectionRosterAccessDeps = {
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

    async sectionExists(tenantId: string, sectionId: string) {
      order.push("sectionExists");
      assert.equal(tenantId, TENANT_ID, "section is always looked up within the resolved tenant");
      assert.equal(sectionId, SECTION_ID);
      return behaviour.sectionExists ?? true;
    },

    async findFacultyIdForUser(tenantId: string, userId: string) {
      order.push("findFacultyIdForUser");
      assert.equal(tenantId, TENANT_ID);
      // The whole point: resolution is by the authenticated subject.
      assert.equal(userId, behaviour.sub ?? FACULTY_USER_ID);
      return behaviour.facultyId === undefined ? FACULTY_ID : behaviour.facultyId;
    },

    async teachesPair(tenantId: string, facultyId: string, sectionId: string, courseId: string) {
      order.push("teachesPair");
      ownershipChecks.push([tenantId, facultyId, sectionId, courseId]);
      return (behaviour.teaches ?? []).some(
        ([sec, crs]) => sec === sectionId && crs === courseId
      );
    },
  } as unknown as SectionRosterAccessDeps;

  return { injected, rolesAskedFor, order, ownershipChecks };
}

describe("requireSectionRosterAccess", () => {
  describe("UNIVERSITY_ADMIN → ANY", () => {
    it("is granted scope ANY for any section, with no ownership proof required", async () => {
      const { injected, rolesAskedFor, order } = deps({
        holds: [ROLES.UNIVERSITY_ADMIN],
        sub: ADMIN_USER_ID,
      });

      const result = await requireSectionRosterAccess(SECTION_ID, COURSE_ID, injected);

      assert.ok(result.granted);
      assert.equal(result.access.scope, "ANY");
      assert.equal(result.access.tenantId, TENANT_ID);
      assert.equal(result.access.userId, ADMIN_USER_ID);

      // Elevated set tried FIRST, so an administrator costs one role call.
      assert.deepEqual(rolesAskedFor[0], [...SECTION_ROSTER_ADMIN_ROLES]);
      assert.equal(rolesAskedFor.length, 1);

      // An administrator is never asked to prove they teach anything.
      assert.ok(!order.includes("teachesPair"));
      assert.ok(!order.includes("findFacultyIdForUser"));
    });

    it("still gets 404 for a section outside their tenant", async () => {
      const { injected } = deps({
        holds: [ROLES.UNIVERSITY_ADMIN],
        sub: ADMIN_USER_ID,
        sectionExists: false,
      });

      const result = await requireSectionRosterAccess(SECTION_ID, COURSE_ID, injected);

      assert.ok(!result.granted);
      assert.equal(result.response.status, 404);
    });
  });

  describe("FACULTY → OWN", () => {
    it("teaching the EXACT section+course pair is granted scope OWN", async () => {
      const { injected, rolesAskedFor, ownershipChecks } = deps({
        holds: [ROLES.FACULTY],
        teaches: [[SECTION_ID, COURSE_ID]],
      });

      const result = await requireSectionRosterAccess(SECTION_ID, COURSE_ID, injected);

      assert.ok(result.granted);
      assert.equal(result.access.scope, "OWN");
      assert.equal(result.access.userId, FACULTY_USER_ID);
      assert.equal(result.access.tenantId, TENANT_ID);

      assert.deepEqual(rolesAskedFor[0], [...SECTION_ROSTER_ADMIN_ROLES]);
      assert.deepEqual(rolesAskedFor[1], [...SECTION_ROSTER_ROLES]);

      // Proven against the caller's OWN resolved faculty id, never a client value.
      assert.deepEqual(ownershipChecks, [[TENANT_ID, FACULTY_ID, SECTION_ID, COURSE_ID]]);
    });

    it("is REFUSED 403 for a section they do not teach at all", async () => {
      const { injected } = deps({
        holds: [ROLES.FACULTY],
        teaches: [["section_other", COURSE_ID]],
      });

      const result = await requireSectionRosterAccess(SECTION_ID, COURSE_ID, injected);

      assert.ok(!result.granted);
      assert.equal(result.response.status, 403);
    });

    it("is REFUSED 403 for the right section but a course they do NOT teach", async () => {
      // The pair is the relationship. Two lecturers may each own a different
      // course in the same section, so the section alone must never suffice.
      const { injected } = deps({
        holds: [ROLES.FACULTY],
        teaches: [[SECTION_ID, "course_taught_by_a_colleague"]],
      });

      const result = await requireSectionRosterAccess(SECTION_ID, COURSE_ID, injected);

      assert.ok(!result.granted);
      assert.equal(result.response.status, 403);
    });

    it("is REFUSED 403 when the account holds FACULTY but has no FacultyMember row", async () => {
      const { injected, order } = deps({
        holds: [ROLES.FACULTY],
        facultyId: null,
        teaches: [[SECTION_ID, COURSE_ID]],
      });

      const result = await requireSectionRosterAccess(SECTION_ID, COURSE_ID, injected);

      assert.ok(!result.granted);
      assert.equal(result.response.status, 403);
      // Refused before any ownership question is even asked.
      assert.ok(!order.includes("teachesPair"));
    });

    it("gets 404 for a cross-tenant section BEFORE any ownership check runs", async () => {
      const { injected, order } = deps({
        holds: [ROLES.FACULTY],
        sectionExists: false,
        teaches: [[SECTION_ID, COURSE_ID]],
      });

      const result = await requireSectionRosterAccess(SECTION_ID, COURSE_ID, injected);

      assert.ok(!result.granted);
      assert.equal(result.response.status, 404);
      // The ordering IS the property: a foreign section id is never confirmed.
      assert.ok(!order.includes("teachesPair"));
      assert.ok(order.indexOf("sectionExists") < order.length);
    });
  });

  describe("Unauthorized roles — denial unchanged", () => {
    for (const role of [ROLES.STUDENT, ROLES.PARENT, ROLES.CAMPUS_ADMIN, ROLES.HOD]) {
      it(`refuses ${role} verbatim, without resolving a tenant or touching a section`, async () => {
        const refusal = sentinel(403);
        const { injected, order } = deps({ holds: [role], roleResponse: refusal });

        const result = await requireSectionRosterAccess(SECTION_ID, COURSE_ID, injected);

        assert.ok(!result.granted);
        assert.equal(result.response, refusal);
        assert.ok(!order.includes("requireTenant"));
        assert.ok(!order.includes("sectionExists"));
        assert.ok(!order.includes("teachesPair"));
      });
    }

    it("returns requireAuth's 401 for an anonymous caller, not the first 403", async () => {
      const unauthorized = sentinel(401);
      const { injected } = deps({ holds: [], roleResponse: unauthorized });

      const result = await requireSectionRosterAccess(SECTION_ID, COURSE_ID, injected);

      assert.ok(!result.granted);
      assert.equal(result.response, unauthorized);
    });

    it("keeps the permitted set to exactly UNIVERSITY_ADMIN and FACULTY", () => {
      // Pins the blast radius: nothing gained access beyond FACULTY, and the
      // administrative set is unchanged.
      assert.deepEqual([...SECTION_ROSTER_ROLES], [ROLES.UNIVERSITY_ADMIN, ROLES.FACULTY]);
      assert.deepEqual([...SECTION_ROSTER_ADMIN_ROLES], [ROLES.UNIVERSITY_ADMIN]);
    });
  });

  describe("tenant isolation is unchanged", () => {
    it("returns the tenant guard's own response for an admin caller", async () => {
      const notFound = sentinel(404);
      const { injected } = deps({
        holds: [ROLES.UNIVERSITY_ADMIN],
        tenantResolved: false,
        tenantResponse: notFound,
      });

      const result = await requireSectionRosterAccess(SECTION_ID, COURSE_ID, injected);

      assert.ok(!result.granted);
      assert.equal(result.response, notFound);
    });

    it("returns the tenant guard's own response for a faculty caller", async () => {
      const notFound = sentinel(404);
      const { injected, order } = deps({
        holds: [ROLES.FACULTY],
        tenantResolved: false,
        tenantResponse: notFound,
      });

      const result = await requireSectionRosterAccess(SECTION_ID, COURSE_ID, injected);

      assert.ok(!result.granted);
      assert.equal(result.response, notFound);
      // No section is looked up before a tenant is proven.
      assert.ok(!order.includes("sectionExists"));
    });
  });
});
