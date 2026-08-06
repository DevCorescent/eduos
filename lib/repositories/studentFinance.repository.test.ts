// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Finance — Read Layer
// LAYER  : Repository — Unit Tests
// PURPOSE: Verify what every query ASKS OF THE DATABASE.
//
//          A repository holds no logic, so "does it compute the right answer"
//          is not a meaningful question here. The meaningful questions are
//          structural, and each is a security or correctness property:
//
//            • is every query scoped by tenantId AND studentId?
//            • does a receipt lookup fold ownership into the QUERY rather than
//              checking it after the row is read?
//            • is a receipt reachable only for a SUCCEEDED payment?
//            • is the ordering total, so offset pagination cannot skip a row?
//            • are gateway internals absent from every projection?
//
//          Every method takes an injectable client, so all of it is verifiable
//          with no database and no environment.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FeeStatus, PaymentMethod, PaymentStatus } from "@/app/generated/prisma/enums";
import { FakePrismaClient } from "@/lib/repositories/testing/fakePrismaClient";
import {
  FEE_DEMAND_SELECT,
  OUTSTANDING_FEE_STATUSES,
  PAYMENT_SELECT,
  RECEIPTED_PAYMENT_STATUS,
  RECEIPT_DETAIL_SELECT,
  StudentFinanceRepository,
  type DbClient,
} from "@/lib/repositories/studentFinance.repository";

const TENANT_ID = "tenant_1";
const OTHER_TENANT = "tenant_2";
const STUDENT_ID = "student_1";
const OTHER_STUDENT = "student_2";
const RECEIPT_ID = "payment_1";

const repository = new StudentFinanceRepository();

function fake(): { client: FakePrismaClient; db: DbClient } {
  const client = new FakePrismaClient();
  return { client, db: client as unknown as DbClient };
}

function whereOf(args: Record<string, unknown>): Record<string, unknown> {
  return args.where as Record<string, unknown>;
}

const PAGE = { page: 1, limit: 20, sortOrder: "desc" as const };
const PAYMENT_PAGE = { ...PAGE, sortBy: "paidAt" as const };
const DEMAND_PAGE = { ...PAGE, sortBy: "dueDate" as const };

// --- Tenant isolation and student ownership ---------------------------------

