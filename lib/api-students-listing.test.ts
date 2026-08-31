// ============================================================================
// MODULE : Students — listing response contract
// LAYER  : Regression Test
// PURPOSE: Pin the two halves of the tester issue #23 follow-up:
//
//          1. GET /api/students joins the linked User, so the Students table
//             renders a name and "Search by name or enrolment number" can
//             actually match one. services/students.ts used to fabricate empty
//             name fields because the route expanded no relation.
//
//          2. It exposes EXACTLY the five User fields StudentWithUser declares
//             and no more. This is the half worth a test: `user: true` — a
//             plausible one-character edit — returns every User scalar, which
//             includes passwordHash. An explicit column list is the control,
//             and this asserts the control is still there.
//
// WHY THIS TEST READS THE SOURCE
//   Asserting the SHAPE of a Prisma select needs either a database or a Prisma
//   client, and the test runner has neither — see package.json. The query
//   PARAMETERS are tested properly against the real Zod schema in
//   lib/validations/studentListing.validation.test.ts; this file covers only
//   what that cannot reach.
//
//   WHAT IT PROVES : the listing select joins the user, names the five contract
//                    fields, leaks none of the sensitive ones, and the create
//                    path was not widened along with it.
//   WHAT IT DOES NOT PROVE : that the query runs, that rows come back, or that
//                    a name renders. Those need the database.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE = "app/api/students/route.ts";

/** Source with comments stripped, so a match means code and not prose. */
const code = readFileSync(join(process.cwd(), ROUTE), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

/** The body of the listing select, from `STUDENT_LIST_SELECT` to its close. */
function listSelectBody(): string {
  const match = /const STUDENT_LIST_SELECT = \{([\s\S]*?)\n\} as const;/.exec(code);
  assert.ok(
    match,
    "could not locate STUDENT_LIST_SELECT — has the listing select been renamed or removed?"
  );
  return match[1];
}

describe("GET /api/students — the listing joins the linked User", () => {
  it("uses the joined select, not the scalar-only one", () => {
    assert.match(
      code,
      /take: limit,\s*select: STUDENT_LIST_SELECT,/,
      "the listing must select STUDENT_LIST_SELECT. With STUDENT_SELECT the rows " +
        "carry no name, the Students table renders a blank column, and searching " +
        "by name matches nothing."
    );
  });

  it("selects the user relation explicitly rather than wholesale", () => {
    const body = listSelectBody();

    assert.match(body, /user:\s*\{\s*select:\s*\{/, "the user relation must use an explicit select");

    assert.ok(
      !/user:\s*true/.test(body),
      "STUDENT_LIST_SELECT uses `user: true`. That returns EVERY User scalar — " +
        "passwordHash included — to a list screen that needs five fields. Name " +
        "the columns instead."
    );
  });
});

describe("GET /api/students — exactly the StudentWithUser contract", () => {
  it("selects the five fields the contract declares", () => {
    // Pick<User, "id" | "firstName" | "lastName" | "email" | "avatarUrl">
    const body = listSelectBody();

    for (const field of ["id", "firstName", "lastName", "email", "avatarUrl"]) {
      assert.match(
        body,
        new RegExp(`\\b${field}:\\s*true`),
        `the listing must select user.${field} — StudentWithUser declares it and the UI reads it`
      );
    }
  });

  it("leaks no User field the contract does not declare", () => {
    const body = listSelectBody();

    for (const field of ["passwordHash", "phone", "displayName", "isActive", "isVerified"]) {
      assert.ok(
        !new RegExp(`\\b${field}:\\s*true`).test(body),
        `STUDENT_LIST_SELECT exposes user.${field}, which StudentWithUser does not ` +
          "declare and no student list renders. Keep the select to the contract."
      );
    }
  });
});

describe("GET /api/students — the create path was not widened with it", () => {
  it("leaves POST on the scalar-only select", () => {
    // Nothing consumes a name from a create response, so joining there would be
    // a contract change nothing asked for.
    assert.ok(
      /select: STUDENT_SELECT,/.test(code),
      "POST must keep STUDENT_SELECT — only the listing needs the join"
    );
  });
});

describe("GET /api/students — full-name search", () => {
  it("splits the term so a full name typed in one go can match", () => {
    // There is no full-name column, and Prisma cannot concatenate two columns
    // in a `where`. A plain OR over firstName/lastName matches "Priya" and
    // matches "Sharma" but never "Priya Sharma" — the most natural thing to
    // type into a box labelled "Search by name".
    assert.match(
      code,
      /q\.split\(\/\\s\+\/\)/,
      "the search term must be split on whitespace so every term can be matched"
    );

    assert.match(
      code,
      /AND: terms\.map\(/,
      "every term must be required, so 'Priya Sharma' matches firstName AND lastName"
    );
  });

  it("still scopes every search to the caller's own tenant", () => {
    // The search predicate is composed INSIDE the tenant predicate. If tenantId
    // ever moves out of this object, a search reaches every institution.
    assert.match(
      code,
      /const where: Prisma\.StudentWhereInput = \{\s*tenantId: tenant\.id,/,
      "tenantId must remain the first, unconditional term of the listing predicate"
    );
  });
});
