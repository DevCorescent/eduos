// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : Middleware — Unit Tests
// PURPOSE: Exercise every branch of the three-mode guard.
//
//          The dual-mode split is the property under test. Phase 19 is the
//          first module in this codebase where a student and an administrator
//          reach the same module with genuinely different authority, and the
//          failure that matters is a student reaching /allocate. These tests
//          assert the role sets DIFFER and that the narrow ones are actually
//          narrow — not merely that each guard returns something.
//
//          Both collaborators are injected, so all of this runs with no request
//          context, no cookies and no database.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NextResponse } from "next/server";
import { ROLES } from "@/constants/roles";
import {
  ELECTIVE_GUARD_ROLES,
  requireElectiveManage,
  requireElectiveRead,
  requireElectiveSelect,
  requireElectiveStatus,
  type OpenElectiveAccessDeps,
} from "@/lib/middleware/requireOpenElectiveAccess";

const TENANT_ID = "tenant_1";
const USER_ID = "user_1";

function sentinel(status: number): NextResponse {
  return NextResponse.json({ success: false, error: `sentinel-${status}` }, { status });
}

interface Behaviour {
  /** Roles the caller actually holds. A guard authorises if any overlaps. */
  held?: readonly string[];
  tenantResolved?: boolean;
  roleResponse?: NextResponse;
  tenantResponse?: NextResponse;
}

function deps(behaviour: Behaviour = {}) {
  const asked: string[][] = [];
  const order: string[] = [];
  const held = new Set(behaviour.held ?? [ROLES.UNIVERSITY_ADMIN]);

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

      return {
        resolved: true,
        session: { sub: USER_ID },
        tenant: { id: TENANT_ID },
      };
    },
  } as unknown as OpenElectiveAccessDeps;

  return { injected, asked, order };
}

// --- The three role sets differ ---------------------------------------------

describe("requireOpenElectiveAccess — the three modes are genuinely different", () => {
  it("READ admits staff AND students", () => {
    assert.deepEqual(
      [...ELECTIVE_GUARD_ROLES.READ],
      [ROLES.UNIVERSITY_ADMIN, ROLES.DEPARTMENT_HOD, ROLES.STUDENT]
    );
  });

  it("SELECT admits STUDENT alone", () => {
    // An administrator choosing on a student's behalf would be
    // indistinguishable in the data from the student choosing.
    assert.deepEqual([...ELECTIVE_GUARD_ROLES.SELECT], [ROLES.STUDENT]);
  });

  it("MANAGE EXCLUDES students", () => {
    // The single most important absence in the module: it is what stops a
    // student allocating seats to themselves.
    const manage = new Set<string>(ELECTIVE_GUARD_ROLES.MANAGE);

    assert.equal(manage.has(ROLES.STUDENT), false);
    assert.deepEqual(
      [...ELECTIVE_GUARD_ROLES.MANAGE],
      [ROLES.UNIVERSITY_ADMIN, ROLES.DEPARTMENT_HOD]
    );
  });

  it("READ is strictly wider than MANAGE", () => {
    const read = new Set<string>(ELECTIVE_GUARD_ROLES.READ);

    for (const role of ELECTIVE_GUARD_ROLES.MANAGE) {
      assert.ok(read.has(role), `${role} may manage but not read`);
    }
  });
});

// --- READ: authority reporting ----------------------------------------------

describe("requireElectiveRead", () => {
  it("reports STAFF for an administrator", () => {
    return requireElectiveRead(deps({ held: [ROLES.UNIVERSITY_ADMIN] }).injected).then(
      (guard) => {
        assert.equal(guard.granted, true);
        if (guard.granted) {
          assert.deepEqual(guard.context.access, { scope: "STAFF" });
        }
      }
    );
  });

  it("reports STAFF for a department head", async () => {
    const guard = await requireElectiveRead(deps({ held: [ROLES.DEPARTMENT_HOD] }).injected);

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.equal(guard.context.access.scope, "STAFF");
    }
  });

  it("reports STUDENT, carrying their own user id", async () => {
    const guard = await requireElectiveRead(deps({ held: [ROLES.STUDENT] }).injected);

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.deepEqual(guard.context.access, { scope: "STUDENT", userId: USER_ID });
    }
  });

  it("tests the ELEVATED set first, so the common path costs one guard call", async () => {
    const { injected, asked } = deps({ held: [ROLES.UNIVERSITY_ADMIN] });

    await requireElectiveRead(injected);

    assert.deepEqual(asked[0], [...ELECTIVE_GUARD_ROLES.MANAGE]);
  });

  it("refuses a caller holding neither", async () => {
    const guard = await requireElectiveRead(deps({ held: ["PARENT"] }).injected);

    assert.equal(guard.granted, false);
  });
});