describe("StudentFinanceRepository — tenant isolation and student ownership", () => {
  it("scopes payment history by BOTH tenant and student", async () => {
    const { client, db } = fake();

    await repository.findPaymentHistory(TENANT_ID, STUDENT_ID, PAYMENT_PAGE, db);

    const where = whereOf(client.onlyCallTo("payment", "findMany").args);

    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(where.studentId, STUDENT_ID);
  });

  it("scopes the COUNT by the identical predicate as the page", async () => {
    // A total computed under a wider predicate would describe rows the caller
    // cannot read, and a portal would page into an empty tail.
    const { client, db } = fake();

    await repository.findPaymentHistory(TENANT_ID, STUDENT_ID, PAYMENT_PAGE, db);

    assert.deepEqual(
      whereOf(client.onlyCallTo("payment", "count").args),
      whereOf(client.onlyCallTo("payment", "findMany").args)
    );
  });

  it("scopes receipts by both tenant and student", async () => {
    const { client, db } = fake();

    await repository.findReceipts(TENANT_ID, STUDENT_ID, PAYMENT_PAGE, db);

    const where = whereOf(client.onlyCallTo("payment", "findMany").args);

    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(where.studentId, STUDENT_ID);
  });

  it("scopes a single receipt lookup by both, IN THE QUERY", async () => {
    // Folded into the predicate rather than checked after the read. A caller
    // who could distinguish "found but not yours" from "not found" would learn
    // that another student's receipt exists.
    const { client, db } = fake();

    await repository.findReceiptById(TENANT_ID, STUDENT_ID, RECEIPT_ID, db);

    const where = whereOf(client.onlyCallTo("payment", "findFirst").args);

    assert.equal(where.id, RECEIPT_ID);
    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(where.studentId, STUDENT_ID);
  });

  it("scopes a receipt download by both", async () => {
    const { client, db } = fake();

    await repository.findReceiptDownload(TENANT_ID, STUDENT_ID, RECEIPT_ID, db);

    const where = whereOf(client.onlyCallTo("payment", "findFirst").args);

    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(where.studentId, STUDENT_ID);
  });

  it("scopes pending fees by both", async () => {
    const { client, db } = fake();

    await repository.findPendingFees(TENANT_ID, STUDENT_ID, DEMAND_PAGE, db);

    const where = whereOf(client.onlyCallTo("feeDemand", "findMany").args);

    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(where.studentId, STUDENT_ID);
  });

  it("scopes concessions by both", async () => {
    const { client, db } = fake();

    await repository.findScholarships(TENANT_ID, STUDENT_ID, {}, db);

    const where = whereOf(client.onlyCallTo("feeDemand", "findMany").args);

    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(where.studentId, STUDENT_ID);
  });

  it("scopes the overdue summary AND its aggregate by both", async () => {
    const { client, db } = fake();

    await repository.findFineSummary(TENANT_ID, STUDENT_ID, db);

    for (const call of [
      client.onlyCallTo("feeDemand", "findMany"),
      client.onlyCallTo("feeDemand", "aggregate"),
    ]) {
      const where = whereOf(call.args);

      assert.equal(where.tenantId, TENANT_ID);
      assert.equal(where.studentId, STUDENT_ID);
    }
  });

  it("carries the caller's OWN tenant and student, never a substituted pair", async () => {
    const { client, db } = fake();

    await repository.findPaymentHistory(OTHER_TENANT, OTHER_STUDENT, PAYMENT_PAGE, db);

    const where = whereOf(client.onlyCallTo("payment", "findMany").args);

    assert.equal(where.tenantId, OTHER_TENANT);
    assert.equal(where.studentId, OTHER_STUDENT);
  });

  it("EVERY method issues a tenant-scoped query and nothing unscoped", async () => {
    const { client, db } = fake();

    await repository.findPaymentHistory(TENANT_ID, STUDENT_ID, PAYMENT_PAGE, db);
    await repository.findReceipts(TENANT_ID, STUDENT_ID, PAYMENT_PAGE, db);
    await repository.findReceiptById(TENANT_ID, STUDENT_ID, RECEIPT_ID, db);
    await repository.findReceiptDownload(TENANT_ID, STUDENT_ID, RECEIPT_ID, db);
    await repository.findPendingFees(TENANT_ID, STUDENT_ID, DEMAND_PAGE, db);
    await repository.findScholarships(TENANT_ID, STUDENT_ID, {}, db);
    await repository.findFineSummary(TENANT_ID, STUDENT_ID, db);

    assert.ok(client.calls.length > 0);

    for (const call of client.calls) {
      const where = whereOf(call.args);

      assert.equal(where.tenantId, TENANT_ID, `${call.model}.${call.operation}`);
      assert.equal(where.studentId, STUDENT_ID, `${call.model}.${call.operation}`);
    }
  });
});

// --- Receipt semantics ------------------------------------------------------

describe("StudentFinanceRepository — a receipt requires a succeeded payment", () => {
  it("filters the receipt LIST to SUCCESS", async () => {
    const { client, db } = fake();

    await repository.findReceipts(TENANT_ID, STUDENT_ID, PAYMENT_PAGE, db);

    assert.equal(
      whereOf(client.onlyCallTo("payment", "findMany").args).status,
      PaymentStatus.SUCCESS
    );
  });

  it("filters a single receipt lookup to SUCCESS", async () => {
    // A receipt for a FAILED payment must be unreachable, not merely unrendered.
    const { client, db } = fake();

    await repository.findReceiptById(TENANT_ID, STUDENT_ID, RECEIPT_ID, db);

    assert.equal(
      whereOf(client.onlyCallTo("payment", "findFirst").args).status,
      PaymentStatus.SUCCESS
    );
  });

  it("filters a receipt download to SUCCESS", async () => {
    const { client, db } = fake();

    await repository.findReceiptDownload(TENANT_ID, STUDENT_ID, RECEIPT_ID, db);

    assert.equal(
      whereOf(client.onlyCallTo("payment", "findFirst").args).status,
      PaymentStatus.SUCCESS
    );
  });

  it("does NOT filter the payment history to SUCCESS", async () => {
    // A ledger shows failed and pending attempts; that is what a ledger is for.
    const { client, db } = fake();

    await repository.findPaymentHistory(TENANT_ID, STUDENT_ID, PAYMENT_PAGE, db);

    assert.equal(whereOf(client.onlyCallTo("payment", "findMany").args).status, undefined);
  });

  it("uses findFirst rather than findUnique, so ownership is part of the lookup", async () => {
    const { client, db } = fake();

    await repository.findReceiptById(TENANT_ID, STUDENT_ID, RECEIPT_ID, db);

    assert.equal(client.callsTo("payment", "findFirst").length, 1);
    assert.equal(client.callsTo("payment", "findUnique").length, 0);
  });

  it("returns null for a receipt that does not resolve", async () => {
    const { db } = fake();

    assert.equal(await repository.findReceiptById(TENANT_ID, STUDENT_ID, "nope", db), null);
  });
});

