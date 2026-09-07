// ============================================================================
// TESTS: Delete Course — tester issue #31.
//
// THE DEFECT
//   The tester reported that deleting a course fails with "Method Not Allowed".
//   It did: app/api/courses/[id]/route.ts exported GET and PATCH and nothing
//   else, so the App Router answered every DELETE with 405. The UI, the Server
//   Action and services/courses.ts had all been written against
//   DELETE /api/courses/[id] from the start — the handler was simply never
//   implemented.
//
//   THE FIRST TEST BELOW IS THE ONE THAT WOULD HAVE CAUGHT IT. Everything else
//   here guards the semantics of the handler that closes the gap.
//
// WHAT IS ASSERTED WHERE
//   The route reaches a database and this suite has none — see package.json,
//   which runs node --test over lib/** with no DB and no DOM — so the route's
//   guarantees are pinned as source contracts, the way this project already
//   pins them (lib/api-programme-filters.test.ts, lib/api-department-scope.ts
//   and the validation suites). The behaviours that need real rows are covered
//   by live verification against the running API.
//
// THE BEHAVIOUR THIS PINS IS A HARD DELETE, REFUSED WHEN REFERENCED — not a
// soft retire. That is the product's existing semantics, not a choice made
// here: retiring already exists as its own operation (the `isActive` switch on
// the edit dialog, rendered as "Offered" / "Retired", written through PATCH),
// and both the service doc and the confirmation dialog say a referenced course
// "cannot be deleted — retire it instead".
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(join(process.cwd(), "app/api/courses/[id]/route.ts"), "utf8");
const service = readFileSync(join(process.cwd(), "services/courses.ts"), "utf8");
const page = readFileSync(
  join(process.cwd(), "app/(university)/curriculum/courses/page.tsx"),
  "utf8"
);
const action = readFileSync(join(process.cwd(), "actions/academics.ts"), "utf8");

