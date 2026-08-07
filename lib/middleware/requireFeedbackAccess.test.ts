// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Feedback System
// LAYER  : Middleware — Unit Tests
// PURPOSE: Exercise every branch of the four authorities and the two composed
//          endpoints.
//
//          The failures that matter are specific: a STUDENT reaching the
//          report, a FACULTY member reaching the report, and an administrator
//          being confined to their own record because a composed guard tried
//          the narrow authority first. These tests assert the role sets DIFFER,
//          that the narrow ones are actually narrow, and that precedence runs
//          widest-first.
//
//          All three collaborators are injected, so this runs with no request
//          context, no cookies and no database.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NextResponse } from "next/server";
import { ROLES } from "@/constants/roles";
import {
  FEEDBACK_GUARD_ROLES,
  requireAdminReport,
  requireFacultyAnalytics,
  requireFacultyFeedbackRead,
  requireFeedbackReport,
  requireFeedbackSubmit,
  requireHodAnalytics,
  type FeedbackAccessDeps,
} from "@/lib/middleware/requireFeedbackAccess";

const TENANT_ID = "tenant_1";
const USER_ID = "user_1";
const FACULTY_ID = "faculty_1";

function sentinel(status: number): NextResponse {
  return NextResponse.json({ success: false, error: `sentinel-${status}` }, { status });
}

interface Behaviour {
  held?: readonly string[];
  tenantResolved?: boolean;
  roleResponse?: NextResponse;
  tenantResponse?: NextResponse;
  facultyId?: string | null;
}

function deps(behaviour: Behaviour = {}) {
  const asked: string[][] = [];
  const order: string[] = [];
  const held = new Set(behaviour.held ?? [ROLES.STUDENT]);

  const injected = {
    async requireRole(...roles: string[]) {
      asked.push(roles);
      order.push("requireRole");

      if (!roles.some((role) => held.has(role))) {
        return { authorized: false, response: behaviour.roleResponse ?? sentinel(403) };
      }

      return { authorized: true, session: { sub: USER_ID } };
    },
    async requireTenant() {
      order.push("requireTenant");

      if (behaviour.tenantResolved === false) {
        return { resolved: false, response: behaviour.tenantResponse ?? sentinel(404) };
      }

      return { resolved: true, session: { sub: USER_ID }, tenant: { id: TENANT_ID } };
    },
    async resolveFacultyId() {
      order.push("resolveFacultyId");
      return behaviour.facultyId === undefined ? FACULTY_ID : behaviour.facultyId;
    },
  } as unknown as FeedbackAccessDeps;

  return { injected, asked, order };
}

// --- The four authorities are genuinely different ----------------------------

describe("requireFeedbackAccess — four authorities, not one", () => {
  it("SUBMIT admits STUDENT alone", () => {
    assert.deepEqual([...FEEDBACK_GUARD_ROLES.SUBMIT], [ROLES.STUDENT]);
  });

  it("FACULTY_ANALYTICS admits FACULTY alone", () => {
    assert.deepEqual([...FEEDBACK_GUARD_ROLES.FACULTY_ANALYTICS], [ROLES.FACULTY]);
  });

  it("HOD_ANALYTICS admits DEPARTMENT_HOD alone", () => {
    assert.deepEqual([...FEEDBACK_GUARD_ROLES.HOD_ANALYTICS], [ROLES.DEPARTMENT_HOD]);
  });

  it("ADMIN_REPORT admits UNIVERSITY_ADMIN alone", () => {
    assert.deepEqual([...FEEDBACK_GUARD_ROLES.ADMIN_REPORT], [ROLES.UNIVERSITY_ADMIN]);
  });

  it("no authority admits more than one role — none was widened", () => {
    for (const [name, roles] of Object.entries(FEEDBACK_GUARD_ROLES)) {
      assert.equal(roles.length, 1, `${name} admits more than one role`);
    }
  });

  it("NO authority admits STUDENT except SUBMIT", () => {
    for (const [name, roles] of Object.entries(FEEDBACK_GUARD_ROLES)) {
      if (name === "SUBMIT") {
        continue;
      }

      assert.equal(
        new Set<string>(roles).has(ROLES.STUDENT),
        false,
        `${name} admits a student`
      );
    }
  });
});

describe("requireFeedbackSubmit", () => {
  it("admits a student and carries their own user id", async () => {
    const guard = await requireFeedbackSubmit(deps({ held: [ROLES.STUDENT] }).injected);

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.deepEqual(guard.context.access, { scope: "STUDENT", userId: USER_ID });
    }
  });

  it("REFUSES an administrator", async () => {
    const guard = await requireFeedbackSubmit(
      deps({ held: [ROLES.UNIVERSITY_ADMIN] }).injected
    );

    assert.equal(guard.granted, false);
  });

  it("REFUSES a faculty member", async () => {
    const guard = await requireFeedbackSubmit(deps({ held: [ROLES.FACULTY] }).injected);

    assert.equal(guard.granted, false);
  });

  it("does NOT resolve a faculty id — a student has none", async () => {
    const { injected, order } = deps({ held: [ROLES.STUDENT] });

    await requireFeedbackSubmit(injected);

    assert.equal(order.includes("resolveFacultyId"), false);
  });
});