// --- Pagination -------------------------------------------------------------

describe("StudentFinanceRepository — pagination", () => {
  it("translates page 1 to no skip", async () => {
    const { client, db } = fake();

    await repository.findPaymentHistory(TENANT_ID, STUDENT_ID, { ...PAYMENT_PAGE, page: 1, limit: 20 }, db);

    const args = client.onlyCallTo("payment", "findMany").args;

    assert.equal(args.skip, 0);
    assert.equal(args.take, 20);
  });

  it("translates page 3 to the correct offset", async () => {
    const { client, db } = fake();

    await repository.findPaymentHistory(TENANT_ID, STUDENT_ID, { ...PAYMENT_PAGE, page: 3, limit: 25 }, db);

    const args = client.onlyCallTo("payment", "findMany").args;

    assert.equal(args.skip, 50);
    assert.equal(args.take, 25);
  });

  it("does NOT paginate the count", async () => {
    // A count with skip and take applied would report the page size, not the
    // total, and every portal would show one page.
    const { client, db } = fake();

    await repository.findPaymentHistory(TENANT_ID, STUDENT_ID, { ...PAYMENT_PAGE, page: 2 }, db);

    const args = client.onlyCallTo("payment", "count").args;

    assert.equal(args.skip, undefined);
    assert.equal(args.take, undefined);
  });

  it("paginates pending fees the same way", async () => {
    const { client, db } = fake();

    await repository.findPendingFees(TENANT_ID, STUDENT_ID, { ...DEMAND_PAGE, page: 2, limit: 10 }, db);

    const args = client.onlyCallTo("feeDemand", "findMany").args;

    assert.equal(args.skip, 10);
    assert.equal(args.take, 10);
  });

  it("returns the rows and the total together", async () => {
    const { client, db } = fake();

    client.resultFor("payment", "findMany", [{ id: "p1" }]);
    client.resultFor("payment", "count", 42);

    const page = await repository.findPaymentHistory(TENANT_ID, STUDENT_ID, PAYMENT_PAGE, db);

    assert.equal(page.rows.length, 1);
    assert.equal(page.total, 42);
  });

  it("costs exactly TWO statements per paginated read, never more", async () => {
    const { client, db } = fake();

    await repository.findPaymentHistory(TENANT_ID, STUDENT_ID, PAYMENT_PAGE, db);

    assert.equal(client.callCount, 2, "one page, one count — no per-row read");
  });

  it("costs exactly ONE statement for a receipt download", async () => {
    // The fee components travel with the payment. Reading them per component
    // would be the N+1 this layer exists to avoid.
    const { client, db } = fake();

    await repository.findReceiptDownload(TENANT_ID, STUDENT_ID, RECEIPT_ID, db);

    assert.equal(client.callCount, 1);
  });

  it("costs exactly ONE statement for concessions", async () => {
    const { client, db } = fake();

    await repository.findScholarships(TENANT_ID, STUDENT_ID, {}, db);

    assert.equal(client.callCount, 1);
  });
});

// --- Sorting ----------------------------------------------------------------

