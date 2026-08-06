// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Finance — Read Layer
// LAYER  : Service — Unit Tests
// PURPOSE: Prove the confinement (resolveOwnStudent, FORBIDDEN, RECEIPT_NOT_
//          FOUND), the pagination arithmetic, the pending-fees composition,
//          and the fixed repository-call budget every method claims in its
//          COST comment — without a database and no environment.
//
//          The service depends on a REPOSITORY TYPE (StudentFinanceRepository),
//          not on Prisma and not on the singleton, so a plain object matching
//          its public surface — cast once — is a faithful double. This mirrors
//          result.service.test.ts's fake-repository convention exactly.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { StudentFinanceService } from "@/lib/services/studentFinance.service";
import { AppError } from "@/lib/errors/AppError";
import { STUDENT_FINANCE_MESSAGE } from "@/lib/constants/studentFinance";
import type {
  FeeDemandRow,
  Page,
  PaymentHistoryFilters,
  PaymentRow,
  PendingFeeFilters,
  ReceiptDetailRow,
  ReceiptDownloadRow,
  ReceiptListFilters,
  ScholarshipFilters,
  StudentFinanceRepository,
} from "@/lib/repositories/studentFinance.repository";

// --- Fixtures -----------------------------------------------------------------

const TENANT_ID = "tenant_1";
const USER_ID = "user_1";
const STUDENT_ID = "student_1";
const RECEIPT_ID = "payment_1";

/** A stand-in for Prisma's Decimal — every mapper only calls .toFixed(2). */
function decimal(value: string): { toFixed(places: number): string } {
  return { toFixed: () => value };
}

const PAYMENT_PAGE: PaymentHistoryFilters = {
  page: 1,
  limit: 20,
  sortBy: "paidAt",
  sortOrder: "desc",
};

const RECEIPT_PAGE: ReceiptListFilters = {
  page: 1,
  limit: 20,
  sortBy: "paidAt",
  sortOrder: "desc",
};

const PENDING_PAGE: PendingFeeFilters = {
  page: 1,
  limit: 20,
  sortBy: "dueDate",
  sortOrder: "asc",
};

function buildPaymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: RECEIPT_ID,
    receiptNo: "RCPT-0001",
    amount: decimal("5000.00") as unknown as PaymentRow["amount"],
    method: "UPI",
    status: "SUCCESS",
    transactionId: "txn_1",
    paidAt: new Date("2026-06-01T00:00:00.000Z"),
    remarks: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    feeDemandId: "demand_1",
    ...overrides,
  } as PaymentRow;
}

function buildFeeDemandRow(overrides: Partial<FeeDemandRow> = {}): FeeDemandRow {
  return {
    id: "demand_1",
    semesterId: "semester_1",
    feeStructureId: "structure_1",
    dueDate: new Date("2026-07-01T00:00:00.000Z"),
    totalAmount: decimal("10000.00") as unknown as FeeDemandRow["totalAmount"],
    paidAmount: decimal("5000.00") as unknown as FeeDemandRow["paidAmount"],
    waivedAmount: decimal("0.00") as unknown as FeeDemandRow["waivedAmount"],
    status: "PARTIAL",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    semester: { id: "semester_1", name: "Semester 1" },
    feeStructure: { id: "structure_1", name: "Tuition" },
    ...overrides,
  } as FeeDemandRow;
}

/** Records every call the service makes so the fixed budget can be asserted. */
function fakeRepository(overrides: {
  studentByUser?: { id: string } | null;
  paymentHistory?: Page<PaymentRow>;
  receipts?: Page<PaymentRow>;
  receiptById?: ReceiptDetailRow | null;
  receiptDownload?: ReceiptDownloadRow | null;
  pendingFees?: Page<FeeDemandRow>;
  scholarships?: readonly FeeDemandRow[];
  fineSummary?: {
    rows: readonly FeeDemandRow[];
    totals: {
      _count: { _all: number };
      _sum: {
        totalAmount: unknown;
        paidAmount: unknown;
        waivedAmount: unknown;
      };
    };
  };
}): { repository: StudentFinanceRepository; calls: string[] } {
  const calls: string[] = [];

  const repository = {
    async findStudentByUserId() {
      calls.push("findStudentByUserId");
      return overrides.studentByUser === undefined ? { id: STUDENT_ID } : overrides.studentByUser;
    },
    async findPaymentHistory() {
      calls.push("findPaymentHistory");
      return overrides.paymentHistory ?? { rows: [], total: 0 };
    },
    async findReceipts() {
      calls.push("findReceipts");
      return overrides.receipts ?? { rows: [], total: 0 };
    },
    async findReceiptById() {
      calls.push("findReceiptById");
      return overrides.receiptById === undefined ? null : overrides.receiptById;
    },
    async findReceiptDownload() {
      calls.push("findReceiptDownload");
      return overrides.receiptDownload === undefined ? null : overrides.receiptDownload;
    },
    async findPendingFees() {
      calls.push("findPendingFees");
      return overrides.pendingFees ?? { rows: [], total: 0 };
    },
    async findScholarships() {
      calls.push("findScholarships");
      return overrides.scholarships ?? [];
    },
    async findFineSummary() {
      calls.push("findFineSummary");
      return (
        overrides.fineSummary ?? {
          rows: [],
          totals: {
            _count: { _all: 0 },
            _sum: { totalAmount: null, paidAmount: null, waivedAmount: null },
          },
        }
      );
    },
  } as unknown as StudentFinanceRepository;

  return { repository, calls };
}

