// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Finance — Read Layer
// LAYER  : Validation — Unit Tests
// PURPOSE: Prove the boundary rejects what it must and accepts what it should.
//
//          The sort whitelist carries the most weight. It is the control that
//          stops a caller ordering by a column the projection withholds —
//          `gatewayRef` or `gatewayMeta` — which for a low-cardinality column
//          would let them reconstruct the value by paging.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FeeStatus, FeeType, PaymentMethod, PaymentStatus } from "@/app/generated/prisma/enums";
import {
  FEE_DEMAND_SORT_FIELDS,
  PAYMENT_SORT_FIELDS,
  paymentHistoryQuerySchema,
  pendingFeeQuerySchema,
  receiptListQuerySchema,
  receiptParamSchema,
  scholarshipQuerySchema,
} from "@/lib/validations/studentFinance.validation";

describe("the sort whitelist is a security control", () => {
  it("REJECTS ordering by a column the projection withholds", () => {
    // Ordering by a hidden column is a disclosure channel: a caller who can
    // sort by it and page through the results learns its ordering.
    for (const sortBy of ["gatewayRef", "gatewayMeta", "tenantId", "studentId"]) {
      assert.equal(
        paymentHistoryQuerySchema.safeParse({ sortBy }).success,
        false,
        sortBy
      );
    }
  });

  it("rejects an arbitrary string as a sort field", () => {
    assert.equal(paymentHistoryQuerySchema.safeParse({ sortBy: "id; DROP" }).success, false);
  });

  it("permits exactly the four payment columns and no others", () => {
    assert.deepEqual([...PAYMENT_SORT_FIELDS], ["paidAt", "createdAt", "amount", "receiptNo"]);

    for (const sortBy of PAYMENT_SORT_FIELDS) {
      assert.equal(paymentHistoryQuerySchema.safeParse({ sortBy }).success, true, sortBy);
    }
  });

  it("permits exactly the three demand columns", () => {
    assert.deepEqual([...FEE_DEMAND_SORT_FIELDS], ["dueDate", "createdAt", "totalAmount"]);

    for (const sortBy of FEE_DEMAND_SORT_FIELDS) {
      assert.equal(pendingFeeQuerySchema.safeParse({ sortBy }).success, true, sortBy);
    }
  });

  it("rejects a sort order outside asc and desc", () => {
    assert.equal(paymentHistoryQuerySchema.safeParse({ sortOrder: "random" }).success, false);
  });
});

describe("paymentHistoryQuerySchema", () => {
  it("applies sensible defaults for an empty query", () => {
    const parsed = paymentHistoryQuerySchema.safeParse({});

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.page, 1);
      assert.equal(parsed.data.limit, 20);
      assert.equal(parsed.data.sortBy, "paidAt");
      assert.equal(parsed.data.sortOrder, "desc", "a ledger is read newest first");
    }
  });

  it("coerces page and limit from strings, as search params arrive", () => {
    const parsed = paymentHistoryQuerySchema.safeParse({ page: "3", limit: "50" });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.page, 3);
      assert.equal(parsed.data.limit, 50);
    }
  });

  it("rejects a limit above the shared maximum", () => {
    // The bound is paginationQuerySchema's, not a second copy of it.
    assert.equal(paymentHistoryQuerySchema.safeParse({ limit: "101" }).success, false);
  });

  it("rejects page zero and negative pages", () => {
    assert.equal(paymentHistoryQuerySchema.safeParse({ page: "0" }).success, false);
    assert.equal(paymentHistoryQuerySchema.safeParse({ page: "-1" }).success, false);
  });

  it("accepts every payment status and method", () => {
    for (const status of Object.values(PaymentStatus)) {
      assert.equal(paymentHistoryQuerySchema.safeParse({ status }).success, true, status);
    }

    for (const method of Object.values(PaymentMethod)) {
      assert.equal(paymentHistoryQuerySchema.safeParse({ method }).success, true, method);
    }
  });

  it("rejects an unknown status or method", () => {
    assert.equal(paymentHistoryQuerySchema.safeParse({ status: "MAYBE" }).success, false);
    assert.equal(paymentHistoryQuerySchema.safeParse({ method: "BARTER" }).success, false);
  });
});

describe("search", () => {
  it("trims a term", () => {
    const parsed = paymentHistoryQuerySchema.safeParse({ search: "  RC-1  " });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.search, "RC-1");
    }
  });

  it("REJECTS an empty term rather than treating it as absent", () => {
    // "?search=" is a client bug; silently returning the unfiltered ledger
    // would hide it behind a plausible-looking response.
    assert.equal(paymentHistoryQuerySchema.safeParse({ search: "" }).success, false);
    assert.equal(paymentHistoryQuerySchema.safeParse({ search: "   " }).success, false);
  });

  it("bounds the term length", () => {
    assert.equal(paymentHistoryQuerySchema.safeParse({ search: "x".repeat(64) }).success, true);
    assert.equal(paymentHistoryQuerySchema.safeParse({ search: "x".repeat(65) }).success, false);
  });
});

