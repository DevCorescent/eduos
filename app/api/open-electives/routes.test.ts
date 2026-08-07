// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : Route — Unit Tests
// PURPOSE: Verify the five routes' contract and their failure behaviour.
//
// WHAT THESE TESTS COVER, AND WHAT THEY CANNOT, STATED PLAINLY
//   A Next.js route handler reads its session through `next/headers`, which
//   throws outside a request scope. So these tests CANNOT drive a signed-in
//   caller through to a 200, and they do not pretend to — that path is covered
//   by the service, domain and middleware suites, which exercise the identical
//   code through injected fakes.
//
//   What they CAN do is invoke each handler for real and verify what only
//   exists at this layer:
//
//     • each module exposes exactly ONE verb, and it is the right one
//     • the guard runs BEFORE body parsing and validation, so an
//       unauthenticated caller cannot probe the API with malformed input
//     • a thrown internal error becomes the project envelope and never leaks
//     • no student-facing route accepts a studentId
//     • each staff route is wired to the MANAGE guard, not the read one
//
//   The 401 path specifically is unreachable here: outside a request scope the
//   session read throws before it can return, so handleRouteError converts it
//   to 500. That is an artefact of the environment, not of the route, and
//   saying so is more useful than asserting a status these tests cannot
//   legitimately produce.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import * as catalogueRoute from "@/app/api/open-electives/route";
import * as selectRoute from "@/app/api/open-electives/select/route";
import * as statusRoute from "@/app/api/open-electives/status/route";
import * as allocateRoute from "@/app/api/open-electives/allocate/route";
import * as lockRoute from "@/app/api/open-electives/lock/route";

const ROUTES = [
  {
    name: "catalogue",
    module: catalogueRoute as Record<string, unknown>,
    verb: "GET",
    path: "app/api/open-electives/route.ts",
    url: "http://localhost/api/open-electives",
    guard: "requireElectiveRead",
  },
  {
    name: "select",
    module: selectRoute as Record<string, unknown>,
    verb: "POST",
    path: "app/api/open-electives/select/route.ts",
    url: "http://localhost/api/open-electives/select",
    guard: "requireElectiveSelect",
  },
  {
    name: "status",
    module: statusRoute as Record<string, unknown>,
    verb: "GET",
    path: "app/api/open-electives/status/route.ts",
    url: "http://localhost/api/open-electives/status",
    guard: "requireElectiveStatus",
  },
  {
    name: "allocate",
    module: allocateRoute as Record<string, unknown>,
    verb: "POST",
    path: "app/api/open-electives/allocate/route.ts",
    url: "http://localhost/api/open-electives/allocate",
    guard: "requireElectiveManage",
  },
  {
    name: "lock",
    module: lockRoute as Record<string, unknown>,
    verb: "PATCH",
    path: "app/api/open-electives/lock/route.ts",
    url: "http://localhost/api/open-electives/lock",
    guard: "requireElectiveManage",
  },
] as const;

/** The route file's code, with the documentation header stripped. */
function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

/** Invoke a route's handler with an empty body. */
async function invoke(route: (typeof ROUTES)[number]) {
  const handler = route.module[route.verb] as (
    request: NextRequest
  ) => Promise<Response>;

  const request =
    route.verb === "GET"
      ? new NextRequest(route.url)
      : new NextRequest(route.url, { method: route.verb, body: "{}" });

  return handler(request);
}

// --- Surface ----------------------------------------------------------------

describe("open-elective routes — HTTP surface", () => {
  it("each route exports exactly the verb it is specified with", () => {
    for (const route of ROUTES) {
      assert.deepEqual(Object.keys(route.module), [route.verb], route.name);
    }
  });

  it("the read endpoints expose NO write verb", () => {
    for (const route of ROUTES.filter((entry) => entry.verb === "GET")) {
      for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
        assert.equal(verb in route.module, false, `${route.name} exports ${verb}`);
      }
    }
  });

  it("the write endpoints expose no GET", () => {
    // A GET /allocate would be an allocation triggerable by a link preview.
    for (const route of ROUTES.filter((entry) => entry.verb !== "GET")) {
      assert.equal("GET" in route.module, false, `${route.name} exports GET`);
    }
  });

  it("lock is a PATCH, not a POST — it changes one field of an existing row", () => {
    assert.equal("PATCH" in lockRoute, true);
    assert.equal("POST" in lockRoute, false);
  });
});

