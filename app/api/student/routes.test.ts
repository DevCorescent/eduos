// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Profile Portal
// LAYER  : Route — Unit Tests
// PURPOSE: Verify the three profile routes' contract and their failure
//          behaviour.
//
// WHAT THESE TESTS COVER, AND WHAT THEY CANNOT, STATED PLAINLY
//   A Next.js route handler reads its session through `next/headers`, which
//   throws outside a request scope. So these tests CANNOT drive a signed-in
//   caller through to a 200, and they do not pretend to — that path is covered
//   by the service and middleware suites, which exercise the identical code
//   through injected fakes.
//
//   What they CAN do is invoke each handler for real and verify the properties
//   that only exist at this layer:
//
//     • the module exposes GET and nothing else — no write surface
//     • the guard runs BEFORE validation, so an unauthenticated caller cannot
//       use validation errors to probe the API
//     • a thrown internal error becomes the project's envelope and NEVER leaks
//       its message, its stack or its cause
//     • no route accepts a studentId in any form
//
//   The 401 path specifically is unreachable here: outside a request scope the
//   session read throws before it can return, so handleRouteError converts it
//   to 500. That is an artefact of the test environment rather than of the
//   route, and saying so is more useful than asserting a status these tests
//   cannot legitimately produce.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import * as profileRoute from "@/app/api/student/profile/route";
import * as dashboardRoute from "@/app/api/student/dashboard/route";
import * as achievementsRoute from "@/app/api/student/achievements/route";

const ROUTES = [
  { name: "profile", module: profileRoute, path: "app/api/student/profile/route.ts" },
  { name: "dashboard", module: dashboardRoute, path: "app/api/student/dashboard/route.ts" },
  {
    name: "achievements",
    module: achievementsRoute,
    path: "app/api/student/achievements/route.ts",
  },
] as const;

/** The route file's source, for the structural assertions. */
function sourceOf(path: string): string {
  return readFileSync(path, "utf8");
}

/** Everything after the documentation header — the code, not the comments. */
function codeOf(path: string): string {
  return sourceOf(path)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

function request(name: string, query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/student/${name}${query}`);
}

// --- Surface ----------------------------------------------------------------

describe("student profile routes — HTTP surface", () => {
  it("every route exports GET", () => {
    for (const route of ROUTES) {
      assert.equal(typeof route.module.GET, "function", route.name);
    }
  });

  it("NO route exports a write verb", () => {
    // Phase 18 is a read module. A POST reaching this path would be a mutation
    // with no specification, no validation schema and no audit entry behind it.
    for (const route of ROUTES) {
      const exported = Object.keys(route.module);

      for (const verb of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
        assert.equal(exported.includes(verb), false, `${route.name} exports ${verb}`);
      }
    }
  });

  it("exports GET and nothing else at all", () => {
    for (const route of ROUTES) {
      assert.deepEqual(Object.keys(route.module), ["GET"], route.name);
    }
  });
});

// --- Failure behaviour, invoked for real ------------------------------------

describe("student profile routes — failure is contained and never leaks", () => {
  it("returns the project's response envelope rather than throwing", async () => {
    for (const route of ROUTES) {
      const response = await route.module.GET(request(route.name));
      const body = await response.json();

      assert.equal(body.success, false, route.name);
      assert.equal(typeof body.code, "string", route.name);
    }
  });

  it("NEVER leaks the internal error message, stack or cause", async () => {
    // The session read throws "`headers` was called outside a request scope".
    // A route that surfaced that would be handing an attacker the framework,
    // the file path and the call stack.
    for (const route of ROUTES) {
      const response = await route.module.GET(request(route.name));
      const raw = JSON.stringify(await response.json());

      for (const leak of ["headers", "request scope", "at ", ".ts:", "node_modules", "stack"]) {
        assert.equal(
          raw.includes(leak),
          false,
          `${route.name} leaked "${leak}" in ${raw}`
        );
      }
    }
  });

  it("returns a 4xx or 5xx, never a 200, for a caller it could not authorise", async () => {
    for (const route of ROUTES) {
      const response = await route.module.GET(request(route.name));

      assert.ok(response.status >= 400, `${route.name} returned ${response.status}`);
    }
  });

  it("fails at the GUARD, not at validation, even for a malformed query", async () => {
    // The security property: an unauthenticated caller cannot use validation
    // error messages to probe the API. A 400 here would mean the query was
    // parsed before the caller was authorised.
    const malformed = [
      { name: "dashboard", query: "?notifications=99999" },
      { name: "achievements", query: "?category=NOT_A_CATEGORY" },
      { name: "profile", query: "?studentId=victim" },
    ];

    for (const probe of malformed) {
      const route = ROUTES.find((entry) => entry.name === probe.name);
      assert.ok(route);

      const response = await route.module.GET(request(probe.name, probe.query));

      assert.notEqual(
        response.status,
        400,
        `${probe.name} validated the query before authorising the caller`
      );
    }
  });

  it("reaches no database when the caller cannot be authorised", async () => {
    // Proven by the absence of a connection error: the guard short-circuits
    // before the controller, so no repository is ever constructed for the call.
    for (const route of ROUTES) {
      const response = await route.module.GET(request(route.name));
      const body = await response.json();

      assert.equal(body.success, false);
      assert.notEqual(body.code, "P1001", `${route.name} attempted a connection`);
    }
  });
});

// --- Self-service guarantee, structural -------------------------------------

describe("student profile routes — self-service is structural", () => {
  it("no route has a dynamic segment", () => {
    // A [studentId] segment is the single thing that would make impersonation
    // expressible. There is none, and the file paths prove it.
    for (const route of ROUTES) {
      assert.equal(route.path.includes("["), false, route.path);
    }
  });

  it("no route reads a studentId from the request", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      assert.equal(code.includes("studentId"), false, `${route.name} mentions studentId in code`);
      assert.equal(code.includes("params"), false, `${route.name} reads a path param`);
    }
  });

  it("every route takes its identity from the GUARD, never from the request", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      assert.ok(code.includes("guard.access.tenantId"), `${route.name} does not use the guard's tenant`);
      assert.ok(code.includes("guard.access.userId"), `${route.name} does not use the guard's user`);
    }
  });

  it("every route uses the shared profile guard, not its own composition", () => {
    // Three inline copies of the same six lines is how two get updated and one
    // is forgotten.
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      assert.ok(code.includes("requireStudentProfileAccess"), route.name);
      assert.equal(code.includes("requireRole("), false, `${route.name} re-runs the role gate`);
      assert.equal(code.includes("requireTenant("), false, `${route.name} re-runs the tenant gate`);
    }
  });

  it("every route early-returns the guard's own response", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      assert.ok(
        /if \(!guard\.granted\) return guard\.response;/.test(code),
        `${route.name} rebuilds the refusal rather than forwarding it`
      );
    }
  });
});

