// ============================================================================
// TESTS: Programme listing query.
//
// This screen has three controls — a search box, a Department filter and a Type
// filter — and all three are query parameters. What the schema accepts IS the
// feature, and what it drops is a privilege boundary: a tenantId reaching the
// handler would let the query name another institution.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listProgrammesQuerySchema } from "./programme";

describe("listProgrammesQuerySchema", () => {
  it("defaults pagination and applies no filters when nothing is supplied", () => {
    const parsed = listProgrammesQuerySchema.parse({});
    assert.equal(parsed.page, 1);
    assert.equal(parsed.limit, 20);
    assert.equal(parsed.q, undefined);
    assert.equal(parsed.departmentId, undefined);
    assert.equal(parsed.type, undefined);
  });

  it("accepts all three controls at once", () => {
    // The combination is the point: the toolbar reads as a narrowing, and the
    // route ANDs them.
    const parsed = listProgrammesQuerySchema.parse({
      q: "Computer",
      departmentId: "dept_1",
      type: "UNDERGRADUATE",
    });

    assert.equal(parsed.q, "Computer");
    assert.equal(parsed.departmentId, "dept_1");
    assert.equal(parsed.type, "UNDERGRADUATE");
  });

  it("trims surrounding whitespace", () => {
    const parsed = listProgrammesQuerySchema.parse({ q: "  Computer  ", departmentId: " d1 " });
    assert.equal(parsed.q, "Computer");
    assert.equal(parsed.departmentId, "d1");
  });

  it("treats an empty value as NO filter rather than an error", () => {
    // "All departments" and "All types" reset to empty, and a bookmarked
    // "?departmentId=" must mean the unfiltered list — not a 400.
    const parsed = listProgrammesQuerySchema.parse({ q: "", departmentId: "", type: "" });

    assert.equal(parsed.q, undefined);
    assert.equal(parsed.departmentId, undefined);
    assert.equal(parsed.type, undefined);
  });

  it("treats a whitespace-only type as no filter, not an invalid enum", () => {
    // The empty check runs BEFORE the enum check, so resetting the control can
    // never be reported as an invalid ProgrammeType.
    assert.equal(listProgrammesQuerySchema.parse({ type: "   " }).type, undefined);
  });

  it("preserves case on the search term", () => {
    assert.equal(listProgrammesQuerySchema.parse({ q: "COMPUTER" }).q, "COMPUTER");
  });

  it("accepts a departmentId naming nothing, so the answer is an empty list", () => {
    // Ids are opaque keys. An unrecognised — or another tenant's — id must
    // match no programme rather than be rejected as malformed.
    assert.equal(
      listProgrammesQuerySchema.parse({ departmentId: "not-a-real-id" }).departmentId,
      "not-a-real-id"
    );
  });

  it("REJECTS a type outside the enum", () => {
    // Unlike the opaque id, ProgrammeType is a closed set the API defines, so a
    // value outside it is a client error worth naming.
    assert.equal(listProgrammesQuerySchema.safeParse({ type: "NONSENSE" }).success, false);
  });

  it("rejects unreasonably long values", () => {
    assert.equal(listProgrammesQuerySchema.safeParse({ q: "x".repeat(201) }).success, false);
    assert.equal(
      listProgrammesQuerySchema.safeParse({ departmentId: "x".repeat(201) }).success,
      false
    );
  });

  it("DROPS a client-supplied tenantId and universityId", () => {
    // The tenant comes from requireTenant. This is the privilege boundary: if
    // either survived here it could reach the where clause.
    const parsed = listProgrammesQuerySchema.parse({
      q: "Computer",
      tenantId: "other-tenant",
      universityId: "other-university",
    });

    assert.equal("tenantId" in parsed, false);
    assert.equal("universityId" in parsed, false);
  });

  it("DROPS campusId and schoolId, which Programme has no column for", () => {
    // Programme carries departmentId alone; campus and school are reached only
    // through it. Asserting the drop keeps the schema and the page's actual
    // controls telling the same story.
    const parsed = listProgrammesQuerySchema.parse({ campusId: "c1", schoolId: "s1" });
    assert.equal("campusId" in parsed, false);
    assert.equal("schoolId" in parsed, false);
  });

  it("still coerces page and limit from strings", () => {
    const parsed = listProgrammesQuerySchema.parse({ page: "3", limit: "5", q: "Comp" });
    assert.equal(parsed.page, 3);
    assert.equal(parsed.limit, 5);
  });
});