describe("requireFacultyAnalytics", () => {
  it("resolves the caller's OWN faculty id from the session", async () => {
    const guard = await requireFacultyAnalytics(deps({ held: [ROLES.FACULTY] }).injected);

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.deepEqual(guard.context.access, { scope: "FACULTY", facultyId: FACULTY_ID });
    }
  });

  it("carries a NULL faculty id for a caller who is not a faculty member", async () => {
    // The domain engine refuses them; the guard does not pretend they are
    // someone.
    const guard = await requireFacultyAnalytics(
      deps({ held: [ROLES.FACULTY], facultyId: null }).injected
    );

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.deepEqual(guard.context.access, { scope: "FACULTY", facultyId: null });
    }
  });

  it("resolves the id AFTER the tenant, never before", async () => {
    // A resolution scoped to an unresolved tenant would be a cross-tenant read.
    const { injected, order } = deps({ held: [ROLES.FACULTY] });

    await requireFacultyAnalytics(injected);

    assert.ok(order.indexOf("requireTenant") < order.indexOf("resolveFacultyId"));
  });

  it("REFUSES a student", async () => {
    const guard = await requireFacultyAnalytics(deps({ held: [ROLES.STUDENT] }).injected);

    assert.equal(guard.granted, false);
  });
});

describe("requireHodAnalytics and requireAdminReport", () => {
  it("a head carries no faculty id — they are not confined to a record", async () => {
    const { injected, order } = deps({ held: [ROLES.DEPARTMENT_HOD] });
    const guard = await requireHodAnalytics(injected);

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.deepEqual(guard.context.access, { scope: "HOD" });
    }
    assert.equal(order.includes("resolveFacultyId"), false);
  });

  it("an admin carries no faculty id either", async () => {
    const guard = await requireAdminReport(deps({ held: [ROLES.UNIVERSITY_ADMIN] }).injected);

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.deepEqual(guard.context.access, { scope: "ADMIN" });
    }
  });

  it("each refuses the other's role", async () => {
    assert.equal(
      (await requireHodAnalytics(deps({ held: [ROLES.UNIVERSITY_ADMIN] }).injected)).granted,
      false
    );
    assert.equal(
      (await requireAdminReport(deps({ held: [ROLES.DEPARTMENT_HOD] }).injected)).granted,
      false
    );
  });
});

// --- Composition and precedence ---------------------------------------------

describe("requireFacultyFeedbackRead — precedence runs WIDEST first", () => {
  it("reports an administrator as ADMIN", async () => {
    const guard = await requireFacultyFeedbackRead(
      deps({ held: [ROLES.UNIVERSITY_ADMIN] }).injected
    );

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.equal(guard.context.access.scope, "ADMIN");
    }
  });

  it("reports a head as HOD", async () => {
    const guard = await requireFacultyFeedbackRead(
      deps({ held: [ROLES.DEPARTMENT_HOD] }).injected
    );

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.equal(guard.context.access.scope, "HOD");
    }
  });

  it("reports a faculty member as FACULTY, with their id", async () => {
    const guard = await requireFacultyFeedbackRead(deps({ held: [ROLES.FACULTY] }).injected);

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.deepEqual(guard.context.access, { scope: "FACULTY", facultyId: FACULTY_ID });
    }
  });

  it("treats an ADMIN who is ALSO a faculty member as an admin", async () => {
    // Confining an administrator to their own record would be the wrong reading
    // of a role they hold deliberately.
    const guard = await requireFacultyFeedbackRead(
      deps({ held: [ROLES.UNIVERSITY_ADMIN, ROLES.FACULTY] }).injected
    );

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.equal(guard.context.access.scope, "ADMIN");
    }
  });

  it("tries the ADMIN authority first", async () => {
    const { injected, asked } = deps({ held: [ROLES.UNIVERSITY_ADMIN] });

    await requireFacultyFeedbackRead(injected);

    assert.deepEqual(asked[0], [ROLES.UNIVERSITY_ADMIN]);
  });

  it("REFUSES a student", async () => {
    const guard = await requireFacultyFeedbackRead(deps({ held: [ROLES.STUDENT] }).injected);

    assert.equal(guard.granted, false);
  });

  it("never widens a primitive — each still names exactly one role", async () => {
    const { injected, asked } = deps({ held: ["PARENT"] });

    await requireFacultyFeedbackRead(injected);

    for (const roles of asked) {
      assert.equal(roles.length, 1, `a composed call widened to ${roles.join(", ")}`);
    }
  });
});

