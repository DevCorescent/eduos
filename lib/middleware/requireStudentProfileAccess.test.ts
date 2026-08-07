// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Profile Portal
// LAYER  : Middleware — Unit Tests
// PURPOSE: Exercise every branch of the profile route guard.
//
//          The two collaborators are injected, so all of this runs with no
//          Next.js request context, no cookies, no session and no database.
//          What is verified is the ORDER of the checks and the SHAPE of what
//          comes back — and in a self-service module both are security
//          properties:
//
//            • role is checked BEFORE tenant, so a caller who may not reach the
//              module never learns whether a tenant resolved
//            • the failing guard's own response is returned VERBATIM, so status
//              codes and the error envelope stay consistent project-wide
//            • userId comes from session.sub and from nowhere else
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NextResponse } from "next/server";
import { STUDENT_PROFILE_ROLES } from "@/lib/constants/studentProfile";
import {
  requireStudentProfileAccess,
  type StudentProfileAccessDeps,
} from "@/lib/middleware/requireStudentProfileAccess";

const TENANT_ID = "tenant_1";
const USER_ID = "user_1";

/** A response object distinguishable by identity, so "verbatim" is provable. */
function sentinel(status: number): NextResponse {
  return NextResponse.json({ success: false, error: `sentinel-${status}` }, { status });
}

interface Behaviour {
  roleAuthorized?: boolean;
  tenantResolved?: boolean;
  roleResponse?: NextResponse;
  tenantResponse?: NextResponse;
  sub?: string;
  tenantId?: string;
}

function deps(behaviour: Behaviour = {}) {
  const order: string[] = [];
  const rolesAskedFor: string[][] = [];

  const injected = {
    async requireRole(...roles: string[]) {
      order.push("requireRole");
      rolesAskedFor.push(roles);

      if (behaviour.roleAuthorized === false) {
        return { authorized: false, response: behaviour.roleResponse ?? sentinel(403) };
      }

      return {
        authorized: true,
        session: { sub: behaviour.sub ?? USER_ID },
      };
    },
    async requireTenant() {
      order.push("requireTenant");

      if (behaviour.tenantResolved === false) {
        return { resolved: false, response: behaviour.tenantResponse ?? sentinel(404) };
      }

      return {
        resolved: true,
        session: { sub: behaviour.sub ?? USER_ID },
        tenant: { id: behaviour.tenantId ?? TENANT_ID },
      };
    },
  } as unknown as StudentProfileAccessDeps;

  return { injected, order, rolesAskedFor };
}

describe("requireStudentProfileAccess — the happy path", () => {
  it("grants access carrying the tenant and the authenticated subject", async () => {
    const { injected } = deps();
    const guard = await requireStudentProfileAccess(injected);

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.equal(guard.access.tenantId, TENANT_ID);
      assert.equal(guard.access.userId, USER_ID);
    }
  });

  it("takes userId from session.sub and from nowhere else", async () => {
    // The authenticated subject is not something a client can influence.
    const { injected } = deps({ sub: "user_from_token" });
    const guard = await requireStudentProfileAccess(injected);

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.equal(guard.access.userId, "user_from_token");
    }
  });

  it("takes tenantId from the resolved tenant, not from the request", async () => {
    const { injected } = deps({ tenantId: "tenant_resolved" });
    const guard = await requireStudentProfileAccess(injected);

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.equal(guard.access.tenantId, "tenant_resolved");
    }
  });

  it("returns NO studentId, because resolving one needs a repository", async () => {
    // The route layer decides WHO is asking; the service decides WHOSE record
    // exists. A studentId here would be the route doing the service's job.
    const { injected } = deps();
    const guard = await requireStudentProfileAccess(injected);

    assert.equal(guard.granted, true);
    if (guard.granted) {
      assert.deepEqual(Object.keys(guard.access).sort(), ["tenantId", "userId"]);
    }
  });
});

describe("requireStudentProfileAccess — order of checks", () => {
  it("checks the ROLE before the TENANT", async () => {
    const { injected, order } = deps();

    await requireStudentProfileAccess(injected);

    assert.deepEqual(order, ["requireRole", "requireTenant"]);
  });

  it("does NOT perform a tenant lookup for a caller the role gate refused", async () => {
    // Reversing the order would leak the existence of a tenant to someone not
    // permitted to reach the module at all.
    const { injected, order } = deps({ roleAuthorized: false });

    await requireStudentProfileAccess(injected);

    assert.deepEqual(order, ["requireRole"]);
    assert.equal(order.includes("requireTenant"), false);
  });

  it("asks for exactly the roles the module declares", async () => {
    const { injected, rolesAskedFor } = deps();

    await requireStudentProfileAccess(injected);

    assert.deepEqual(rolesAskedFor[0], [...STUDENT_PROFILE_ROLES]);
  });

  it("names STUDENT and UNIVERSITY_ADMIN, and nothing wider", async () => {
    assert.deepEqual([...STUDENT_PROFILE_ROLES], ["STUDENT", "UNIVERSITY_ADMIN"]);
  });
});

describe("requireStudentProfileAccess — refusal", () => {
  it("returns the role guard's own response VERBATIM", async () => {
    // Returned by identity, not rebuilt — which is what keeps status codes and
    // the error envelope consistent across the project.
    const response = sentinel(403);
    const { injected } = deps({ roleAuthorized: false, roleResponse: response });

    const guard = await requireStudentProfileAccess(injected);

    assert.equal(guard.granted, false);
    if (!guard.granted) {
      assert.equal(guard.response, response, "the response was rebuilt rather than forwarded");
    }
  });

  it("forwards a 401 from the role gate unchanged", async () => {
    // An unauthenticated caller receives requireAuth's 401 through requireRole,
    // not a 403 and not a tenant-shaped error.
    const response = sentinel(401);
    const { injected } = deps({ roleAuthorized: false, roleResponse: response });

    const guard = await requireStudentProfileAccess(injected);

    assert.equal(guard.granted, false);
    if (!guard.granted) {
      assert.equal(guard.response.status, 401);
    }
  });

  it("returns the tenant guard's own response verbatim", async () => {
    const response = sentinel(404);
    const { injected } = deps({ tenantResolved: false, tenantResponse: response });

    const guard = await requireStudentProfileAccess(injected);

    assert.equal(guard.granted, false);
    if (!guard.granted) {
      assert.equal(guard.response, response);
    }
  });

  it("refuses when the tenant cannot be resolved even for a permitted role", async () => {
    const { injected, order } = deps({ tenantResolved: false });

    const guard = await requireStudentProfileAccess(injected);

    assert.equal(guard.granted, false);
    assert.deepEqual(order, ["requireRole", "requireTenant"], "both gates ran");
  });

  it("never exposes an access object on a refusal", async () => {
    for (const behaviour of [{ roleAuthorized: false }, { tenantResolved: false }]) {
      const { injected } = deps(behaviour);
      const guard = await requireStudentProfileAccess(injected);

      assert.equal(guard.granted, false);
      assert.equal("access" in guard, false, JSON.stringify(behaviour));
    }
  });
});

describe("requireStudentProfileAccess — defaults", () => {
  it("is callable with no arguments, so a route need not wire anything", async () => {
    // The injection exists for testability; a route calls it bare, exactly as
    // the three profile routes do.
    assert.equal(requireStudentProfileAccess.length, 0, "deps must be optional");
  });
});