// --- Failure behaviour, invoked for real ------------------------------------

describe("open-elective routes — failure is contained and never leaks", () => {
  it("returns the project's response envelope rather than throwing", async () => {
    for (const route of ROUTES) {
      const response = await invoke(route);
      const body = await response.json();

      assert.equal(body.success, false, route.name);
      assert.equal(typeof body.code, "string", route.name);
    }
  });

  it("NEVER leaks the internal error message, stack or cause", async () => {
    for (const route of ROUTES) {
      const response = await invoke(route);
      const raw = JSON.stringify(await response.json());

      for (const leak of ["headers", "request scope", "at ", ".ts:", "node_modules"]) {
        assert.equal(raw.includes(leak), false, `${route.name} leaked "${leak}"`);
      }
    }
  });

  it("returns 4xx or 5xx, never 200, for a caller it could not authorise", async () => {
    for (const route of ROUTES) {
      const response = await invoke(route);

      assert.ok(response.status >= 400, `${route.name} returned ${response.status}`);
    }
  });

  it("fails at the GUARD, not at validation, even for malformed input", async () => {
    // The security property: an unauthenticated caller cannot use validation
    // errors to probe the API. A 400 here would mean the request was parsed
    // before the caller was authorised.
    for (const route of ROUTES) {
      const response = await invoke(route);

      assert.notEqual(
        response.status,
        400,
        `${route.name} validated before authorising`
      );
    }
  });

  it("guards BEFORE parsing a body, on every write route", () => {
    // Structural: the guard's early-return must precede request.json().
    for (const route of ROUTES.filter((entry) => entry.verb !== "GET")) {
      const code = codeOf(route.path);
      const guarded = code.indexOf("if (!guard.granted) return guard.response;");
      const parsed = code.indexOf("await request.json()");

      assert.ok(guarded > -1 && parsed > -1, route.name);
      assert.ok(guarded < parsed, `${route.name} parses a body before guarding`);
    }
  });

  it("reaches no database when the caller cannot be authorised", async () => {
    for (const route of ROUTES) {
      const body = await (await invoke(route)).json();

      assert.notEqual(body.code, "P1001", `${route.name} attempted a connection`);
    }
  });
});

// --- Authorisation wiring ---------------------------------------------------

describe("open-elective routes — each is wired to the RIGHT guard", () => {
  it("uses the guard its access rule requires", () => {
    for (const route of ROUTES) {
      assert.ok(
        codeOf(route.path).includes(route.guard),
        `${route.name} does not use ${route.guard}`
      );
    }
  });

  it("the STAFF routes use MANAGE, never the wider read guard", () => {
    // Using requireElectiveRead on /allocate would admit students, because READ
    // includes STUDENT. This is the mistake the dual-mode design exists to
    // prevent, so it is asserted rather than reviewed.
    for (const name of ["allocate", "lock"]) {
      const route = ROUTES.find((entry) => entry.name === name);
      assert.ok(route);

      const code = codeOf(route.path);

      assert.ok(code.includes("requireElectiveManage"), name);
      assert.equal(code.includes("requireElectiveRead"), false, `${name} uses the read guard`);
      assert.equal(code.includes("requireElectiveSelect"), false, name);
    }
  });

  it("the STUDENT routes use the narrow guard, never MANAGE", () => {
    for (const name of ["select", "status"]) {
      const route = ROUTES.find((entry) => entry.name === name);
      assert.ok(route);

      assert.equal(
        codeOf(route.path).includes("requireElectiveManage"),
        false,
        `${name} uses the staff guard`
      );
    }
  });

  it("no route composes its own role check", () => {
    // Three inline copies of the same rule is how two get updated and one is
    // forgotten.
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      assert.equal(code.includes("requireRole("), false, `${route.name} re-runs the role gate`);
      assert.equal(code.includes("requireTenant("), false, `${route.name} re-runs tenant`);
    }
  });

  it("every route early-returns the guard's own response", () => {
    for (const route of ROUTES) {
      assert.ok(
        /if \(!guard\.granted\) return guard\.response;/.test(codeOf(route.path)),
        `${route.name} rebuilds the refusal`
      );
    }
  });
});