describe("StudentFinanceRepository — sorting", () => {
  it("orders by the requested field and direction", async () => {
    const { client, db } = fake();

    await repository.findPaymentHistory(
      TENANT_ID,
      STUDENT_ID,
      { ...PAYMENT_PAGE, sortBy: "amount", sortOrder: "asc" },
      db
    );

    const orderBy = client.onlyCallTo("payment", "findMany").args.orderBy as Record<string, string>[];

    assert.equal(orderBy[0].amount, "asc");
  });

  it("appends `id` so the ordering is TOTAL", async () => {
    // paidAt is nullable and duplicated across same-day payments. Without a
    // unique tiebreaker, offset pagination can skip one row and repeat another
    // between page one and page two.
    const { client, db } = fake();

    await repository.findPaymentHistory(TENANT_ID, STUDENT_ID, PAYMENT_PAGE, db);

    const orderBy = client.onlyCallTo("payment", "findMany").args.orderBy as Record<string, string>[];

    assert.equal(orderBy.length, 2);
    assert.equal(orderBy[1].id, "desc");
  });

  it("points the tiebreaker the SAME way as the primary key", async () => {
    const { client, db } = fake();

    await repository.findPaymentHistory(
      TENANT_ID,
      STUDENT_ID,
      { ...PAYMENT_PAGE, sortOrder: "asc" },
      db
    );

    const orderBy = client.onlyCallTo("payment", "findMany").args.orderBy as Record<string, string>[];

    assert.equal(orderBy[1].id, "asc");
  });

  it("orders pending fees by the requested field, with a tiebreaker", async () => {
    const { client, db } = fake();

    await repository.findPendingFees(
      TENANT_ID,
      STUDENT_ID,
      { ...DEMAND_PAGE, sortBy: "totalAmount", sortOrder: "asc" },
      db
    );

    const orderBy = client.onlyCallTo("feeDemand", "findMany").args.orderBy as Record<string, string>[];

    assert.equal(orderBy[0].totalAmount, "asc");
    assert.equal(orderBy[1].id, "asc");
  });

  it("orders the overdue summary oldest due date first", async () => {
    const { client, db } = fake();

    await repository.findFineSummary(TENANT_ID, STUDENT_ID, db);

    const orderBy = client.onlyCallTo("feeDemand", "findMany").args.orderBy as Record<string, string>[];

    assert.equal(orderBy[0].dueDate, "asc");
    assert.equal(orderBy[1].id, "asc");
  });
});

// --- Filters and search -----------------------------------------------------

describe("StudentFinanceRepository — filters and search", () => {
  it("omits a filter entirely when it was not supplied", async () => {
    // An undefined value written into `where` would be a predicate Prisma has
    // to interpret; omitting the key is the only way to mean "no filter".
    const { client, db } = fake();

    await repository.findPaymentHistory(TENANT_ID, STUDENT_ID, PAYMENT_PAGE, db);

    const where = whereOf(client.onlyCallTo("payment", "findMany").args);

    assert.equal("method" in where, false);
    assert.equal("paidAt" in where, false);
    assert.equal("OR" in where, false);
  });

  it("applies a method filter", async () => {
    const { client, db } = fake();

    await repository.findPaymentHistory(
      TENANT_ID,
      STUDENT_ID,
      { ...PAYMENT_PAGE, method: PaymentMethod.UPI },
      db
    );

    assert.equal(whereOf(client.onlyCallTo("payment", "findMany").args).method, PaymentMethod.UPI);
  });

  it("applies a date range as a bounded predicate", async () => {
    const { client, db } = fake();
    const dateFrom = new Date("2025-01-01");
    const dateTo = new Date("2025-06-30");

    await repository.findPaymentHistory(
      TENANT_ID,
      STUDENT_ID,
      { ...PAYMENT_PAGE, dateFrom, dateTo },
      db
    );

    const paidAt = whereOf(client.onlyCallTo("payment", "findMany").args).paidAt as Record<
      string,
      Date
    >;

    assert.equal(paidAt.gte, dateFrom);
    assert.equal(paidAt.lte, dateTo);
  });

  it("applies a one-sided date range", async () => {
    const { client, db } = fake();
    const dateFrom = new Date("2025-01-01");

    await repository.findPaymentHistory(TENANT_ID, STUDENT_ID, { ...PAYMENT_PAGE, dateFrom }, db);

    const paidAt = whereOf(client.onlyCallTo("payment", "findMany").args).paidAt as Record<
      string,
      Date
    >;

    assert.equal(paidAt.gte, dateFrom);
    assert.equal("lte" in paidAt, false);
  });

  it("searches receipt number and transaction id, and NOT remarks", async () => {
    // Remarks is free text an administrator wrote and may name other people.
    const { client, db } = fake();

    await repository.findPaymentHistory(TENANT_ID, STUDENT_ID, { ...PAYMENT_PAGE, search: "RC-99" }, db);

    const or = whereOf(client.onlyCallTo("payment", "findMany").args).OR as Record<
      string,
      Record<string, string>
    >[];

    assert.equal(or.length, 2);
    assert.equal(or[0].receiptNo.contains, "RC-99");
    assert.equal(or[0].receiptNo.mode, "insensitive");
    assert.equal(or[1].transactionId.contains, "RC-99");
    assert.ok(!or.some((clause) => "remarks" in clause));
  });

  it("keeps the tenant predicate ALONGSIDE the search OR, not inside it", async () => {
    // An OR that swallowed the tenant predicate would make every tenant's
    // receipts searchable. This is the single most dangerous shape in the file.
    const { client, db } = fake();

    await repository.findPaymentHistory(TENANT_ID, STUDENT_ID, { ...PAYMENT_PAGE, search: "x" }, db);

    const where = whereOf(client.onlyCallTo("payment", "findMany").args);

    assert.equal(where.tenantId, TENANT_ID);
    assert.equal(where.studentId, STUDENT_ID);
  });
});

