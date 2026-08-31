// ============================================================================
// TESTS: Campus listing query.
//
// ?q is the whole of campus search. These pin the two things a route cannot
// see for itself: that an empty search is "no filter" rather than a 400, and
// that a client cannot smuggle a tenant through the query string.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listCampusesQuerySchema } from "./campus";

describe("listCampusesQuerySchema", () => {
  it("defaults pagination when nothing is supplied", () => {
    const parsed = listCampusesQuerySchema.parse({});
    assert.equal(parsed.page, 1);
    assert.equal(parsed.limit, 20);
    assert.equal(parsed.q, undefined);
  });

  it("accepts a search term", () => {
    assert.equal(listCampusesQuerySchema.parse({ q: "Delhi" }).q, "Delhi");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(listCampusesQuerySchema.parse({ q: "  Delhi  " }).q, "Delhi");
  });

  it("treats an empty q as no search rather than an error", () => {
    // A bookmarked or hand-edited "?q=" is plainly a request for the whole
    // list. Rejecting it would answer 400 to a perfectly ordinary URL.
    assert.equal(listCampusesQuerySchema.parse({ q: "" }).q, undefined);
  });

  it("treats a whitespace-only q as no search", () => {
    assert.equal(listCampusesQuerySchema.parse({ q: "   " }).q, undefined);
  });

  it("preserves case, leaving case-insensitivity to the query", () => {
    // The schema must not lowercase: the value is matched with Prisma's
    // insensitive mode, and folding it here would hide where that happens.
    assert.equal(listCampusesQuerySchema.parse({ q: "DELHI" }).q, "DELHI");
  });

  it("rejects an unreasonably long term", () => {
    assert.equal(listCampusesQuerySchema.safeParse({ q: "x".repeat(201) }).success, false);
  });

  it("DROPS a client-supplied tenantId", () => {
    // The tenant comes from requireTenant. Even if a caller sends one, it must
    // not reach the handler, where it could widen the search past its own
    // institution.
    const parsed = listCampusesQuerySchema.parse({ q: "Delhi", tenantId: "other-tenant" });
    assert.equal("tenantId" in parsed, false);
  });

  it("still coerces page and limit from strings", () => {
    // Search params always arrive as strings; adding q must not break that.
    const parsed = listCampusesQuerySchema.parse({ page: "3", limit: "5", q: "Delhi" });
    assert.equal(parsed.page, 3);
    assert.equal(parsed.limit, 5);
  });
});
