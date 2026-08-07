// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Feedback System
// LAYER  : Route — Unit Tests
// PURPOSE: Verify the four routes' contract and their failure behaviour.
//
// WHAT THESE TESTS COVER, AND WHAT THEY CANNOT, STATED PLAINLY
//   A Next.js route handler reads its session through `next/headers`, which
//   throws outside a request scope. So these tests CANNOT drive a signed-in
//   caller through to a 200, and they do not pretend to — that path is covered
//   by the domain, service and middleware suites, which exercise the identical
//   code through injected fakes.
//
//   What they CAN do is invoke each handler for real and verify what only
//   exists at this layer:
//
//     • each module exposes exactly ONE verb, and it is the right one
//     • the guard runs BEFORE request.json() and BEFORE validation
//     • a thrown internal error becomes the project envelope and never leaks
//     • no route mentions a studentId, a threshold, an average or Prisma
//     • each route is wired to the guard its access rule requires
//
//   The 401 path is unreachable here: outside a request scope the session read
//   throws before it can return, so handleRouteError converts it to 500. That
//   is an artefact of the environment rather than of the route, and saying so
//   is more useful than asserting a status these tests cannot produce.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import * as facultySubmitRoute from "@/app/api/feedback/faculty/route";
import * as labSubmitRoute from "@/app/api/feedback/lab/route";
import * as facultyReadRoute from "@/app/api/feedback/faculty/[facultyId]/route";
import * as reportRoute from "@/app/api/feedback/report/route";

const ROUTES = [
  {
    name: "facultySubmit",
    module: facultySubmitRoute as Record<string, unknown>,
    verb: "POST",
    path: "app/api/feedback/faculty/route.ts",
    url: "http://localhost/api/feedback/faculty",
    guard: "requireFeedbackSubmit",
    schema: "submitFeedbackSchema",
    method: "submitFeedback",
    dynamic: false,
  },
  {
    name: "labSubmit",
    module: labSubmitRoute as Record<string, unknown>,
    verb: "POST",
    path: "app/api/feedback/lab/route.ts",
    url: "http://localhost/api/feedback/lab",
    guard: "requireFeedbackSubmit",
    schema: "submitFeedbackSchema",
    method: "submitFeedback",
    dynamic: false,
  },
  {
    name: "facultyRead",
    module: facultyReadRoute as Record<string, unknown>,
    verb: "GET",
    path: "app/api/feedback/faculty/[facultyId]/route.ts",
    url: "http://localhost/api/feedback/faculty/faculty_1",
    guard: "requireFacultyFeedbackRead",
    schema: "facultyFeedbackQuerySchema",
    method: "getFacultyFeedback",
    dynamic: true,
  },
  {
    name: "report",
    module: reportRoute as Record<string, unknown>,
    verb: "GET",
    path: "app/api/feedback/report/route.ts",
    url: "http://localhost/api/feedback/report",
    guard: "requireFeedbackReport",
    schema: "feedbackReportQuerySchema",
    method: "getReport",
    dynamic: false,
  },
] as const;

/** The route file's code, with the documentation header stripped. */
function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

/** Invoke a route's handler, with a body for the write paths. */
async function invoke(route: (typeof ROUTES)[number], body = "{}") {
  if (route.dynamic) {
    const handler = route.module[route.verb] as (
      request: NextRequest,
      context: { params: Promise<{ facultyId: string }> }
    ) => Promise<Response>;

    return handler(new NextRequest(route.url), {
      params: Promise.resolve({ facultyId: "faculty_1" }),
    });
  }

  const handler = route.module[route.verb] as (
    request: NextRequest
  ) => Promise<Response>;

  return handler(
    route.verb === "GET"
      ? new NextRequest(route.url)
      : new NextRequest(route.url, { method: route.verb, body })
  );
}

// --- Surface ----------------------------------------------------------------

describe("feedback routes — HTTP surface", () => {
  it("each route exports exactly the verb it is specified with", () => {
    for (const route of ROUTES) {
      assert.deepEqual(Object.keys(route.module), [route.verb], route.name);
    }
  });

  it("exports ONLY GET or POST — no PUT, PATCH or DELETE anywhere", () => {
    for (const route of ROUTES) {
      for (const verb of ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
        assert.equal(verb in route.module, false, `${route.name} exports ${verb}`);
      }
    }
  });

  it("the read endpoints expose no write verb", () => {
    for (const route of ROUTES.filter((entry) => entry.verb === "GET")) {
      assert.equal("POST" in route.module, false, `${route.name} exports POST`);
    }
  });

  it("the submit endpoints expose no GET", () => {
    // A GET /feedback/faculty would be a submission triggerable by a link
    // preview.
    for (const route of ROUTES.filter((entry) => entry.verb === "POST")) {
      assert.equal("GET" in route.module, false, `${route.name} exports GET`);
    }
  });
});

// --- Failure behaviour, invoked for real ------------------------------------

