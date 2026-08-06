// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : Controller — Unit Tests
// PURPOSE: Prove the controller is delegation and nothing else.
//
// WHAT THESE TESTS CAN AND CANNOT COVER, STATED PLAINLY
//   OpenElectiveController wires the real service to real repositories at
//   module load, so its methods cannot be driven end-to-end without a database.
//   What CAN be verified without one is the property that matters at this
//   layer: that it holds no logic. Each method's SOURCE is inspected to prove
//   it forwards its arguments and does nothing else — no seat arithmetic, no
//   eligibility check, no branching, no Prisma.
//
//   That is a stronger check than it looks. Allocation is the one place in this
//   codebase where a stray comparison would be plausible AND wrong, so a
//   controller that grew one must fail a test rather than a review.
//
//   The behaviour behind it is covered exhaustively by the service and domain
//   suites, which drive the identical code paths through injected fakes.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  OpenElectiveController,
  openElectiveController,
} from "@/lib/controllers/openElective.controller";

/** The source of one method, whitespace-normalised for inspection. */
function sourceOf(method: string): string {
  const fn = (OpenElectiveController.prototype as unknown as Record<string, () => void>)[
    method
  ];

  return fn.toString().replace(/\s+/g, " ");
}

const METHODS = [
  "listOfferings",
  "submitPreferences",
  "getStatus",
  "allocate",
  "lock",
] as const;

describe("OpenElectiveController — surface", () => {
  it("exposes exactly the five endpoints Phase 19 declares", () => {
    for (const method of METHODS) {
      assert.equal(
        typeof (openElectiveController as unknown as Record<string, unknown>)[method],
        "function",
        method
      );
    }
  });

  it("exposes nothing beyond them", () => {
    const own = Object.getOwnPropertyNames(OpenElectiveController.prototype).filter(
      (name) => name !== "constructor"
    );

    assert.deepEqual(own.sort(), [...METHODS].sort());
  });

  it("is exported as a single shared instance", () => {
    assert.ok(openElectiveController instanceof OpenElectiveController);
  });
});

describe("OpenElectiveController — delegation only", () => {
  it("every method body is a single return statement", () => {
    for (const method of METHODS) {
      assert.ok(
        /\{\s*return openElectiveService\./.test(sourceOf(method)),
        `${method} does something other than return the service call`
      );
    }
  });

  it("contains NO arithmetic — seat counting belongs to the domain engine", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const operator of ["+", "-", "*", "/", "Math."]) {
        assert.equal(body.includes(operator), false, `${method} contains ${operator}`);
      }
    }
  });

  it("contains NO comparison — a seat check here would be a second opinion", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const operator of ["<", ">", "===", "!=="]) {
        assert.equal(body.includes(operator), false, `${method} compares with ${operator}`);
      }
    }
  });

  it("contains NO branching", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const keyword of ["if (", "switch", "? ", "&&", "||", "??"]) {
        assert.equal(body.includes(keyword), false, `${method} branches on ${keyword}`);
      }
    }
  });

  it("contains NO iteration — ordering belongs to preferenceResolver", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const keyword of [".map(", ".filter(", ".sort(", "for (", ".reduce("]) {
        assert.equal(body.includes(keyword), false, `${method} iterates with ${keyword}`);
      }
    }
  });

  it("never mentions eligibility, seats or allocation strategy", () => {
    // Each is a domain concept. A controller naming one is a controller that
    // started reasoning about it.
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const term of ["eligib", "seat", "strategy", "cgpa", "rank"]) {
        assert.equal(
          body.toLowerCase().includes(term),
          false,
          `${method} mentions ${term}`
        );
      }
    }
  });

  it("never touches Prisma", () => {
    for (const method of METHODS) {
      assert.equal(sourceOf(method).includes("prisma"), false, method);
    }
  });

  it("never validates — that happened before the controller was reached", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const keyword of ["safeParse", "Schema"]) {
        assert.equal(body.includes(keyword), false, `${method} validates with ${keyword}`);
      }
    }
  });

  it("never builds a response envelope", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const keyword of ["NextResponse", "success:", "ok(", "fail("]) {
        assert.equal(body.includes(keyword), false, `${method} shapes a response`);
      }
    }
  });

  it("never resolves the tenant or the caller itself", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const keyword of ["requireTenant", "requireRole", "requireAuth"]) {
        assert.equal(body.includes(keyword), false, `${method} calls ${keyword}`);
      }
    }
  });
});

describe("OpenElectiveController — argument forwarding", () => {
  it("forwards tenantId first on every method", () => {
    for (const method of METHODS) {
      assert.ok(
        /\(\s*tenantId/.test(sourceOf(method)),
        `${method} does not forward tenantId first`
      );
    }
  });

  it("forwards the caller's userId on the two student methods", () => {
    for (const method of ["submitPreferences", "getStatus"]) {
      assert.ok(sourceOf(method).includes("userId"), `${method} does not forward userId`);
    }
  });

  it("forwards an ACCESS authority on the catalogue, not a raw user id", () => {
    // The catalogue is dual-mode: staff see the plain list, a student sees it
    // annotated. The route decides which, and passes the authority through.
    assert.ok(sourceOf("listOfferings").includes("access"));
  });

  it("accepts `now` rather than reading the clock", () => {
    // A preference's submittedAt is the FCFS tie-breaker and an allocation
    // stamps one instant on every verdict. Reading the clock here would let two
    // verdicts from one run disagree about when it happened.
    for (const method of ["submitPreferences", "allocate", "lock"]) {
      const body = sourceOf(method);

      assert.ok(body.includes("now"), `${method} does not forward now`);
      assert.equal(body.includes("new Date()"), false, `${method} reads the clock`);
      assert.equal(body.includes("Date.now"), false, `${method} reads the clock`);
    }
  });

  it("does not pass `now` to getStatus, which decides nothing time-sensitive", () => {
    assert.equal(sourceOf("getStatus").includes("now"), false);
  });

  it("NEVER accepts a studentId on a student-facing method", () => {
    // A student is resolved from their session. The absence is the guarantee:
    // there is no parameter to receive an impersonated id.
    for (const method of ["submitPreferences", "getStatus"]) {
      assert.equal(
        sourceOf(method).includes("studentId"),
        false,
        `${method} mentions studentId`
      );
    }
  });

  it("names an OFFERING on the staff methods, never a student", () => {
    // The dual-mode asymmetry: staff act on an offering, students on
    // themselves. Neither can reach the other's subject.
    for (const method of ["allocate", "lock"]) {
      const body = sourceOf(method);

      assert.ok(body.includes("input"), `${method} does not forward its input`);
      assert.equal(body.includes("studentId"), false, `${method} names a student`);
    }
  });
});