// --- SELECT and STATUS ------------------------------------------------------

describe("requireElectiveSelect", () => {
  it("admits a student and reports their authority", async () => {
    const guard = await requireElectiveSelect(deps({ held: [ROLES.STUDENT] }).injected);

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.deepEqual(guard.context.access, { scope: "STUDENT", userId: USER_ID });
    }
  });

  it("REFUSES an administrator", async () => {
    const guard = await requireElectiveSelect(
      deps({ held: [ROLES.UNIVERSITY_ADMIN] }).injected
    );

    assert.equal(guard.granted, false);
  });

  it("REFUSES a department head", async () => {
    const guard = await requireElectiveSelect(deps({ held: [ROLES.DEPARTMENT_HOD] }).injected);

    assert.equal(guard.granted, false);
  });

  it("STATUS applies the identical rule", async () => {
    // The endpoint answers "what did I choose", which only the student asks.
    assert.equal(requireElectiveStatus, requireElectiveSelect);

    const guard = await requireElectiveStatus(
      deps({ held: [ROLES.UNIVERSITY_ADMIN] }).injected
    );

    assert.equal(guard.granted, false);
  });
});

// --- MANAGE -----------------------------------------------------------------

describe("requireElectiveManage", () => {
  it("admits an administrator", async () => {
    const guard = await requireElectiveManage(
      deps({ held: [ROLES.UNIVERSITY_ADMIN] }).injected
    );

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.equal(guard.context.access.scope, "STAFF");
    }
  });

  it("admits a department head — the seats are their department's to give", async () => {
    const guard = await requireElectiveManage(deps({ held: [ROLES.DEPARTMENT_HOD] }).injected);

    assert.equal(guard.granted, true);
  });

  it("REFUSES a student", async () => {
    const guard = await requireElectiveManage(deps({ held: [ROLES.STUDENT] }).injected);

    assert.equal(guard.granted, false);
  });

  it("never reports a STUDENT authority, even to a caller who is one", async () => {
    // A student who also somehow held an elevated role must still act as staff
    // here — the endpoint operates on an offering, not on a person.
    const guard = await requireElectiveManage(
      deps({ held: [ROLES.STUDENT, ROLES.UNIVERSITY_ADMIN] }).injected
    );

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.equal(guard.context.access.scope, "STAFF");
    }
  });
});

// --- Shared behaviour -------------------------------------------------------

describe("requireOpenElectiveAccess — shared behaviour", () => {
  const guards = [
    ["read", requireElectiveRead],
    ["select", requireElectiveSelect],
    ["manage", requireElectiveManage],
  ] as const;

  it("checks the ROLE before the TENANT, on every mode", async () => {
    for (const [name, guard] of guards) {
      const { injected, order } = deps({ held: [ROLES.UNIVERSITY_ADMIN, ROLES.STUDENT] });

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
    for (const [name, guard] of guards) {
      const { injected } = deps({
        held: [ROLES.UNIVERSITY_ADMIN, ROLES.STUDENT],
        tenantResolved: false,
      });

      const result = await guard(injected);

      assert.equal(result.granted, false, name);
    }
  });

  it("takes userId from the authenticated subject, never from a request", async () => {
    for (const [name, guard] of guards) {
      const { injected } = deps({ held: [ROLES.UNIVERSITY_ADMIN, ROLES.STUDENT] });
      const result = await guard(injected);

      assert.equal(result.granted, true, name);
      if (result.granted) {
        assert.equal(result.context.userId, USER_ID);
      }
    }
  });

  it("returns NO studentId — resolving one needs a repository", async () => {
    for (const [name, guard] of guards) {
      const { injected } = deps({ held: [ROLES.UNIVERSITY_ADMIN, ROLES.STUDENT] });
      const result = await guard(injected);

      assert.equal(result.granted, true, name);
      if (result.granted) {
        assert.deepEqual(
          Object.keys(result.context).sort(),
          ["access", "tenantId", "userId"],
          name
        );
      }
    }
  });

  it("never exposes a context on a refusal", async () => {
    for (const [name, guard] of guards) {
      const { injected } = deps({ held: ["PARENT"] });
      const result = await guard(injected);

      assert.equal("context" in result, false, name);
    }
  });

  it("is callable with no arguments, so a route wires nothing", () => {
    for (const [name, guard] of guards) {
      assert.equal(guard.length, 0, `${name} requires an argument`);
    }
  });
});