describe("feedback routes — failure is contained and never leaks", () => {
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
      const raw = JSON.stringify(await (await invoke(route)).json());

      for (const leak of ["headers", "request scope", "at ", ".ts:", "node_modules", "stack"]) {
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
    // errors to probe the API.
    for (const route of ROUTES) {
      const response = await invoke(route, '{"rating":99,"studentId":"victim"}');

      assert.notEqual(response.status, 400, `${route.name} validated before authorising`);
    }
  });

  it("returns the project envelope for a MALFORMED body too", async () => {
    // Unparseable JSON must still produce the shared shape, not a framework
    // error page.
    for (const route of ROUTES.filter((entry) => entry.verb === "POST")) {
      const body = await (await invoke(route, "{ not json")).json();

      assert.equal(body.success, false, route.name);
      assert.equal(typeof body.code, "string", route.name);
    }
  });

  it("reaches no database when the caller cannot be authorised", async () => {
    for (const route of ROUTES) {
      const body = await (await invoke(route)).json();

      assert.notEqual(body.code, "P1001", `${route.name} attempted a connection`);
    }
  });
});

// --- Ordering: guard first --------------------------------------------------

describe("feedback routes — the guard runs first", () => {
  it("guards BEFORE parsing a body, on every write route", () => {
    for (const route of ROUTES.filter((entry) => entry.verb === "POST")) {
      const code = codeOf(route.path);
      const guarded = code.indexOf("if (!guard.granted) return guard.response;");
      const parsed = code.indexOf("await request.json()");

      assert.ok(guarded > -1 && parsed > -1, route.name);
      assert.ok(guarded < parsed, `${route.name} parses a body before guarding`);
    }
  });

  it("guards BEFORE validating, on every route", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);
      const guarded = code.indexOf("if (!guard.granted) return guard.response;");
      const validated = code.indexOf("safeParse");

      assert.ok(guarded > -1 && validated > -1, route.name);
      assert.ok(guarded < validated, `${route.name} validates before guarding`);
    }
  });

  it("validates BEFORE delegating, on every route", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);
      const validated = code.indexOf("safeParse");
      const delegated = code.indexOf("feedbackController.");

      assert.ok(validated < delegated, `${route.name} delegates before validating`);
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

// --- Authorisation wiring ---------------------------------------------------

describe("feedback routes — each is wired to the RIGHT guard", () => {
  it("uses the guard its access rule requires", () => {
    for (const route of ROUTES) {
      assert.ok(
        codeOf(route.path).includes(route.guard),
        `${route.name} does not use ${route.guard}`
      );
    }
  });

  it("the SUBMIT routes use the student-only guard", () => {
    for (const route of ROUTES.filter((entry) => entry.verb === "POST")) {
      const code = codeOf(route.path);

      assert.ok(code.includes("requireFeedbackSubmit"), route.name);
      assert.equal(code.includes("requireFeedbackReport"), false, route.name);
      assert.equal(code.includes("requireAdminReport"), false, route.name);
    }
  });

  it("the REPORT route does NOT use the wider faculty-read guard", () => {
    // requireFacultyFeedbackRead admits FACULTY; using it here would put a
    // participant inside a comparison between colleagues.
    const report = ROUTES.find((entry) => entry.name === "report");
    assert.ok(report);

    const code = codeOf(report.path);

    assert.ok(code.includes("requireFeedbackReport"));
    assert.equal(code.includes("requireFacultyFeedbackRead"), false);
    assert.equal(code.includes("requireFacultyAnalytics"), false);
  });

  it("no route composes its own role check", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      assert.equal(code.includes("requireRole("), false, `${route.name} re-runs the role gate`);
      assert.equal(code.includes("requireTenant("), false, `${route.name} re-runs tenant`);
    }
  });
});

// --- No logic in a route ----------------------------------------------------

describe("feedback routes — no business logic, anywhere", () => {
  it("mentions NO threshold, average, analytic or masking term", () => {
    // Every one belongs to lib/domain/feedback. A route naming one is a route
    // that started reasoning about it.
    const forbidden = [
      "threshold",
      "average",
      "mean",
      "median",
      "analytic",
      "mask",
      "anonym",
      "withhold",
      "disclosure",
      "weight",
    ];

    for (const route of ROUTES) {
      const code = codeOf(route.path).toLowerCase();

      for (const term of forbidden) {
        assert.equal(code.includes(term), false, `${route.name} mentions ${term}`);
      }
    }
  });

  it("contains NO arithmetic", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      for (const operator of ["+", "*", "Math.", ".reduce("]) {
        assert.equal(code.includes(operator), false, `${route.name} contains ${operator}`);
      }
    }
  });

  it("contains NO threshold comparison", () => {
    // Matched on SPACED operators. A bare "<" would also catch
    // `Promise<{ facultyId: string }>`, which is a type parameter rather than a
    // comparison — a naive matcher here would fail on correct code and teach a
    // future reader to weaken the test instead of the route.
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      for (const operator of [" < ", " > ", " >= ", " <= ", " === 5", ".length >"]) {
        assert.equal(code.includes(operator), false, `${route.name} compares with ${operator}`);
      }
    }
  });

  it("contains NO iteration — grouping belongs to the domain engine", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      for (const keyword of [".map(", ".filter(", ".sort(", "for ("]) {
        assert.equal(code.includes(keyword), false, `${route.name} iterates with ${keyword}`);
      }
    }
  });

  it("NEVER touches Prisma", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      assert.equal(code.includes("prisma"), false, `${route.name} reaches for Prisma`);
      assert.equal(code.includes("Repository"), false, `${route.name} names a repository`);
    }
  });

  it("never imports the domain engine directly", () => {
    for (const route of ROUTES) {
      assert.equal(
        codeOf(route.path).includes("domain/feedback"),
        false,
        `${route.name} bypasses the controller`
      );
    }
  });
});