describe("requireFeedbackReport — the two absences are the point", () => {
  it("admits an administrator", async () => {
    const guard = await requireFeedbackReport(deps({ held: [ROLES.UNIVERSITY_ADMIN] }).injected);

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.equal(guard.context.access.scope, "ADMIN");
    }
  });

  it("admits a department head", async () => {
    const guard = await requireFeedbackReport(deps({ held: [ROLES.DEPARTMENT_HOD] }).injected);

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.equal(guard.context.access.scope, "HOD");
    }
  });

  it("REFUSES a FACULTY member", async () => {
    // A cross-faculty report is a comparison between colleagues.
    const guard = await requireFeedbackReport(deps({ held: [ROLES.FACULTY] }).injected);

    assert.equal(guard.granted, false);
  });

  it("REFUSES a STUDENT", async () => {
    const guard = await requireFeedbackReport(deps({ held: [ROLES.STUDENT] }).injected);

    assert.equal(guard.granted, false);
  });

  it("never even ASKS for the faculty or student role", async () => {
    // Neither is refused afterwards — neither appears in either composed guard,
    // so neither ever reaches the controller.
    const { injected, asked } = deps({ held: ["PARENT"] });

    await requireFeedbackReport(injected);

    const everyRoleAsked = asked.flat();

    assert.equal(everyRoleAsked.includes(ROLES.FACULTY), false);
    assert.equal(everyRoleAsked.includes(ROLES.STUDENT), false);
  });
});

// --- Shared behaviour -------------------------------------------------------

describe("requireFeedbackAccess — shared behaviour", () => {
  const guards = [
    ["submit", requireFeedbackSubmit, ROLES.STUDENT],
    ["facultyAnalytics", requireFacultyAnalytics, ROLES.FACULTY],
    ["hodAnalytics", requireHodAnalytics, ROLES.DEPARTMENT_HOD],
    ["adminReport", requireAdminReport, ROLES.UNIVERSITY_ADMIN],
  ] as const;

  it("checks the ROLE before the TENANT, on every authority", async () => {
    for (const [name, guard, role] of guards) {
      const { injected, order } = deps({ held: [role] });

      await guard(injected);

      assert.equal(order[0], "requireRole", `${name} resolved a tenant first`);
    }
  });

  it("does NOT resolve a tenant for a caller the role gate refused", async () => {
    // Reversing them would leak a tenant's existence to someone not permitted
    // to reach the module.
    for (const [name, guard] of guards) {
      const { injected, order } = deps({ held: ["PARENT"] });

      await guard(injected);

      assert.equal(order.includes("requireTenant"), false, `${name} looked up a tenant`);
    }
  });

  it("returns the failing guard's own response VERBATIM", async () => {
    const response = sentinel(401);

    for (const [name, guard] of guards) {
      const { injected } = deps({ held: ["PARENT"], roleResponse: response });
      const result = await guard(injected);

      assert.equal(result.granted, false);
      if (!result.granted) {
        assert.equal(result.response, response, `${name} rebuilt the refusal`);
      }
    }
  });

  it("refuses when the tenant cannot be resolved", async () => {
    for (const [name, guard, role] of guards) {
      const { injected } = deps({ held: [role], tenantResolved: false });

      assert.equal((await guard(injected)).granted, false, name);
    }
  });

  it("takes userId from the authenticated subject, never from a request", async () => {
    for (const [name, guard, role] of guards) {
      const result = await guard(deps({ held: [role] }).injected);

      assert.equal(result.granted, true, name);
      if (result.granted) {
        assert.equal(result.context.userId, USER_ID);
      }
    }
  });

  it("returns NO studentId on any authority", async () => {
    for (const [name, guard, role] of guards) {
      const result = await guard(deps({ held: [role] }).injected);

      assert.equal(result.granted, true, name);
      if (result.granted) {
        assert.deepEqual(
          Object.keys(result.context).sort(),
          ["access", "tenantId", "userId"],
          name
        );
        assert.equal("studentId" in result.context.access, false, name);
      }
    }
  });

  it("never exposes a context on a refusal", async () => {
    for (const [name, guard] of guards) {
      const result = await guard(deps({ held: ["PARENT"] }).injected);

      assert.equal("context" in result, false, name);
    }
  });

  it("is callable with no arguments, so a route wires nothing", () => {
    for (const [name, guard] of guards) {
      assert.equal(guard.length, 0, `${name} requires an argument`);
    }

    assert.equal(requireFacultyFeedbackRead.length, 0);
    assert.equal(requireFeedbackReport.length, 0);
  });
});
