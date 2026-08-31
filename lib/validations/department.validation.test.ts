// ============================================================================
// TESTS: Department listing query.
//
// This screen has three controls — a search box and two filters — and all
// three are query parameters. What the schema accepts IS the feature, and what
// it drops is a privilege boundary: a tenantId reaching the handler would let
// the query name another institution.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listDepartmentsQuerySchema } from "./department";

describe("listDepartmentsQuerySchema", () => {
  it("defaults pagination and applies no filters when nothing is supplied", () => {
    const parsed = listDepartmentsQuerySchema.parse({});
    assert.equal(parsed.page, 1);
    assert.equal(parsed.limit, 20);
    assert.equal(parsed.q, undefined);
    assert.equal(parsed.campusId, undefined);
    assert.equal(parsed.schoolId, undefined);
  });

  it("accepts all three controls at once", () => {
    // The combination is the point: the toolbar reads as a narrowing, and the
    // route ANDs them.
    const parsed = listDepartmentsQuerySchema.parse({
      q: "Computer",
      campusId: "campus_1",
      schoolId: "school_1",
    });

    assert.equal(parsed.q, "Computer");
    assert.equal(parsed.campusId, "campus_1");
    assert.equal(parsed.schoolId, "school_1");
  });

  it("trims surrounding whitespace on every value", () => {
    const parsed = listDepartmentsQuerySchema.parse({
      q: "  Computer  ",
      campusId: "  campus_1  ",
    });

    assert.equal(parsed.q, "Computer");
    assert.equal(parsed.campusId, "campus_1");
  });

  it("treats an empty value as NO filter rather than an error", () => {
    // "All campuses" and "All schools" reset to empty, and a bookmarked
    // "?campusId=" must mean the unfiltered list — not a 400.
    const parsed = listDepartmentsQuerySchema.parse({ q: "", campusId: "", schoolId: "" });

    assert.equal(parsed.q, undefined);
    assert.equal(parsed.campusId, undefined);
    assert.equal(parsed.schoolId, undefined);
  });

  it("treats whitespace-only values as no filter", () => {
    const parsed = listDepartmentsQuerySchema.parse({ q: "   ", campusId: "  " });
    assert.equal(parsed.q, undefined);
    assert.equal(parsed.campusId, undefined);
  });

  it("preserves case, leaving case-insensitivity to the query", () => {
    assert.equal(listDepartmentsQuerySchema.parse({ q: "COMPUTER" }).q, "COMPUTER");
  });

  it("accepts an id naming nothing, so the answer is an empty list not a 400", () => {
    // Ids are opaque keys. An unrecognised — or another tenant's — id must
    // match no department rather than be rejected as malformed.
    const parsed = listDepartmentsQuerySchema.parse({ campusId: "not-a-real-id" });
    assert.equal(parsed.campusId, "not-a-real-id");
  });

  it("rejects unreasonably long values", () => {
    assert.equal(listDepartmentsQuerySchema.safeParse({ q: "x".repeat(201) }).success, false);
    assert.equal(
      listDepartmentsQuerySchema.safeParse({ campusId: "x".repeat(201) }).success,
      false
    );
  });

  it("DROPS a client-supplied tenantId", () => {
    // The tenant comes from requireTenant. This is the privilege boundary: if
    // tenantId survived here it could reach the where clause.
    const parsed = listDepartmentsQuerySchema.parse({
      q: "Computer",
      tenantId: "other-tenant",
      universityId: "other-university",
    });

    assert.equal("tenantId" in parsed, false);
    assert.equal("universityId" in parsed, false);
  });

  it("still coerces page and limit from strings", () => {
    const parsed = listDepartmentsQuerySchema.parse({ page: "3", limit: "5", q: "Comp" });
    assert.equal(parsed.page, 3);
    assert.equal(parsed.limit, 5);
  });
});
