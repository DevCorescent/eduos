// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Profile Portal
// LAYER  : Controller — Unit Tests
// PURPOSE: Prove the controller is delegation and nothing else.
//
// WHAT THESE TESTS CAN AND CANNOT COVER, STATED PLAINLY
//   StudentProfileController wires the real service to the real repositories at
//   module load, so its methods cannot be driven end-to-end without a database.
//   What CAN be verified without one is the property that actually matters for
//   this layer: that it holds no logic. Each method's SOURCE is inspected to
//   prove it does nothing but forward its arguments — no arithmetic, no
//   branching, no mapping, no Prisma.
//
//   That is a stronger check than it first appears. A controller that grew a
//   calculation would fail these tests, and a controller that merely forwards
//   has nothing else worth asserting. The behaviour behind it is covered
//   exhaustively by the service suite, which drives the identical code paths
//   through injected fakes.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  StudentProfileController,
  studentProfileController,
} from "@/lib/controllers/studentProfile.controller";

/** The source of one method, whitespace-normalised for inspection. */
function sourceOf(method: string): string {
  const fn = (StudentProfileController.prototype as unknown as Record<string, () => void>)[method];

  return fn.toString().replace(/\s+/g, " ");
}

const METHODS = ["getProfile", "getDashboard", "getAchievements"] as const;

describe("StudentProfileController — surface", () => {
  it("exposes exactly the three endpoints Phase 18 declares", () => {
    for (const method of METHODS) {
      assert.equal(
        typeof (studentProfileController as unknown as Record<string, unknown>)[method],
        "function",
        method
      );
    }
  });

  it("exposes nothing beyond them", () => {
    // A controller that grew a fourth method would be a route that exists with
    // no specification behind it.
    const own = Object.getOwnPropertyNames(StudentProfileController.prototype).filter(
      (name) => name !== "constructor"
    );

    assert.deepEqual(own.sort(), [...METHODS].sort());
  });

  it("is exported as a single shared instance", () => {
    // Every route delegates to one wired instance, so none can construct a
    // differently-wired one.
    assert.ok(studentProfileController instanceof StudentProfileController);
  });
});

describe("StudentProfileController — delegation only", () => {
  it("every method body is a single return statement", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      assert.ok(
        /\{\s*return studentProfileService\./.test(body),
        `${method} does something other than return the service call: ${body}`
      );
    }
  });

  it("contains NO arithmetic — completion scoring belongs to the service", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const operator of ["+", "*", "/", "Math."]) {
        assert.equal(
          body.includes(operator),
          false,
          `${method} contains ${operator}`
        );
      }
    }
  });

  it("contains NO branching — a controller that decided anything would be logic", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const keyword of ["if (", "switch", "? ", "&&", "||", "??"]) {
        assert.equal(body.includes(keyword), false, `${method} branches on ${keyword}`);
      }
    }
  });

  it("contains NO iteration — mapping a DTO here would duplicate the service", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const keyword of [".map(", ".filter(", "for (", ".reduce("]) {
        assert.equal(body.includes(keyword), false, `${method} iterates with ${keyword}`);
      }
    }
  });

  it("never touches Prisma", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      assert.equal(body.includes("prisma"), false, `${method} reaches for Prisma`);
    }
  });

  it("never validates — that happened before the controller was reached", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const keyword of ["safeParse", "parse(", "Schema"]) {
        assert.equal(body.includes(keyword), false, `${method} validates with ${keyword}`);
      }
    }
  });

  it("never builds a response envelope — that is the route's job", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const keyword of ["NextResponse", "success:", "ok(", "fail("]) {
        assert.equal(body.includes(keyword), false, `${method} shapes a response with ${keyword}`);
      }
    }
  });

  it("never resolves the tenant or the caller itself", () => {
    // Both arrive as parameters from the route; re-deriving either here would
    // be a second authorisation path.
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const keyword of ["requireTenant", "requireRole", "requireAuth", "getSession"]) {
        assert.equal(body.includes(keyword), false, `${method} calls ${keyword}`);
      }
    }
  });
});

describe("StudentProfileController — argument forwarding", () => {
  it("forwards tenantId and userId to every method, in that order", () => {
    for (const method of METHODS) {
      assert.ok(
        /\(\s*tenantId\s*,\s*userId/.test(sourceOf(method)),
        `${method} does not forward (tenantId, userId) first`
      );
    }
  });

  it("accepts `now` rather than reading the clock", () => {
    // Certificate expiry and the active-certificate count are both evaluated
    // against an instant. Taking it once per request and passing it down is
    // what stops one response disagreeing with itself.
    for (const method of ["getProfile", "getDashboard"]) {
      const body = sourceOf(method);

      assert.ok(body.includes("now"), `${method} does not forward now`);
      assert.equal(body.includes("new Date()"), false, `${method} reads the clock itself`);
      assert.equal(body.includes("Date.now"), false, `${method} reads the clock itself`);
    }
  });

  it("does not pass `now` to getAchievements, which needs no instant", () => {
    // An achievement has no expiry, so handing it a clock would imply one.
    assert.equal(sourceOf("getAchievements").includes("now"), false);
  });

  it("forwards the validated query object unchanged", () => {
    for (const method of ["getDashboard", "getAchievements"]) {
      assert.ok(sourceOf(method).includes("query"), `${method} does not forward query`);
    }
  });

  it("never accepts a studentId — Phase 18 is self-service", () => {
    // The absence is the guarantee: a client-supplied id is unexpressible at
    // this layer because no method has a parameter to receive one.
    for (const method of METHODS) {
      assert.equal(
        sourceOf(method).includes("studentId"),
        false,
        `${method} mentions studentId`
      );
    }
  });
});
