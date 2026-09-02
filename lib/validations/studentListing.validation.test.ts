// ============================================================================
// TESTS: Student listing query (tester issue #23).
//
// The tester reported that neither the search box nor any filter on the
// Students page changed the results. listStudentsQuerySchema was
// `paginationQuerySchema`, so Zod dropped ?q, ?status, ?programmeId and
// ?batchId before the handler saw them, and the route read every student in the
// tenant. The controls were rendered disabled with an explanation for exactly
// that reason; the schema and the route now accept them.
//
// These pin what the route cannot check for itself: the four parameters survive
// validation, "All …" removes the corresponding restriction rather than
// answering 400, only real StudentStatus members are accepted, and no fifth
// filter was invented.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listStudentsQuerySchema } from "./student";

describe("listStudentsQuerySchema — pagination", () => {
  it("defaults pagination and applies no filter when nothing is supplied", () => {
    const parsed = listStudentsQuerySchema.parse({});
    assert.equal(parsed.page, 1);
    assert.equal(parsed.limit, 20);
    assert.equal(parsed.q, undefined);
    assert.equal(parsed.status, undefined);
    assert.equal(parsed.programmeId, undefined);
    assert.equal(parsed.batchId, undefined);
  });

  it("still coerces page and limit from strings", () => {
    const parsed = listStudentsQuerySchema.parse({ page: "4", limit: "10" });
    assert.equal(parsed.page, 4);
    assert.equal(parsed.limit, 10);
  });
});

describe("listStudentsQuerySchema — search (?q)", () => {
  it("accepts a search term", () => {
    assert.equal(listStudentsQuerySchema.parse({ q: "priya" }).q, "priya");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(listStudentsQuerySchema.parse({ q: "  ENR-001  " }).q, "ENR-001");
  });

  it("treats an empty q as no search rather than an error", () => {
    assert.equal(listStudentsQuerySchema.parse({ q: "" }).q, undefined);
  });

  it("treats a whitespace-only q as no search", () => {
    assert.equal(listStudentsQuerySchema.parse({ q: "   " }).q, undefined);
  });

  it("preserves case, leaving case-insensitivity to the query", () => {
    assert.equal(listStudentsQuerySchema.parse({ q: "PRIYA" }).q, "PRIYA");
  });

  it("rejects an unreasonably long term", () => {
    assert.equal(listStudentsQuerySchema.safeParse({ q: "x".repeat(201) }).success, false);
  });
});

describe("listStudentsQuerySchema — status filter", () => {
  it("accepts every status the dropdown offers", () => {
    // STUDENT_STATUS_VALUES, which is what the ListFilter renders.
    for (const status of [
      "ACTIVE",
      "INACTIVE",
      "GRADUATED",
      "WITHDRAWN",
      "SUSPENDED",
      "ON_LEAVE",
      "TRANSFERRED",
    ]) {
      assert.equal(
        listStudentsQuerySchema.parse({ status }).status,
        status,
        `${status} must survive validation`
      );
    }
  });

  it('treats an empty status as "All statuses" rather than an invalid enum', () => {
    assert.equal(listStudentsQuerySchema.parse({ status: "" }).status, undefined);
    assert.equal(listStudentsQuerySchema.parse({ status: "   " }).status, undefined);
  });

  it("rejects a status that is not a StudentStatus", () => {
    assert.equal(listStudentsQuerySchema.safeParse({ status: "EXPELLED" }).success, false);
    assert.equal(listStudentsQuerySchema.safeParse({ status: "active" }).success, false);
  });
});

describe("listStudentsQuerySchema — programme and batch filters", () => {
  it("accepts both ids", () => {
    const parsed = listStudentsQuerySchema.parse({ programmeId: "prog_1", batchId: "batch_1" });
    assert.equal(parsed.programmeId, "prog_1");
    assert.equal(parsed.batchId, "batch_1");
  });

  it('treats an empty id as "All …" rather than an error', () => {
    const parsed = listStudentsQuerySchema.parse({ programmeId: "", batchId: "  " });
    assert.equal(parsed.programmeId, undefined);
    assert.equal(parsed.batchId, undefined);
  });

  it("asserts no id format, so an unknown id is an empty result and not a 400", () => {
    assert.equal(listStudentsQuerySchema.safeParse({ batchId: "not-a-cuid" }).success, true);
  });
});

describe("listStudentsQuerySchema — combined and hostile input", () => {
  it("carries search and all three filters together", () => {
    // The Students screen supports combined filtering; the route ANDs each
    // present filter into one predicate.
    const parsed = listStudentsQuerySchema.parse({
      q: "priya",
      status: "ACTIVE",
      programmeId: "prog_1",
      batchId: "batch_1",
      page: "2",
    });
    assert.equal(parsed.q, "priya");
    assert.equal(parsed.status, "ACTIVE");
    assert.equal(parsed.programmeId, "prog_1");
    assert.equal(parsed.batchId, "batch_1");
    assert.equal(parsed.page, 2);
  });

  it("DROPS a client-supplied tenantId", () => {
    const parsed = listStudentsQuerySchema.parse({ tenantId: "other-tenant" });
    assert.equal("tenantId" in parsed, false);
  });

  it("invents no filter the screen does not offer", () => {
    // sectionId, specialisationId and currentSemester are real Student columns,
    // but no control offers them. Accepting them here would be a capability
    // nothing asked for and nothing renders.
    const parsed = listStudentsQuerySchema.parse({
      sectionId: "sec_1",
      specialisationId: "spec_1",
      currentSemester: "3",
    });
    assert.equal("sectionId" in parsed, false);
    assert.equal("specialisationId" in parsed, false);
    assert.equal("currentSemester" in parsed, false);
  });
});