// --- Identity ---------------------------------------------------------------

describe("feedback routes — identity comes only from the middleware", () => {
  it("no route mentions studentId", () => {
    for (const route of ROUTES) {
      assert.equal(
        codeOf(route.path).includes("studentId"),
        false,
        `${route.name} mentions studentId`
      );
    }
  });

  it("no route reads a tenantId or userId from the request", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      // The only permitted occurrences are guard.context.tenantId / .userId.
      const stray = code
        .split("\n")
        .filter(
          (line) =>
            (line.includes("tenantId") || line.includes("userId")) &&
            !line.includes("guard.context")
        );

      assert.deepEqual(stray, [], `${route.name} sources an identity elsewhere`);
    }
  });

  it("every route takes its tenant from the guard", () => {
    for (const route of ROUTES) {
      assert.ok(
        codeOf(route.path).includes("guard.context.tenantId"),
        `${route.name} does not use the guard's tenant`
      );
    }
  });

  it("the submit routes take the caller's userId from the guard", () => {
    for (const route of ROUTES.filter((entry) => entry.verb === "POST")) {
      assert.ok(codeOf(route.path).includes("guard.context.userId"), route.name);
    }
  });

  it("the read routes carry the guard's ACCESS authority, not a raw id", () => {
    // Which projection a caller receives is decided by their role, applied in
    // the service. The route carries the authority and reads nothing from the
    // request about it.
    for (const route of ROUTES.filter((entry) => entry.verb === "GET")) {
      assert.ok(codeOf(route.path).includes("guard.context.access"), route.name);
    }
  });

  it("the [facultyId] segment names the SUBJECT, never the caller", () => {
    // A faculty member cannot read a colleague by putting their id in the path:
    // the service compares it against the guard's own resolved id.
    const route = ROUTES.find((entry) => entry.name === "facultyRead");
    assert.ok(route);

    const code = codeOf(route.path);

    assert.ok(code.includes("parsedParam.data.facultyId"));
    assert.ok(code.includes("guard.context.access"));
  });
});

// --- Conventions ------------------------------------------------------------

describe("feedback routes — project conventions", () => {
  it("declares a SCOPE naming its own verb and path", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      assert.ok(
        new RegExp(`const SCOPE = "${route.verb} /api/feedback`).test(code),
        `${route.name} has a wrong or missing SCOPE`
      );
    }
  });

  it("funnels errors through handleRouteError with that scope", () => {
    for (const route of ROUTES) {
      assert.ok(
        codeOf(route.path).includes("handleRouteError(SCOPE, err)"),
        route.name
      );
    }
  });

  it("wraps every payload in the shared ok() envelope", () => {
    for (const route of ROUTES) {
      assert.ok(codeOf(route.path).includes("NextResponse.json(ok("), route.name);
    }
  });

  it("returns a validation failure through the shared helper", () => {
    for (const route of ROUTES) {
      assert.ok(codeOf(route.path).includes("validationFailure"), route.name);
    }
  });

  it("distinguishes a malformed body from an invalid one", () => {
    // Unparseable JSON is not the same failure as a well-formed body that
    // breaks a rule, and collapsing them would tell a client the wrong thing.
    for (const route of ROUTES.filter((entry) => entry.verb === "POST")) {
      assert.ok(codeOf(route.path).includes("malformedBody()"), route.name);
    }
  });

  it("validates with its own schema and delegates to its own controller method", () => {
    for (const route of ROUTES) {
      const code = codeOf(route.path);

      assert.ok(code.includes(route.schema), `${route.name} → ${route.schema}`);
      assert.ok(
        code.includes(`feedbackController.${route.method}`),
        `${route.name} → ${route.method}`
      );
    }
  });

  it("the two submit routes delegate IDENTICALLY", () => {
    // They differ only in which FORM a client names; the enforcement lives in
    // the service, which can see the form's sessionType. Two URLs, one
    // behaviour — stated rather than left to be discovered.
    const faculty = codeOf("app/api/feedback/faculty/route.ts");
    const lab = codeOf("app/api/feedback/lab/route.ts");

    assert.equal(
      faculty.replace(/faculty/g, "X"),
      lab.replace(/lab/g, "X").replace(/faculty/g, "X")
    );
  });

  it("passes an instant to the write paths and none to the reads", () => {
    for (const route of ROUTES.filter((entry) => entry.verb === "POST")) {
      assert.ok(codeOf(route.path).includes("new Date()"), route.name);
    }

    for (const route of ROUTES.filter((entry) => entry.verb === "GET")) {
      assert.equal(codeOf(route.path).includes("new Date()"), false, route.name);
    }
  });
});