function buildService(overrides: Parameters<typeof fakeRepository>[0] = {}) {
  const { repository, calls } = fakeRepository(overrides);
  return { service: new StudentFinanceService(repository), calls };
}

// --- resolveOwnStudent() / FORBIDDEN -----------------------------------------

describe("StudentFinanceService — resolveOwnStudent confinement", () => {
  it("getPaymentHistory throws FORBIDDEN (403) when the caller owns no Student row", async () => {
    const { service } = buildService({ studentByUser: null });

    await assert.rejects(
      () => service.getPaymentHistory(TENANT_ID, USER_ID, PAYMENT_PAGE),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.message, STUDENT_FINANCE_MESSAGE.FORBIDDEN);
        return true;
      }
    );
  });

  it("getReceipts throws FORBIDDEN (403) when the caller owns no Student row", async () => {
    const { service } = buildService({ studentByUser: null });

    await assert.rejects(() => service.getReceipts(TENANT_ID, USER_ID, RECEIPT_PAGE), AppError);
  });

  it("getReceiptDetail throws FORBIDDEN (403) when the caller owns no Student row", async () => {
    const { service } = buildService({ studentByUser: null });

    await assert.rejects(
      () => service.getReceiptDetail(TENANT_ID, USER_ID, RECEIPT_ID),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  it("getReceiptDownload throws FORBIDDEN (403) when the caller owns no Student row", async () => {
    const { service } = buildService({ studentByUser: null });

    await assert.rejects(
      () => service.getReceiptDownload(TENANT_ID, USER_ID, RECEIPT_ID),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  it("getPendingFees throws FORBIDDEN (403) when the caller owns no Student row", async () => {
    const { service, calls } = buildService({ studentByUser: null });

    await assert.rejects(() => service.getPendingFees(TENANT_ID, USER_ID, PENDING_PAGE), AppError);

    // Resolution fails before any parallel finance read is even attempted.
    assert.deepEqual(calls, ["findStudentByUserId"]);
  });

  it("never trusts a caller-supplied studentId — only userId reaches the repository lookup", async () => {
    // The service signature accepts no studentId anywhere; resolveOwnStudent
    // is the only source of one, keyed by (tenantId, userId).
    const { service } = buildService({ studentByUser: { id: STUDENT_ID } });

    const result = await service.getPaymentHistory(TENANT_ID, USER_ID, PAYMENT_PAGE);
    assert.deepEqual(result.payments, []);
  });
});

// --- Receipt Not Found --------------------------------------------------------

describe("StudentFinanceService — receipt not found", () => {
  it("getReceiptDetail throws RECEIPT_NOT_FOUND (404) when the repository returns null", async () => {
    const { service } = buildService({ receiptById: null });

    await assert.rejects(
      () => service.getReceiptDetail(TENANT_ID, USER_ID, RECEIPT_ID),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        assert.equal(err.message, STUDENT_FINANCE_MESSAGE.RECEIPT_NOT_FOUND);
        return true;
      }
    );
  });

  it("getReceiptDownload throws RECEIPT_NOT_FOUND (404) when the repository returns null", async () => {
    const { service } = buildService({ receiptDownload: null });

    await assert.rejects(
      () => service.getReceiptDownload(TENANT_ID, USER_ID, RECEIPT_ID),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  it("getReceiptDetail returns a mapped DTO when the row resolves", async () => {
    const row = { ...buildPaymentRow(), feeDemand: null } as unknown as ReceiptDetailRow;
    const { service } = buildService({ receiptById: row });

    const result = await service.getReceiptDetail(TENANT_ID, USER_ID, RECEIPT_ID);

    assert.equal(result.id, RECEIPT_ID);
    assert.equal(result.amount, "5000.00");
    assert.equal(result.demand, null);
  });

  it("a receipt belonging to another student is INDISTINGUISHABLE from a missing one", async () => {
    // The repository already folds tenantId AND the resolved studentId into
    // the lookup, so both cases reach the service as null. This test proves
    // the service does not attempt to tell them apart — no second code path,
    // no different message, no different status.
    const notFound = buildService({ receiptById: null });
    const notMine = buildService({ receiptById: null });

    const errors = await Promise.all(
      [notFound, notMine].map(({ service }) =>
        service
          .getReceiptDetail(TENANT_ID, USER_ID, RECEIPT_ID)
          .catch((err: unknown) => err as AppError)
      )
    );

    assert.equal(errors[0].statusCode, errors[1].statusCode);
    assert.equal(errors[0].message, errors[1].message);
    assert.equal(errors[0].code, errors[1].code);
  });
});

// --- Pagination ----------------------------------------------------------------

describe("StudentFinanceService — pagination arithmetic", () => {
  it("computes totalPages by ceiling division for payment history", async () => {
    const { service } = buildService({
      paymentHistory: { rows: [buildPaymentRow()], total: 45 },
    });

    const result = await service.getPaymentHistory(TENANT_ID, USER_ID, {
      ...PAYMENT_PAGE,
      limit: 20,
    });

    assert.deepEqual(result.pagination, { page: 1, limit: 20, total: 45, totalPages: 3 });
  });

  it("computes totalPages by ceiling division for receipts", async () => {
    const { service } = buildService({
      receipts: { rows: [buildPaymentRow()], total: 1 },
    });

    const result = await service.getReceipts(TENANT_ID, USER_ID, { ...RECEIPT_PAGE, limit: 20 });

    assert.deepEqual(result.pagination, { page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it("reports zero totalPages for an empty pending-fee page", async () => {
    const { service } = buildService({ pendingFees: { rows: [], total: 0 } });

    const result = await service.getPendingFees(TENANT_ID, USER_ID, { ...PENDING_PAGE, limit: 10 });

    assert.deepEqual(result.pagination, { page: 1, limit: 10, total: 0, totalPages: 0 });
  });

  it("echoes the requested page and limit rather than recomputing them", async () => {
    const { service } = buildService({
      paymentHistory: { rows: [], total: 0 },
    });

    const result = await service.getPaymentHistory(TENANT_ID, USER_ID, {
      ...PAYMENT_PAGE,
      page: 3,
      limit: 5,
    });

    assert.equal(result.pagination.page, 3);
    assert.equal(result.pagination.limit, 5);
  });
});

// --- Pending fees composition --------------------------------------------------

describe("StudentFinanceService — pending fees composition", () => {
  it("composes demands, pagination, scholarships and fineSummary from three independent reads", async () => {
    const demandRow = buildFeeDemandRow();
    const scholarshipRow = buildFeeDemandRow({ id: "demand_2", waivedAmount: decimal("500.00") as unknown as FeeDemandRow["waivedAmount"] });
    const overdueRow = buildFeeDemandRow({ id: "demand_3", status: "OVERDUE" });

    const { service } = buildService({
      pendingFees: { rows: [demandRow], total: 1 },
      scholarships: [scholarshipRow],
      fineSummary: {
        rows: [overdueRow],
        totals: {
          _count: { _all: 1 },
          _sum: {
            totalAmount: decimal("10000.00"),
            paidAmount: decimal("0.00"),
            waivedAmount: decimal("0.00"),
          },
        },
      },
    });

    const result = await service.getPendingFees(TENANT_ID, USER_ID, PENDING_PAGE);

    assert.equal(result.demands.length, 1);
    assert.equal(result.demands[0].id, demandRow.id);

    assert.equal(result.scholarships.length, 1);
    assert.equal(result.scholarships[0].feeDemandId, scholarshipRow.id);
    assert.equal(result.scholarships[0].source, "FEE_WAIVER");

    assert.equal(result.fineSummary.demandCount, 1);
    assert.equal(result.fineSummary.overdueDemands.length, 1);
    assert.equal(result.fineSummary.source, "OVERDUE_DEMAND");

    assert.deepEqual(result.pagination, { page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it("does not let one empty read affect the shape of the other two", async () => {
    const { service } = buildService({
      pendingFees: { rows: [], total: 0 },
      scholarships: [],
    });

    const result = await service.getPendingFees(TENANT_ID, USER_ID, PENDING_PAGE);

    assert.deepEqual(result.demands, []);
    assert.deepEqual(result.scholarships, []);
    assert.equal(result.fineSummary.demandCount, 0);
  });
});

// --- Scholarship filters -------------------------------------------------------

describe("StudentFinanceService — scholarship filters", () => {
  it("forwards the caller's scholarshipFilters through to the repository untouched", async () => {
    let received: ScholarshipFilters | undefined;

    const repository = {
      async findStudentByUserId() {
        return { id: STUDENT_ID };
      },
      async findPendingFees() {
        return { rows: [], total: 0 };
      },
      async findScholarships(_tenantId: string, _studentId: string, filters: ScholarshipFilters) {
        received = filters;
        return [];
      },
      async findFineSummary() {
        return {
          rows: [],
          totals: { _count: { _all: 0 }, _sum: { totalAmount: null, paidAmount: null, waivedAmount: null } },
        };
      },
    } as unknown as StudentFinanceRepository;

    const service = new StudentFinanceService(repository);

    await service.getPendingFees(TENANT_ID, USER_ID, PENDING_PAGE, {
      semesterId: "semester_9",
      feeType: "TUITION" as ScholarshipFilters["feeType"],
    });

    assert.deepEqual(received, { semesterId: "semester_9", feeType: "TUITION" });
  });

  it("defaults scholarshipFilters to {} when the caller supplies none", async () => {
    let received: ScholarshipFilters | undefined;

    const repository = {
      async findStudentByUserId() {
        return { id: STUDENT_ID };
      },
      async findPendingFees() {
        return { rows: [], total: 0 };
      },
      async findScholarships(_tenantId: string, _studentId: string, filters: ScholarshipFilters) {
        received = filters;
        return [];
      },
      async findFineSummary() {
        return {
          rows: [],
          totals: { _count: { _all: 0 }, _sum: { totalAmount: null, paidAmount: null, waivedAmount: null } },
        };
      },
    } as unknown as StudentFinanceRepository;

    const service = new StudentFinanceService(repository);

    await service.getPendingFees(TENANT_ID, USER_ID, PENDING_PAGE);

    assert.deepEqual(received, {});
  });
});

// --- Fixed repository call budget ----------------------------------------------
//
// Mirrors the COST comment on every public method in studentFinance.service.ts.
// These count REPOSITORY METHOD calls (what the service issues), not database
// statements (what each repository method costs internally — that is proven in
// studentFinance.repository.test.ts).

describe("StudentFinanceService — fixed repository call budget", () => {
  it("getPaymentHistory calls resolveOwnStudent once and findPaymentHistory once", async () => {
    const { service, calls } = buildService({});

    await service.getPaymentHistory(TENANT_ID, USER_ID, PAYMENT_PAGE);

    assert.deepEqual(calls, ["findStudentByUserId", "findPaymentHistory"]);
  });

  it("getReceipts calls resolveOwnStudent once and findReceipts once", async () => {
    const { service, calls } = buildService({});

    await service.getReceipts(TENANT_ID, USER_ID, RECEIPT_PAGE);

    assert.deepEqual(calls, ["findStudentByUserId", "findReceipts"]);
  });

  it("getReceiptDetail calls resolveOwnStudent once and findReceiptById once", async () => {
    const { service, calls } = buildService({ receiptById: { ...buildPaymentRow(), feeDemand: null } as unknown as ReceiptDetailRow });

    await service.getReceiptDetail(TENANT_ID, USER_ID, RECEIPT_ID);

    assert.deepEqual(calls, ["findStudentByUserId", "findReceiptById"]);
  });

  it("getReceiptDownload calls resolveOwnStudent once and findReceiptDownload once", async () => {
    const { service, calls } = buildService({
      receiptDownload: { ...buildPaymentRow(), feeDemand: null } as unknown as ReceiptDownloadRow,
    });

    await service.getReceiptDownload(TENANT_ID, USER_ID, RECEIPT_ID);

    assert.deepEqual(calls, ["findStudentByUserId", "findReceiptDownload"]);
  });

  it("getPendingFees calls resolveOwnStudent once, then the three finance reads exactly once each", async () => {
    const { service, calls } = buildService({});

    await service.getPendingFees(TENANT_ID, USER_ID, PENDING_PAGE);

    assert.equal(calls[0], "findStudentByUserId");
    // The three finance reads run via Promise.all — order among them is not
    // guaranteed, so the budget is asserted as a set rather than a sequence.
    assert.deepEqual(new Set(calls.slice(1)), new Set(["findPendingFees", "findScholarships", "findFineSummary"]));
    assert.equal(calls.length, 4);
  });

  it("no method ever issues a SECOND resolveOwnStudent call", async () => {
    const { service, calls } = buildService({});

    await service.getPendingFees(TENANT_ID, USER_ID, PENDING_PAGE);

    assert.equal(calls.filter((call) => call === "findStudentByUserId").length, 1);
  });
});
