// ============================================================================
// TESTS: Batch listing query (tester issue #22).
//
// The tester reported that searching the Batches page returned the unfiltered
// list. The page has ALWAYS rendered an enabled search box and two enabled
// filters, and has always sent ?q, ?programmeId and ?academicYearId — but
// listBatchesQuerySchema was `paginationQuerySchema`, so Zod dropped all three
// before the handler saw them and the route read every batch in the tenant.
//
// These pin what the route cannot check for itself: the three parameters
// survive validation, an empty value means "no filter" rather than a 400, and
// a client cannot smuggle a tenant through the query string.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listBatchesQuerySchema } from "./batch";

describe("listBatchesQuerySchema — pagination", () => {
  it("defaults pagination and applies no filter when nothing is supplied", () => {
    const parsed = listBatchesQuerySchema.parse({});
    assert.equal(parsed.page, 1);
    assert.equal(parsed.limit, 20);
    assert.equal(parsed.q, undefined);
    assert.equal(parsed.programmeId, undefined);
    assert.equal(parsed.academicYearId, undefined);
  });

  it("still coerces page and limit from strings", () => {
    const parsed = listBatchesQuerySchema.parse({ page: "2", limit: "50" });
    assert.equal(parsed.page, 2);
    assert.equal(parsed.limit, 50);
  });
});

describe("listBatchesQuerySchema — search (?q)", () => {
  it("accepts a search term", () => {
    assert.equal(listBatchesQuerySchema.parse({ q: "2024" }).q, "2024");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(listBatchesQuerySchema.parse({ q: "  CSE  " }).q, "CSE");
  });

  it("treats an empty q as no search rather than an error", () => {
    // Clearing the search box removes the key; a bookmarked "?q=" must behave
    // the same way instead of answering 400 to an ordinary URL.
    assert.equal(listBatchesQuerySchema.parse({ q: "" }).q, undefined);
  });

  it("treats a whitespace-only q as no search", () => {
    assert.equal(listBatchesQuerySchema.parse({ q: "   " }).q, undefined);
  });

  it("preserves case, leaving case-insensitivity to the query", () => {
    // The route matches with Prisma's mode: "insensitive". Lowercasing here
    // would be a second, silent normalisation the route does not expect.
    assert.equal(listBatchesQuerySchema.parse({ q: "CSE" }).q, "CSE");
  });

  it("rejects an unreasonably long term", () => {
    assert.equal(listBatchesQuerySchema.safeParse({ q: "x".repeat(201) }).success, false);
  });
});

describe("listBatchesQuerySchema — programme and academic-year filters", () => {
  it("accepts both ids", () => {
    const parsed = listBatchesQuerySchema.parse({
      programmeId: "prog_1",
      academicYearId: "ay_1",
    });
    assert.equal(parsed.programmeId, "prog_1");
    assert.equal(parsed.academicYearId, "ay_1");
  });

  it('treats an empty id as "All …" rather than an error', () => {
    // This is the whole of what the "All programmes"/"All years" option means.
    const parsed = listBatchesQuerySchema.parse({ programmeId: "", academicYearId: "  " });
    assert.equal(parsed.programmeId, undefined);
    assert.equal(parsed.academicYearId, undefined);
  });

  it("asserts no id format, so an unknown id is an empty result and not a 400", () => {
    // Ids are opaque cuids. An id naming nothing — or naming another tenant's
    // programme — must simply match no batches, because the route ANDs the
    // tenant predicate alongside it.
    assert.equal(listBatchesQuerySchema.safeParse({ programmeId: "not-a-cuid" }).success, true);
  });
});

describe("listBatchesQuerySchema — combined and hostile input", () => {
  it("carries search and both filters together", () => {
    const parsed = listBatchesQuerySchema.parse({
      q: "cse",
      programmeId: "prog_1",
      academicYearId: "ay_1",
      page: "3",
    });
    assert.equal(parsed.q, "cse");
    assert.equal(parsed.programmeId, "prog_1");
    assert.equal(parsed.academicYearId, "ay_1");
    assert.equal(parsed.page, 3);
  });

  it("DROPS a client-supplied tenantId", () => {
    // The route takes the tenant from requireTenant and never from the query.
    // An unknown key surviving validation is how that guarantee gets lost.
    const parsed = listBatchesQuerySchema.parse({ tenantId: "other-tenant" });
    assert.equal("tenantId" in parsed, false);
  });
});
