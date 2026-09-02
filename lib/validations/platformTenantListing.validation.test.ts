// ============================================================================
// TESTS: Platform tenant directory — listing query (tester issue #11).
//
// The tester reported that Search, "All Status" and "All Types" did nothing.
// They did nothing because listTenantsQuerySchema accepted page and limit ONLY,
// so Zod dropped ?q, ?status and ?type before the handler could see them — the
// controls were rendered disabled for exactly that reason.
//
// These pin the three things the route cannot check for itself:
//   1. the filters survive validation at all;
//   2. an empty value means "no restriction" rather than a 400 — which is what
//      "All statuses" and "All types" submit;
//   3. the subscriptions endpoint did NOT inherit them. It aliased this schema
//      when both were pagination-only, and SubscriptionStatus has a PAST_DUE
//      member TenantStatus does not, so inheriting would have turned
//      ?status=PAST_DUE from a dropped param into a 400.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listSubscriptionsQuerySchema, listTenantsQuerySchema } from "./platform";

describe("listTenantsQuerySchema — pagination", () => {
  it("defaults pagination and applies no filter when nothing is supplied", () => {
    const parsed = listTenantsQuerySchema.parse({});
    assert.equal(parsed.page, 1);
    assert.equal(parsed.limit, 20);
    assert.equal(parsed.q, undefined);
    assert.equal(parsed.status, undefined);
    assert.equal(parsed.type, undefined);
  });

  it("still coerces page and limit from strings", () => {
    // Search params always arrive as text.
    const parsed = listTenantsQuerySchema.parse({ page: "3", limit: "50" });
    assert.equal(parsed.page, 3);
    assert.equal(parsed.limit, 50);
  });
});

describe("listTenantsQuerySchema — search (?q)", () => {
  it("accepts a search term", () => {
    assert.equal(listTenantsQuerySchema.parse({ q: "aktu" }).q, "aktu");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(listTenantsQuerySchema.parse({ q: "  aktu  " }).q, "aktu");
  });

  it("treats an empty q as no search rather than an error", () => {
    // A bookmarked or hand-edited "?q=" is plainly a request for the whole list.
    assert.equal(listTenantsQuerySchema.parse({ q: "" }).q, undefined);
  });

  it("treats a whitespace-only q as no search", () => {
    assert.equal(listTenantsQuerySchema.parse({ q: "   " }).q, undefined);
  });

  it("preserves case, leaving case-insensitivity to the query", () => {
    // The route matches with Prisma's mode: "insensitive". Lowercasing here
    // would be a second, silent normalisation the route does not expect.
    assert.equal(listTenantsQuerySchema.parse({ q: "AKTU" }).q, "AKTU");
  });

  it("rejects an unreasonably long term", () => {
    assert.equal(listTenantsQuerySchema.safeParse({ q: "x".repeat(201) }).success, false);
  });
});

describe("listTenantsQuerySchema — status filter", () => {
  it("accepts every status the directory's dropdown offers", () => {
    // TENANT_STATUS_VALUES, which is what the ListFilter renders. ARCHIVED is
    // included deliberately: an operator must be able to find archived
    // universities, which is the only way back to the restore control.
    for (const status of ["ACTIVE", "SUSPENDED", "TRIAL", "CANCELLED", "ARCHIVED"]) {
      assert.equal(
        listTenantsQuerySchema.parse({ status }).status,
        status,
        `${status} must survive validation`
      );
    }
  });

  it('treats an empty status as "All statuses" rather than an invalid enum', () => {
    // This is the whole of what "All statuses" means. The control writes an
    // empty value, useListParams removes the key, and a hand-edited "?status="
    // must behave identically instead of answering 400.
    assert.equal(listTenantsQuerySchema.parse({ status: "" }).status, undefined);
    assert.equal(listTenantsQuerySchema.parse({ status: "   " }).status, undefined);
  });

  it("rejects a status that is not a TenantStatus", () => {
    assert.equal(listTenantsQuerySchema.safeParse({ status: "PAST_DUE" }).success, false);
    assert.equal(listTenantsQuerySchema.safeParse({ status: "active" }).success, false);
  });
});

describe("listTenantsQuerySchema — type filter", () => {
  it("accepts every institution type the dropdown offers", () => {
    for (const type of ["UNIVERSITY", "COLLEGE", "INSTITUTE", "SCHOOL"]) {
      assert.equal(listTenantsQuerySchema.parse({ type }).type, type, `${type} must survive`);
    }
  });

  it('treats an empty type as "All types" rather than an invalid enum', () => {
    assert.equal(listTenantsQuerySchema.parse({ type: "" }).type, undefined);
    assert.equal(listTenantsQuerySchema.parse({ type: "   " }).type, undefined);
  });

  it("rejects a type that is not an InstitutionType", () => {
    assert.equal(listTenantsQuerySchema.safeParse({ type: "ACADEMY" }).success, false);
  });
});

describe("listTenantsQuerySchema — combined and hostile input", () => {
  it("carries search, status and type together", () => {
    const parsed = listTenantsQuerySchema.parse({
      q: "tech",
      status: "ACTIVE",
      type: "UNIVERSITY",
      page: "2",
    });
    assert.equal(parsed.q, "tech");
    assert.equal(parsed.status, "ACTIVE");
    assert.equal(parsed.type, "UNIVERSITY");
    assert.equal(parsed.page, 2);
  });

  it("DROPS any key the schema does not name", () => {
    // The route spreads only what it destructures, but an unknown key surviving
    // validation is how a filter nobody reviewed reaches a query.
    const parsed = listTenantsQuerySchema.parse({ id: "abc", supportManagerId: "xyz" });
    assert.equal("id" in parsed, false);
    assert.equal("supportManagerId" in parsed, false);
  });
});

describe("listSubscriptionsQuerySchema — unchanged by the tenant filters", () => {
  it("accepts pagination", () => {
    const parsed = listSubscriptionsQuerySchema.parse({ page: "2", limit: "10" });
    assert.equal(parsed.page, 2);
    assert.equal(parsed.limit, 10);
  });

  it("does NOT gain the tenant directory's filters", () => {
    // The two schemas were the same object. If subscriptions ever inherits the
    // tenant `status` enum, ?status=PAST_DUE — a real SubscriptionStatus —
    // starts answering 400 on an endpoint nobody touched.
    const parsed = listSubscriptionsQuerySchema.parse({ status: "PAST_DUE", q: "x" });
    assert.equal("status" in parsed, false);
    assert.equal("q" in parsed, false);
  });
});