// --- Pending fees, concessions and overdue ----------------------------------

describe("StudentFinanceRepository — pending fees", () => {
  it("restricts to the outstanding statuses", async () => {
    const { client, db } = fake();

    await repository.findPendingFees(TENANT_ID, STUDENT_ID, DEMAND_PAGE, db);

    const status = whereOf(client.onlyCallTo("feeDemand", "findMany").args).status as {
      in: string[];
    };

    assert.deepEqual(status.in, [...OUTSTANDING_FEE_STATUSES]);
  });

  it("EXCLUDES paid and waived demands", async () => {
    const admitted = new Set<string>(OUTSTANDING_FEE_STATUSES);

    assert.equal(admitted.has(FeeStatus.PAID), false);
    assert.equal(admitted.has(FeeStatus.WAIVED), false, "a waiver is settled, not outstanding");
  });

  it("narrows WITHIN the outstanding set rather than replacing it", async () => {
    // A caller must not be able to ask findPendingFees for PAID demands.
    const { client, db } = fake();

    await repository.findPendingFees(
      TENANT_ID,
      STUDENT_ID,
      { ...DEMAND_PAGE, status: FeeStatus.OVERDUE },
      db
    );

    const status = whereOf(client.onlyCallTo("feeDemand", "findMany").args).status as {
      in: string[];
    };

    assert.deepEqual(status.in, [FeeStatus.OVERDUE]);
  });

  it("yields an EMPTY set for a status outside the outstanding ones", async () => {
    const { client, db } = fake();

    await repository.findPendingFees(
      TENANT_ID,
      STUDENT_ID,
      { ...DEMAND_PAGE, status: FeeStatus.PAID },
      db
    );

    const status = whereOf(client.onlyCallTo("feeDemand", "findMany").args).status as {
      in: string[];
    };

    assert.deepEqual(status.in, [], "asking for PAID returns nothing rather than everything");
  });

  it("applies a semester filter and a due-date bound", async () => {
    const { client, db } = fake();
    const dueBefore = new Date("2025-03-31");

    await repository.findPendingFees(
      TENANT_ID,
      STUDENT_ID,
      { ...DEMAND_PAGE, semesterId: "sem_1", dueBefore },
      db
    );

    const where = whereOf(client.onlyCallTo("feeDemand", "findMany").args);

    assert.equal(where.semesterId, "sem_1");
    assert.deepEqual(where.dueDate, { lte: dueBefore });
  });
});

describe("StudentFinanceRepository — concessions", () => {
  it("selects only demands carrying a WAIVER", async () => {
    // The predicate that makes this a concession list at all.
    const { client, db } = fake();

    await repository.findScholarships(TENANT_ID, STUDENT_ID, {}, db);

    assert.deepEqual(
      whereOf(client.onlyCallTo("feeDemand", "findMany").args).waivedAmount,
      { gt: 0 }
    );
  });

  it("applies a semester filter", async () => {
    const { client, db } = fake();

    await repository.findScholarships(TENANT_ID, STUDENT_ID, { semesterId: "sem_2" }, db);

    assert.equal(whereOf(client.onlyCallTo("feeDemand", "findMany").args).semesterId, "sem_2");
  });

  it("filters by fee type through the structure's components", async () => {
    const { client, db } = fake();

    await repository.findScholarships(TENANT_ID, STUDENT_ID, { feeType: "HOSTEL" }, db);

    assert.deepEqual(whereOf(client.onlyCallTo("feeDemand", "findMany").args).feeStructure, {
      components: { some: { type: "HOSTEL" } },
    });
  });

  it("is not paginated — a concession list is bounded by the demands raised", async () => {
    const { client, db } = fake();

    await repository.findScholarships(TENANT_ID, STUDENT_ID, {}, db);

    const args = client.onlyCallTo("feeDemand", "findMany").args;

    assert.equal(args.skip, undefined);
    assert.equal(args.take, undefined);
  });
});

