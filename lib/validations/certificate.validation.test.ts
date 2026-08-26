// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Certificate Collection
// LAYER  : Validation — Unit Tests
// PURPOSE: Pin the query contract of GET /api/certificates, the tenant-wide
//          collection added to close the "None issued yet" defect.
//
// WHY THESE ASSERTIONS AND NOT OTHERS
//   The screen that reads this endpoint renders a search box and sends ?q. If
//   the schema silently dropped that parameter the box would appear to work and
//   would return every certificate in the university for any search term — a
//   worse failure than rejecting it, because it looks like an answer. So the
//   presence of q is asserted, not assumed.
//
//   The tenant is deliberately NOT part of this schema and must never become
//   part of it: it comes from requireTenant, and a certificate collection that
//   accepted a caller's tenantId would be a cross-tenant read waiting to
//   happen. The last test pins that.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { listCertificatesQuerySchema } from "@/lib/validations/certificate";

describe("listCertificatesQuerySchema — GET /api/certificates", () => {
  it("defaults page and limit from the shared pagination contract", () => {
    const parsed = listCertificatesQuerySchema.safeParse({});

    assert.equal(parsed.success, true);
    assert.ok(parsed.success);
    assert.equal(parsed.data.page, 1);
    assert.ok(parsed.data.limit > 0);
    assert.equal(parsed.data.q, undefined);
  });

  it("accepts and trims a search term", () => {
    const parsed = listCertificatesQuerySchema.safeParse({ q: "  CERT-2026  " });

    assert.ok(parsed.success);
    assert.equal(parsed.data.q, "CERT-2026");
  });

  it("REJECTS an empty search term rather than treating it as 'match everything'", () => {
    // ?q= is what an untouched search box submits. Accepting it as a real term
    // would make the route filter on the empty string; rejecting it keeps the
    // route's two meanings — "no search" and "this search" — distinct.
    assert.equal(listCertificatesQuerySchema.safeParse({ q: "" }).success, false);
    assert.equal(listCertificatesQuerySchema.safeParse({ q: "   " }).success, false);
  });

  it("REJECTS an unbounded search term", () => {
    assert.equal(listCertificatesQuerySchema.safeParse({ q: "x".repeat(201) }).success, false);
    assert.equal(listCertificatesQuerySchema.safeParse({ q: "x".repeat(200) }).success, true);
  });

  it("REJECTS a malformed page or limit — the same 400 every collection gives", () => {
    assert.equal(listCertificatesQuerySchema.safeParse({ page: "abc" }).success, false);
    assert.equal(listCertificatesQuerySchema.safeParse({ page: 0 }).success, false);
    assert.equal(listCertificatesQuerySchema.safeParse({ limit: 99999 }).success, false);
  });

  it("accepts a numeric string, because a query string carries no numbers", () => {
    const parsed = listCertificatesQuerySchema.safeParse({ page: "2", limit: "5" });

    assert.ok(parsed.success);
    assert.equal(parsed.data.page, 2);
    assert.equal(parsed.data.limit, 5);
  });

  it("NEVER accepts a tenantId — the tenant comes from requireTenant alone", () => {
    // Not merely ignored: the parsed result must not carry it, so no handler can
    // reach for one by accident.
    const parsed = listCertificatesQuerySchema.safeParse({ tenantId: "another_university" });

    assert.ok(parsed.success);
    assert.equal("tenantId" in parsed.data, false);
  });

  it("NEVER accepts a studentId — that is the per-student route's key, not this one's", () => {
    const parsed = listCertificatesQuerySchema.safeParse({ studentId: "student_1" });

    assert.ok(parsed.success);
    assert.equal("studentId" in parsed.data, false);
  });
});
