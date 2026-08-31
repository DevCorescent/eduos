// ============================================================================
// TESTS: School listing query.
//
// ?q is the whole of school search. These pin the two things the route cannot
// see for itself: that an empty search means "no filter" rather than a 400,
// and that a client cannot smuggle a tenant through the query string.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listSchoolsQuerySchema } from "./school";

describe("listSchoolsQuerySchema", () => {
  it("defaults pagination when nothing is supplied", () => {
    const parsed = listSchoolsQuerySchema.parse({});
    assert.equal(parsed.page, 1);
    assert.equal(parsed.limit, 20);
    assert.equal(parsed.q, undefined);
  });

  it("accepts a search term", () => {
    assert.equal(listSchoolsQuerySchema.parse({ q: "Engineering" }).q, "Engineering");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(listSchoolsQuerySchema.parse({ q: "  Engineering  " }).q, "Engineering");
  });

  it("treats an empty q as no search rather than an error", () => {
    // A bookmarked or hand-edited "?q=" is plainly a request for the whole
    // list. Rejecting it would answer 400 to a perfectly ordinary URL.
    assert.equal(listSchoolsQuerySchema.parse({ q: "" }).q, undefined);
  });

  it("treats a whitespace-only q as no search", () => {
    assert.equal(listSchoolsQuerySchema.parse({ q: "   " }).q, undefined);
  });

  it("preserves case, leaving case-insensitivity to the query", () => {
    // The schema must not lowercase: the value is matched with Prisma's
    // insensitive mode, and folding it here would hide where that happens.
    assert.equal(listSchoolsQuerySchema.parse({ q: "ENGINEERING" }).q, "ENGINEERING");
  });

  it("rejects an unreasonably long term", () => {
    assert.equal(listSchoolsQuerySchema.safeParse({ q: "x".repeat(201) }).success, false);
  });

  it("DROPS a client-supplied tenantId", () => {
    // The tenant comes from requireTenant. Even if a caller sends one, it must
    // not reach the handler, where it could widen the search past its own
    // institution.
    const parsed = listSchoolsQuerySchema.parse({ q: "Engineering", tenantId: "other-tenant" });
    assert.equal("tenantId" in parsed, false);
  });

  it("DROPS campusId, which this endpoint does not yet filter on", () => {
    // The page still renders that control disabled. Asserting the drop keeps
    // the schema and the disabled control telling the same story.
    const parsed = listSchoolsQuerySchema.parse({ q: "Engineering", campusId: "abc" });
    assert.equal("campusId" in parsed, false);
  });

  it("still coerces page and limit from strings", () => {
    // Search params always arrive as strings; adding q must not break that.
    const parsed = listSchoolsQuerySchema.parse({ page: "3", limit: "5", q: "Eng" });
    assert.equal(parsed.page, 3);
    assert.equal(parsed.limit, 5);
  });
});
