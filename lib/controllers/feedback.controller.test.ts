// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Feedback System
// LAYER  : Controller — Unit Tests
// PURPOSE: Prove the controller is delegation and nothing else.
//
// WHAT THESE TESTS COVER, AND WHAT THEY CANNOT
//   FeedbackController wires the real service to real repositories at module
//   load, so its methods cannot be driven end-to-end without a database. What
//   CAN be verified is the property that matters here: that it holds no logic.
//   Each method's SOURCE is inspected to prove it forwards its arguments and
//   does nothing else.
//
//   In a module whose core requirement is non-disclosure, one check earns its
//   place above the rest: no method may mention a threshold, a count, or a
//   student identity. A controller that started comparing a count to five would
//   be a second copy of the disclosure rule — and the day one moved, a faculty
//   member would see three responses' worth of scores.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FeedbackController, feedbackController } from "@/lib/controllers/feedback.controller";

/** The source of one method, whitespace-normalised for inspection. */
function sourceOf(method: string): string {
  const fn = (FeedbackController.prototype as unknown as Record<string, () => void>)[method];

  return fn.toString().replace(/\s+/g, " ");
}

const METHODS = ["submitFeedback", "getFacultyFeedback", "getReport"] as const;

describe("FeedbackController — surface", () => {
  it("exposes exactly the three operations the four endpoints need", () => {
    // Four routes, three methods: /faculty and /lab share one, because they
    // differ only in which FORM they name.
    for (const method of METHODS) {
      assert.equal(
        typeof (feedbackController as unknown as Record<string, unknown>)[method],
        "function",
        method
      );
    }
  });

  it("exposes nothing beyond them", () => {
    const own = Object.getOwnPropertyNames(FeedbackController.prototype).filter(
      (name) => name !== "constructor"
    );

    assert.deepEqual(own.sort(), [...METHODS].sort());
  });

  it("is exported as a single shared instance", () => {
    assert.ok(feedbackController instanceof FeedbackController);
  });
});

describe("FeedbackController — delegation only", () => {
  it("every method body is a single return statement", () => {
    for (const method of METHODS) {
      assert.ok(
        /\{\s*return feedbackService\./.test(sourceOf(method)),
        `${method} does something other than return the service call`
      );
    }
  });

  it("NEVER mentions a threshold, a count or an identity", () => {
    // The disclosure rule lives in anonymity.ts and nowhere else. A controller
    // comparing a count to five would be a second copy of it.
    for (const method of METHODS) {
      const body = sourceOf(method).toLowerCase();

      for (const term of ["threshold", "count", "studentid", "anonym", "mask", "withhold"]) {
        assert.equal(body.includes(term), false, `${method} mentions ${term}`);
      }
    }
  });

  it("contains NO arithmetic — averages belong to the domain engine", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const operator of ["+", "-", "*", "/", "Math."]) {
        assert.equal(body.includes(operator), false, `${method} contains ${operator}`);
      }
    }
  });

  it("contains NO comparison", () => {
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

  it("contains NO iteration — grouping belongs to the domain engine", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const keyword of [".map(", ".filter(", ".sort(", "for (", ".reduce("]) {
        assert.equal(body.includes(keyword), false, `${method} iterates with ${keyword}`);
      }
    }
  });

  it("never touches Prisma", () => {
    for (const method of METHODS) {
      assert.equal(sourceOf(method).includes("prisma"), false, method);
    }
  });

  it("never validates or shapes a response", () => {
    for (const method of METHODS) {
      const body = sourceOf(method);

      for (const keyword of ["safeParse", "Schema", "NextResponse", "ok(", "fail("]) {
        assert.equal(body.includes(keyword), false, `${method} does ${keyword}`);
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

describe("FeedbackController — argument forwarding", () => {
  it("forwards tenantId first on every method", () => {
    for (const method of METHODS) {
      assert.ok(/\(\s*tenantId/.test(sourceOf(method)), `${method} does not forward tenantId`);
    }
  });

  it("forwards the caller's userId on the write path only", () => {
    // A student submits about themselves; a reader names a faculty member.
    assert.ok(sourceOf("submitFeedback").includes("userId"));
    assert.equal(sourceOf("getReport").includes("userId"), false);
  });

  it("forwards an ACCESS authority on both read paths", () => {
    // Which projection a caller receives is decided by their role, applied in
    // the service. The controller carries the authority and reads nothing from
    // the request about it.
    for (const method of ["getFacultyFeedback", "getReport"]) {
      assert.ok(sourceOf(method).includes("access"), `${method} does not forward access`);
    }
  });

  it("accepts `now` rather than reading the clock", () => {
    // A submission's submittedAt is stamped once per request; reading the clock
    // here would let the row and the response disagree.
    const body = sourceOf("submitFeedback");

    assert.ok(body.includes("now"));
    assert.equal(body.includes("new Date()"), false);
    assert.equal(body.includes("Date.now"), false);
  });

  it("does not pass `now` to a read path", () => {
    for (const method of ["getFacultyFeedback", "getReport"]) {
      assert.equal(sourceOf(method).includes("now"), false, method);
    }
  });

  it("NEVER accepts a studentId on any method", () => {
    // A student is resolved from their session. The absence is the guarantee:
    // there is no parameter to receive an impersonated id.
    for (const method of METHODS) {
      assert.equal(sourceOf(method).includes("studentId"), false, method);
    }
  });
});