// --- Self-service guarantee -------------------------------------------------

describe("open-elective routes — a student is never named by the client", () => {
  it("no route has a dynamic segment", () => {
    for (const route of ROUTES) {
      assert.equal(route.path.includes("["), false, route.path);
    }
  });

  it("no route reads a studentId from the request", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      assert.equal(code.includes("studentId"), false, `${route.name} mentions studentId`);
      assert.equal(code.includes("params"), false, `${route.name} reads a path param`);
    }
  });

  it("the student routes take identity from the GUARD", () => {
    for (const name of ["select", "status"]) {
      const route = ROUTES.find((entry) => entry.name === name);
      assert.ok(route);

      assert.ok(codeOf(route.path).includes("guard.context.userId"), name);
    }
  });

  it("every route takes its tenant from the guard, never from the request", () => {
    for (const route of ROUTES) {
      assert.ok(
        codeOf(route.path).includes("guard.context.tenantId"),
        `${route.name} does not use the guard's tenant`
      );
    }
  });
});

// --- Wiring -----------------------------------------------------------------

describe("open-elective routes — wiring", () => {
  const expected = [
    { name: "catalogue", schema: "listOfferingsQuerySchema", method: "listOfferings" },
    { name: "select", schema: "submitPreferencesSchema", method: "submitPreferences" },
    { name: "status", schema: "electiveStatusQuerySchema", method: "getStatus" },
    { name: "allocate", schema: "allocateSchema", method: "allocate" },
    { name: "lock", schema: "lockSchema", method: "lock" },
  ] as const;

  it("each route validates with its own schema and delegates to its own method", () => {
    for (const entry of expected) {
      const route = ROUTES.find((candidate) => candidate.name === entry.name);
      assert.ok(route);

      const code = codeOf(route.path);

      assert.ok(code.includes(entry.schema), `${entry.name} → ${entry.schema}`);
      assert.ok(
        code.includes(`openElectiveController.${entry.method}`),
        `${entry.name} → ${entry.method}`
      );
    }
  });

  it("every route validates BEFORE delegating", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);
      const validated = code.indexOf("safeParse");
      const delegated = code.indexOf("openElectiveController.");

      assert.ok(validated > -1 && delegated > -1, route.name);
      assert.ok(validated < delegated, `${route.name} delegates before validating`);
    }
  });

  it("every write route handles a malformed body distinctly from an invalid one", () => {
    // Unparseable JSON is not the same failure as a well-formed body that
    // breaks a rule, and collapsing them would tell a client the wrong thing.
    for (const route of ROUTES.filter((entry) => entry.verb !== "GET")) {
      assert.ok(codeOf(route.path).includes("malformedBody()"), route.name);
    }
  });

  it("every route funnels errors through handleRouteError with a named scope", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      assert.ok(code.includes("handleRouteError(SCOPE, err)"), route.name);
      assert.ok(
        new RegExp(`const SCOPE = "${route.verb} /api/open-electives`).test(code),
        `${route.name} has a wrong or missing SCOPE`
      );
    }
  });

  it("every route wraps its payload in the shared ok() envelope", () => {
    for (const route of ROUTES) {
      assert.ok(codeOf(route.path).includes("NextResponse.json(ok("), route.name);
    }
  });

  it("the time-sensitive routes pass an instant down", () => {
    // submittedAt is the FCFS tie-breaker and an allocation stamps one instant
    // on every verdict.
    for (const name of ["select", "allocate", "lock"]) {
      const route = ROUTES.find((entry) => entry.name === name);
      assert.ok(route);

      assert.ok(codeOf(route.path).includes("new Date()"), name);
    }
  });

  it("no route computes anything about seats, eligibility or strategy", () => {
    // Every one of those belongs to the domain engine. A route naming one is a
    // route that started reasoning about it.
    const forbidden = ["seatsremaining", "iseligible", "totalseats", "preferencerank"];

    for (const route of ROUTES) {
      const code = codeOf(route.path).toLowerCase();

      for (const term of forbidden) {
        assert.equal(code.includes(term), false, `${route.name} mentions ${term}`);
      }
    }
  });
});