describe("StudentFinanceRepository — overdue summary", () => {
  it("restricts to OVERDUE demands", async () => {
    const { client, db } = fake();

    await repository.findFineSummary(TENANT_ID, STUDENT_ID, db);

    assert.equal(
      whereOf(client.onlyCallTo("feeDemand", "findMany").args).status,
      FeeStatus.OVERDUE
    );
  });

  it("sums IN THE DATABASE rather than adding rows in application code", async () => {
    // Summing here would be arithmetic, which this layer does not do — and
    // would require reading every row to add it up.
    const { client, db } = fake();

    await repository.findFineSummary(TENANT_ID, STUDENT_ID, db);

    const args = client.onlyCallTo("feeDemand", "aggregate").args;

    assert.deepEqual(args._count, { _all: true });
    assert.deepEqual(args._sum, { totalAmount: true, paidAmount: true, waivedAmount: true });
  });

  it("costs exactly TWO statements however many demands are overdue", async () => {
    const { client, db } = fake();

    client.resultFor(
      "feeDemand",
      "findMany",
      Array.from({ length: 200 }, (_value, index) => ({ id: `demand_${index}` }))
    );

    await repository.findFineSummary(TENANT_ID, STUDENT_ID, db);

    assert.equal(client.callCount, 2);
  });

  it("returns the rows and the totals together", async () => {
    const { client, db } = fake();

    client.resultFor("feeDemand", "findMany", [{ id: "d1" }]);
    client.resultFor("feeDemand", "aggregate", {
      _count: { _all: 1 },
      _sum: { totalAmount: null, paidAmount: null, waivedAmount: null },
    });

    const summary = await repository.findFineSummary(TENANT_ID, STUDENT_ID, db);

    assert.equal(summary.rows.length, 1);
    assert.equal(summary.totals._count._all, 1);
  });
});

// --- Projections ------------------------------------------------------------

describe("StudentFinanceRepository — projections withhold gateway internals", () => {
  it("NEVER projects gatewayRef or gatewayMeta", async () => {
    // gatewayMeta is an unbounded JSON blob written by the payment provider.
    // Projecting a column whose contents nobody can enumerate is how card
    // metadata reaches a browser.
    assert.equal("gatewayRef" in PAYMENT_SELECT, false);
    assert.equal("gatewayMeta" in PAYMENT_SELECT, false);
    assert.equal("gatewayRef" in RECEIPT_DETAIL_SELECT, false);
    assert.equal("gatewayMeta" in RECEIPT_DETAIL_SELECT, false);
  });

  it("does not project the student or tenant relation", async () => {
    // A finance projection has no business carrying a student's personal
    // details; the caller already knows which student it asked about.
    assert.equal("student" in PAYMENT_SELECT, false);
    assert.equal("student" in FEE_DEMAND_SELECT, false);
  });

  it("carries the receipt number every receipt is identified by", () => {
    assert.equal(PAYMENT_SELECT.receiptNo, true);
  });

  it("carries the three money columns separately, un-subtracted", () => {
    // The outstanding figure is a calculation, and this layer does none.
    assert.equal(FEE_DEMAND_SELECT.totalAmount, true);
    assert.equal(FEE_DEMAND_SELECT.paidAmount, true);
    assert.equal(FEE_DEMAND_SELECT.waivedAmount, true);
  });

  it("nests fee components INSIDE the download projection", async () => {
    const { client, db } = fake();

    await repository.findReceiptDownload(TENANT_ID, STUDENT_ID, RECEIPT_ID, db);

    const select = client.onlyCallTo("payment", "findFirst").args.select as Record<string, unknown>;

    assert.ok("feeDemand" in select, "the demand travels with the payment");
  });

  it("names SUCCESS as the only receipted status", () => {
    assert.equal(RECEIPTED_PAYMENT_STATUS, PaymentStatus.SUCCESS);
  });
});