/** One handler's body, so an assertion cannot be satisfied by a sibling. */
function handlerBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start > 0, `${name} must exist`);

  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe("#31 — the endpoint the frontend has always called now exists", () => {
  it("exports DELETE", () => {
    // THE REGRESSION. Without this export the App Router answers 405 Method Not
    // Allowed, which is exactly what the tester saw.
    assert.match(route, /export async function DELETE\(/);
  });

  it("still exports GET and PATCH — nothing was traded away for it", () => {
    assert.match(route, /export async function GET\(/);
    assert.match(route, /export async function PATCH\(/);
  });

  it("the frontend sends DELETE to this exact path, unchanged", () => {
    // The three layers that were already correct. If any of them is ever
    // rewritten to a different verb or path, the handler above stops being
    // reachable and the 405 returns by another route.
    assert.match(
      service,
      /apiRequest<null>\(`\/api\/courses\/\$\{id\}`, \{ method: "DELETE" \}\)/
    );
    assert.match(action, /export async function deleteCourseAction/);
    assert.match(action, /return deleteCourse\(id\)/);
    assert.match(page, /onDelete=\{deleteCourseAction\.bind\(null, course\.id\)\}/);
  });
});

describe("#31 — authorization mirrors the sibling handlers exactly", () => {
  const del = handlerBody(route, "DELETE");
  const patch = handlerBody(route, "PATCH");

  it("requires UNIVERSITY_ADMIN", () => {
    assert.match(del, /requireRole\("UNIVERSITY_ADMIN"\)/);
  });

  it("resolves the tenant from the session", () => {
    assert.match(del, /const tenantGuard = await requireTenant\(\)/);
    assert.match(del, /if \(!tenantGuard\.resolved\) return tenantGuard\.response/);
  });

  it("applies the tenant's module selection", () => {
    // Deleting must not be reachable on a module the university switched off
    // when editing is not.
    assert.match(del, /requireModule\(tenantGuard\.tenant\.id, request\.nextUrl\.pathname\)/);
  });

  it("runs the three guards in the SAME ORDER as PATCH", () => {
    const order = (body: string) => [
      body.indexOf("requireRole"),
      body.indexOf("requireTenant"),
      body.indexOf("requireModule"),
    ];

    const [delRole, delTenant, delModule] = order(del);
    const [patchRole, patchTenant, patchModule] = order(patch);

    assert.ok(delRole > 0 && delRole < delTenant && delTenant < delModule);
    assert.ok(patchRole > 0 && patchRole < patchTenant && patchTenant < patchModule);
  });

  it("validates the [id] segment before touching the database", () => {
    assert.match(del, /courseIdParamSchema\.safeParse\(await params\)/);
    assert.ok(
      del.indexOf("courseIdParamSchema") < del.indexOf("prisma.course"),
      "a malformed id must be a 400 rather than a database round trip"
    );
  });
});

describe("#31 — tenant isolation", () => {
  const del = handlerBody(route, "DELETE");

  it("resolves the course by BOTH id and tenantId", () => {
    assert.match(
      del,
      /prisma\.course\.findFirst\(\{\s*where: \{ id: courseId, tenantId: tenant\.id \}/
    );
  });

  it("scopes the DELETE itself by tenantId too, not just the lookup", () => {
    // So the write cannot reach another tenant's row even if the id were
    // guessed and the lookup were somehow bypassed.
    assert.match(
      del,
      /prisma\.course\.delete\(\{\s*where: \{ id: courseId, tenantId: tenant\.id \}/
    );
  });

  it("proves ownership BEFORE issuing any write", () => {
    assert.ok(
      del.indexOf("findFirst") < del.indexOf("prisma.course.delete"),
      "a foreign or unknown id must stop before the delete"
    );
  });

  it("NEVER reads a tenant from the request", () => {
    assert.ok(
      !/tenantId: (parsed|params|body|input|request)/.test(del),
      "the tenant must come from requireTenant, never from the path or body"
    );
  });

  it("answers a foreign course with the same 404 as an unknown one", () => {
    // A distinguishable response would confirm the id exists in another tenant.
    assert.match(del, /fail\("Course not found", "NOT_FOUND"\), \{ status: 404 \}/);
  });
});

describe("#31 — a referenced course is refused, not orphaned", () => {
  const del = handlerBody(route, "DELETE");

  it("maps a foreign-key violation to 409 CONFLICT", () => {
    // Twelve models reference Course and none of them cascades. Without this
    // branch a timetabled course answers an unhandled 500.
    assert.match(del, /isForeignKeyViolation\(err\)/);
    assert.match(del, /"CONFLICT"\s*\),\s*\{ status: 409 \}/);
  });

  it("the refusal names the remedy the UI already offers", () => {
    // "Retire it instead" is what the confirmation dialog promises; the API
    // saying anything else would contradict the screen.
    assert.match(del, /Retire it instead/);
  });

  it("imports the helper rather than testing the code inline", () => {
    assert.match(route, /import \{ isForeignKeyViolation, isRecordNotFound \}/);
  });

  it("treats a lost race as the same 404", () => {
    assert.match(del, /isRecordNotFound\(err\)/);
  });

  it("falls through to 500 only for genuinely unknown failures", () => {
    assert.match(del, /console\.error\("\[DELETE \/api\/courses\/\[id\]\]", err\)/);
    assert.match(del, /"Internal server error", "SERVER_ERROR"/);
  });
});

describe("#31 — it is a hard delete, and retirement stays a separate operation", () => {
  const del = handlerBody(route, "DELETE");

  it("DELETE removes the row rather than flipping isActive", () => {
    assert.match(del, /prisma\.course\.delete\(/);
    assert.ok(
      !/isActive/.test(del),
      "DELETE must not write isActive — that is what PATCH and the edit dialog do"
    );
  });

  it("the edit dialog still owns retirement", () => {
    assert.match(page, /name: "isActive"/);
    assert.match(page, /course\.isActive \? "Offered" : "Retired"/);
    assert.match(page, /onUpdate=\{updateCourseAction\.bind\(null, course\.id\)\}/);
  });

  it("the confirmation copy and the API agree about what happens", () => {
    assert.match(page, /will be permanently removed/);
    assert.match(page, /cannot be deleted — retire it instead/);
  });

  it("answers success in the project's envelope", () => {
    assert.match(del, /ok\(null, "Course deleted"\)/);
  });
});