describe("date range", () => {
  it("coerces ISO strings to dates", () => {
    const parsed = paymentHistoryQuerySchema.safeParse({
      dateFrom: "2025-01-01",
      dateTo: "2025-06-30",
    });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.ok(parsed.data.dateFrom instanceof Date);
      assert.ok(parsed.data.dateTo instanceof Date);
    }
  });

  it("REJECTS an inverted range", () => {
    // An inverted range matches nothing, and an empty ledger is
    // indistinguishable from a student who has never paid.
    assert.equal(
      paymentHistoryQuerySchema.safeParse({ dateFrom: "2025-06-30", dateTo: "2025-01-01" })
        .success,
      false
    );
  });

  it("accepts a range whose bounds are equal", () => {
    assert.equal(
      paymentHistoryQuerySchema.safeParse({ dateFrom: "2025-01-01", dateTo: "2025-01-01" })
        .success,
      true
    );
  });

  it("accepts a one-sided range", () => {
    assert.equal(paymentHistoryQuerySchema.safeParse({ dateFrom: "2025-01-01" }).success, true);
    assert.equal(paymentHistoryQuerySchema.safeParse({ dateTo: "2025-01-01" }).success, true);
  });

  it("rejects an unparseable date rather than passing an Invalid Date onward", () => {
    assert.equal(paymentHistoryQuerySchema.safeParse({ dateFrom: "not-a-date" }).success, false);
  });
});

describe("receiptListQuerySchema", () => {
  it("does NOT accept a status filter", () => {
    // A receipt exists only for a SUCCEEDED payment. Offering a status filter
    // would imply a receipt for a failed one can be listed.
    const parsed = receiptListQuerySchema.safeParse({ status: PaymentStatus.FAILED });

    assert.equal(parsed.success, true, "unknown keys are stripped, not rejected");
    if (parsed.success) {
      assert.equal("status" in parsed.data, false, "and the filter never reaches the query");
    }
  });

  it("still accepts method, search and a date range", () => {
    const parsed = receiptListQuerySchema.safeParse({
      method: PaymentMethod.CASH,
      search: "RC-9",
      dateFrom: "2025-01-01",
    });

    assert.equal(parsed.success, true);
  });

  it("defaults to newest first", () => {
    const parsed = receiptListQuerySchema.safeParse({});

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.sortBy, "paidAt");
      assert.equal(parsed.data.sortOrder, "desc");
    }
  });
});

describe("pendingFeeQuerySchema", () => {
  it("defaults to the soonest due date first", () => {
    // The opposite of a ledger: a student wants to know what is due next.
    const parsed = pendingFeeQuerySchema.safeParse({});

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.sortBy, "dueDate");
      assert.equal(parsed.data.sortOrder, "asc");
    }
  });

  it("accepts a semester filter and a due-date bound", () => {
    const parsed = pendingFeeQuerySchema.safeParse({
      semesterId: "sem_1",
      dueBefore: "2025-03-31",
    });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.semesterId, "sem_1");
      assert.ok(parsed.data.dueBefore instanceof Date);
    }
  });

  it("accepts every fee status", () => {
    for (const status of Object.values(FeeStatus)) {
      assert.equal(pendingFeeQuerySchema.safeParse({ status }).success, true, status);
    }
  });

  it("REJECTS an unknown key rather than stripping it", () => {
    // Strict here, unlike the list schemas: a misspelled filter on a fee list
    // would silently show a student the wrong debts.
    assert.equal(pendingFeeQuerySchema.safeParse({ semseterId: "sem_1" }).success, false);
  });

  it("rejects an empty semester id", () => {
    assert.equal(pendingFeeQuerySchema.safeParse({ semesterId: "" }).success, false);
  });
});

describe("receiptParamSchema", () => {
  it("accepts a well-formed opaque id", () => {
    assert.equal(receiptParamSchema.safeParse({ receiptId: "clx123" }).success, true);
  });

  it("accepts an UNRECOGNISED but well-formed id", () => {
    // Payment.id is an opaque cuid, so rejecting here would turn a 404 into a
    // 400 and tell a client the id was malformed when it was merely absent.
    assert.equal(receiptParamSchema.safeParse({ receiptId: "does-not-exist" }).success, true);
  });

  it("rejects an empty or whitespace-only id", () => {
    assert.equal(receiptParamSchema.safeParse({ receiptId: "" }).success, false);
    assert.equal(receiptParamSchema.safeParse({ receiptId: "   " }).success, false);
  });

  it("rejects a missing or non-string id", () => {
    assert.equal(receiptParamSchema.safeParse({}).success, false);
    assert.equal(receiptParamSchema.safeParse({ receiptId: 123 }).success, false);
  });

  it("STRIPS a supplied tenantId rather than trusting it", () => {
    const parsed = receiptParamSchema.safeParse({
      receiptId: "clx1",
      tenantId: "attacker_tenant",
      studentId: "victim",
    });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal("tenantId" in parsed.data, false);
      assert.equal("studentId" in parsed.data, false, "ownership is never client-supplied");
    }
  });
});

describe("scholarshipQuerySchema", () => {
  it("accepts an empty query", () => {
    assert.equal(scholarshipQuerySchema.safeParse({}).success, true);
  });

  it("accepts a semester and a fee type", () => {
    const parsed = scholarshipQuerySchema.safeParse({
      semesterId: "sem_1",
      feeType: FeeType.HOSTEL,
    });

    assert.equal(parsed.success, true);
  });

  it("rejects an unknown fee type", () => {
    assert.equal(scholarshipQuerySchema.safeParse({ feeType: "SCHOLARSHIP" }).success, false);
  });

  it("offers no award-name filter, because no award names are stored", () => {
    const parsed = scholarshipQuerySchema.safeParse({ name: "Merit Scholarship" });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal("name" in parsed.data, false);
    }
  });
});
