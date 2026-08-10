// ============================================================================
// OWNER  : Gauransh
// MODULE : Parent Portal (W2 — PRD §32)
// LAYER  : Validation + routing — Unit Tests
// PURPOSE: Pin down the contracts a parent request cannot escape.
//
//          The parent portal's whole security story is "a client may not choose
//          which family, which tenant, or which authority it gets", so the
//          load-bearing assertions here are the REFUSALS. The ownership check
//          itself needs a database and is proved by live verification.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createParentAccountSchema, parentIdParamSchema } from "@/lib/validations/parent";
import { ROLES, homeRouteForRoles, NO_PORTAL_ROUTE } from "@/constants/roles";
import { PARENT_NAV } from "@/constants/navigation";

describe("createParentAccountSchema", () => {
  it("accepts an email and lowercases it", () => {
    const result = createParentAccountSchema.safeParse({ email: "Mum@Example.COM" });
    assert.equal(result.success, true);
    // User is @@unique([tenantId, email]) and the login route lowercases before
    // its lookup, so one address must not become two accounts.
    assert.equal(result.data?.email, "mum@example.com");
  });

  it("REFUSES tenantId, userId, passwordHash and role", () => {
    // Strict, and none of these is a field. The tenant comes from the resolved
    // context, the user is created by the route, the hash is generated, and
    // PARENT is a constant.
    for (const forbidden of [
      { tenantId: "another_university" },
      { userId: "u_1" },
      { passwordHash: "$2b$12$x" },
      { role: "UNIVERSITY_ADMIN" },
      { password: "hunter2hunter2" },
      { mustChangePassword: false },
    ]) {
      assert.equal(
        createParentAccountSchema.safeParse({ email: "a@b.com", ...forbidden }).success,
        false,
        `expected ${Object.keys(forbidden)[0]} to be refused`
      );
    }
  });

  it("REFUSES a name — it is copied from the Parent record", () => {
    // Otherwise the account and the contact record could describe two different
    // people.
    assert.equal(
      createParentAccountSchema.safeParse({ email: "a@b.com", firstName: "Someone" }).success,
      false
    );
  });

  it("rejects a malformed or missing address", () => {
    assert.equal(createParentAccountSchema.safeParse({}).success, false);
    assert.equal(createParentAccountSchema.safeParse({ email: "not-an-email" }).success, false);
    assert.equal(createParentAccountSchema.safeParse({ email: "   " }).success, false);
  });
});

describe("parentIdParamSchema", () => {
  it("accepts any non-empty id and asserts no cuid shape", () => {
    // The id is opaque; asserting a format would turn an
    // unrecognised-but-well-formed id into a 400 when 404 is accurate.
    assert.equal(parentIdParamSchema.safeParse({ id: "anything" }).success, true);
    assert.equal(parentIdParamSchema.safeParse({ id: "   " }).success, false);
  });
});

describe("parent portal routing (PRD §32)", () => {
  it("routes a PARENT to the parent portal", () => {
    // Before W2 a parent fell through to NO_PORTAL_ROUTE — there was no portal.
    assert.equal(homeRouteForRoles([ROLES.PARENT]), "/parent/dashboard");
  });

  it("prefers the student portal when somebody is both", () => {
    // A student who is also recorded as a parent is primarily the student:
    // their portal is about their own record.
    assert.equal(
      homeRouteForRoles([ROLES.PARENT, ROLES.STUDENT]),
      "/student/dashboard"
    );
  });

  it("still sends a role with no portal to the terminal route", () => {
    assert.equal(homeRouteForRoles(["SOMETHING_ELSE"]), NO_PORTAL_ROUTE);
  });
});

describe("PARENT_NAV — only §32 items with a backing API", () => {
  it("offers exactly the seven implemented screens", () => {
    assert.deepEqual(
      PARENT_NAV.flatMap((group) => group.items.map((item) => item.href)),
      [
        "/parent/dashboard",
        "/parent/attendance",
        "/parent/timetable",
        "/parent/results",
        "/parent/fees",
        "/parent/notices",
        "/parent/documents",
      ]
    );
  });

  it("offers NOTHING the PRD leaves undefined or the schema cannot back", () => {
    // §32 also names online payments, faculty communication, behavioural
    // reports, leave requests, hostel, transport, events, counsellor
    // appointments and raising concerns. None has a model or a defined
    // workflow, so none may appear — a nav entry leading to a screen the
    // backend cannot fill is a promise the product does not keep.
    const hrefs = PARENT_NAV.flatMap((g) => g.items.map((i) => i.href.toLowerCase()));
    for (const forbidden of [
      "pay",
      "message",
      "behaviour",
      "leave",
      "hostel",
      "transport",
      "event",
      "counsel",
      "concern",
      "preference",
    ]) {
      assert.ok(
        !hrefs.some((h) => h.includes(forbidden)),
        `PARENT_NAV must not offer "${forbidden}" — it has no backing`
      );
    }
  });
});