// --- Wiring -----------------------------------------------------------------

describe("student profile routes — wiring", () => {
  const expected = [
    { name: "profile", schema: "profileQuerySchema", method: "getProfile" },
    { name: "dashboard", schema: "dashboardQuerySchema", method: "getDashboard" },
    { name: "achievements", schema: "achievementQuerySchema", method: "getAchievements" },
  ] as const;

  it("each route validates with its own schema", () => {
    for (const entry of expected) {
      const route = ROUTES.find((candidate) => candidate.name === entry.name);
      assert.ok(route);

      assert.ok(codeOf(route.path).includes(entry.schema), `${entry.name} → ${entry.schema}`);
    }
  });

  it("each route delegates to its own controller method", () => {
    for (const entry of expected) {
      const route = ROUTES.find((candidate) => candidate.name === entry.name);
      assert.ok(route);

      const code = codeOf(route.path);

      assert.ok(code.includes(`studentProfileController.${entry.method}`), entry.name);
    }
  });

  it("every route validates BEFORE delegating", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);
      const validated = code.indexOf("safeParse");
      const delegated = code.indexOf("studentProfileController.");

      assert.ok(validated > -1 && delegated > -1, route.name);
      assert.ok(validated < delegated, `${route.name} delegates before validating`);
    }
  });

  it("every route returns a validation failure through the shared helper", () => {
    for (const route of ROUTES) {
      assert.ok(codeOf(route.path).includes("validationFailure"), route.name);
    }
  });

  it("every route funnels errors through handleRouteError with a named scope", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      assert.ok(code.includes("handleRouteError(SCOPE, err)"), route.name);
      assert.ok(/const SCOPE = "GET \/api\/student\//.test(code), route.name);
    }
  });

  it("every route wraps its payload in the shared ok() envelope", () => {
    for (const route of ROUTES) {
      assert.ok(codeOf(route.path).includes("NextResponse.json(ok("), route.name);
    }
  });

  it("the two time-sensitive routes pass an instant down; achievements does not", () => {
    // Certificate expiry is evaluated against an instant, taken once per
    // request. An achievement has no expiry, so handing it a clock would imply
    // one.
    for (const name of ["profile", "dashboard"]) {
      const route = ROUTES.find((candidate) => candidate.name === name);
      assert.ok(route);
      assert.ok(codeOf(route.path).includes("new Date()"), name);
    }

    const achievements = ROUTES.find((candidate) => candidate.name === "achievements");
    assert.ok(achievements);
    assert.equal(codeOf(achievements.path).includes("new Date()"), false);
  });
});
