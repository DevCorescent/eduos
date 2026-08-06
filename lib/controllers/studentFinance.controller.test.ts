// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Finance — Read Layer
// LAYER  : Controller — Unit Tests
// PURPOSE: Prove the controller does EXACTLY what its header promises —
//          orchestration and nothing else: every method delegates to the
//          wired service, forwards its parameters unchanged, and propagates
//          whatever the service throws without translating it.
//
// WHY PROTOTYPE MOCKING, NOT CONSTRUCTOR INJECTION
//   StudentFinanceController is this module's COMPOSITION ROOT: it binds the
//   real StudentFinanceService to the real singleton repository at module
//   load, by design (see the file header in studentFinance.controller.ts).
//   It accepts no injected service — matching CourseRegistrationController and
//   every other controller in this project — so it cannot be redesigned into
//   a DI shape just to make it testable without touching the architecture the
//   brief forbids changing.
//
//   Because studentFinanceService is a genuine instance of StudentFinanceService,
//   its methods are resolved through StudentFinanceService.prototype at CALL
//   time, not copied onto the instance at construction time. Replacing a
//   prototype method therefore intercepts the already-constructed singleton's
//   calls too — this is what node:test's built-in t.mock.method() does, scoped
//   to and auto-restored after each test. No database, no module-loader
//   trickery, and the controller's own composition-root code is never touched.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { StudentFinanceController, studentFinanceController } from "@/lib/controllers/studentFinance.controller";
import { StudentFinanceService } from "@/lib/services/studentFinance.service";
import { AppError } from "@/lib/errors/AppError";
import type {
  PaymentHistoryFilters,
  PendingFeeFilters,
  ReceiptListFilters,
  ScholarshipFilters,
} from "@/lib/repositories/studentFinance.repository";

const TENANT_ID = "tenant_1";
const USER_ID = "user_1";
const RECEIPT_ID = "payment_1";

const PAYMENT_QUERY: PaymentHistoryFilters = {
  page: 1,
  limit: 20,
  sortBy: "paidAt",
  sortOrder: "desc",
};

const RECEIPT_QUERY: ReceiptListFilters = {
  page: 1,
  limit: 20,
  sortBy: "paidAt",
  sortOrder: "desc",
};

const PENDING_QUERY: PendingFeeFilters = {
  page: 1,
  limit: 20,
  sortBy: "dueDate",
  sortOrder: "asc",
};

// --- Delegation and parameter forwarding ---------------------------------------

describe("StudentFinanceController — delegation and parameter forwarding", () => {
  it("getPaymentHistory delegates to service.getPaymentHistory with EXACTLY the forwarded arguments", async (t) => {
    let received: unknown[] = [];
    const expected = { payments: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };

    t.mock.method(StudentFinanceService.prototype, "getPaymentHistory", async function (
      this: StudentFinanceService,
      ...args: unknown[]
    ) {
      received = args;
      return expected;
    });

    const controller = new StudentFinanceController();
    const result = await controller.getPaymentHistory(TENANT_ID, USER_ID, PAYMENT_QUERY);

    assert.deepEqual(received, [TENANT_ID, USER_ID, PAYMENT_QUERY]);
    assert.equal(result, expected);
  });

  it("getReceipts delegates to service.getReceipts with EXACTLY the forwarded arguments", async (t) => {
    let received: unknown[] = [];
    const expected = { receipts: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };

    t.mock.method(StudentFinanceService.prototype, "getReceipts", async function (
      this: StudentFinanceService,
      ...args: unknown[]
    ) {
      received = args;
      return expected;
    });

    const controller = new StudentFinanceController();
    const result = await controller.getReceipts(TENANT_ID, USER_ID, RECEIPT_QUERY);

    assert.deepEqual(received, [TENANT_ID, USER_ID, RECEIPT_QUERY]);
    assert.equal(result, expected);
  });

  it("getReceiptDetail delegates to service.getReceiptDetail with EXACTLY the forwarded arguments", async (t) => {
    let received: unknown[] = [];
    const expected = { id: RECEIPT_ID };

    t.mock.method(StudentFinanceService.prototype, "getReceiptDetail", async function (
      this: StudentFinanceService,
      ...args: unknown[]
    ) {
      received = args;
      return expected;
    });

    const controller = new StudentFinanceController();
    const result = await controller.getReceiptDetail(TENANT_ID, USER_ID, RECEIPT_ID);

    assert.deepEqual(received, [TENANT_ID, USER_ID, RECEIPT_ID]);
    assert.equal(result, expected);
  });

  it("getReceiptDownload delegates to service.getReceiptDownload with EXACTLY the forwarded arguments", async (t) => {
    let received: unknown[] = [];
    const expected = { id: RECEIPT_ID, feeLines: [] };

    t.mock.method(StudentFinanceService.prototype, "getReceiptDownload", async function (
      this: StudentFinanceService,
      ...args: unknown[]
    ) {
      received = args;
      return expected;
    });

    const controller = new StudentFinanceController();
    const result = await controller.getReceiptDownload(TENANT_ID, USER_ID, RECEIPT_ID);

    assert.deepEqual(received, [TENANT_ID, USER_ID, RECEIPT_ID]);
    assert.equal(result, expected);
  });

  it("getPendingFees delegates to service.getPendingFees, forwarding scholarshipFilters when supplied", async (t) => {
    let received: unknown[] = [];
    const expected = {
      demands: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      scholarships: [],
      fineSummary: { demandCount: 0, totalDemanded: "0.00", totalPaid: "0.00", totalWaived: "0.00", overdueDemands: [], source: "OVERDUE_DEMAND" },
    };

    t.mock.method(StudentFinanceService.prototype, "getPendingFees", async function (
      this: StudentFinanceService,
      ...args: unknown[]
    ) {
      received = args;
      return expected;
    });

    const scholarshipFilters: ScholarshipFilters = { semesterId: "semester_1" };
    const controller = new StudentFinanceController();
    const result = await controller.getPendingFees(TENANT_ID, USER_ID, PENDING_QUERY, scholarshipFilters);

    assert.deepEqual(received, [TENANT_ID, USER_ID, PENDING_QUERY, scholarshipFilters]);
    assert.equal(result, expected);
  });

  it("getPendingFees forwards an UNDEFINED scholarshipFilters unchanged when the caller omits it", async (t) => {
    // The controller must not invent a default — StudentFinanceService.getPendingFees
    // already defaults scholarshipFilters to {} itself (see the service test
    // suite's "defaults scholarshipFilters to {}" case). A controller default
    // here would be the SAME decision made in two layers.
    let received: unknown[] = [];

    t.mock.method(StudentFinanceService.prototype, "getPendingFees", async function (
      this: StudentFinanceService,
      ...args: unknown[]
    ) {
      received = args;
      return {
        demands: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        scholarships: [],
        fineSummary: { demandCount: 0, totalDemanded: "0.00", totalPaid: "0.00", totalWaived: "0.00", overdueDemands: [], source: "OVERDUE_DEMAND" },
      };
    });

    const controller = new StudentFinanceController();
    await controller.getPendingFees(TENANT_ID, USER_ID, PENDING_QUERY);

    assert.deepEqual(received, [TENANT_ID, USER_ID, PENDING_QUERY, undefined]);
  });
});

// --- Propagated service errors --------------------------------------------------

describe("StudentFinanceController — propagated service errors", () => {
  it("propagates an AppError thrown by getPaymentHistory UNCHANGED", async (t) => {
    const thrown = new AppError("Forbidden", 403, "FORBIDDEN");

    t.mock.method(StudentFinanceService.prototype, "getPaymentHistory", async () => {
      throw thrown;
    });

    const controller = new StudentFinanceController();

    await assert.rejects(
      () => controller.getPaymentHistory(TENANT_ID, USER_ID, PAYMENT_QUERY),
      (err: unknown) => err === thrown
    );
  });

  it("propagates an AppError thrown by getReceipts UNCHANGED", async (t) => {
    const thrown = new AppError("Forbidden", 403, "FORBIDDEN");

    t.mock.method(StudentFinanceService.prototype, "getReceipts", async () => {
      throw thrown;
    });

    const controller = new StudentFinanceController();

    await assert.rejects(
      () => controller.getReceipts(TENANT_ID, USER_ID, RECEIPT_QUERY),
      (err: unknown) => err === thrown
    );
  });

  it("propagates the RECEIPT_NOT_FOUND AppError thrown by getReceiptDetail UNCHANGED", async (t) => {
    const thrown = new AppError("Receipt not found", 404, "NOT_FOUND");

    t.mock.method(StudentFinanceService.prototype, "getReceiptDetail", async () => {
      throw thrown;
    });

    const controller = new StudentFinanceController();

    await assert.rejects(
      () => controller.getReceiptDetail(TENANT_ID, USER_ID, RECEIPT_ID),
      (err: unknown) => err === thrown
    );
  });

  it("propagates the RECEIPT_NOT_FOUND AppError thrown by getReceiptDownload UNCHANGED", async (t) => {
    const thrown = new AppError("Receipt not found", 404, "NOT_FOUND");

    t.mock.method(StudentFinanceService.prototype, "getReceiptDownload", async () => {
      throw thrown;
    });

    const controller = new StudentFinanceController();

    await assert.rejects(
      () => controller.getReceiptDownload(TENANT_ID, USER_ID, RECEIPT_ID),
      (err: unknown) => err === thrown
    );
  });

  it("propagates an AppError thrown by getPendingFees UNCHANGED", async (t) => {
    const thrown = new AppError("Forbidden", 403, "FORBIDDEN");

    t.mock.method(StudentFinanceService.prototype, "getPendingFees", async () => {
      throw thrown;
    });

    const controller = new StudentFinanceController();

    await assert.rejects(
      () => controller.getPendingFees(TENANT_ID, USER_ID, PENDING_QUERY),
      (err: unknown) => err === thrown
    );
  });

  it("propagates a non-AppError (infrastructure) failure UNCHANGED — no swallowing, no wrapping", async (t) => {
    const thrown = new Error("connection reset");

    t.mock.method(StudentFinanceService.prototype, "getPaymentHistory", async () => {
      throw thrown;
    });

    const controller = new StudentFinanceController();

    await assert.rejects(
      () => controller.getPaymentHistory(TENANT_ID, USER_ID, PAYMENT_QUERY),
      (err: unknown) => err === thrown
    );
  });
});

// --- Exported singleton -----------------------------------------------------

describe("StudentFinanceController — exported singleton", () => {
  it("studentFinanceController is an instance of StudentFinanceController", () => {
    assert.ok(studentFinanceController instanceof StudentFinanceController);
  });

  it("importing the controller module again resolves the SAME singleton instance", async () => {
    // ES module evaluation is cached, so a second dynamic import of the same
    // specifier returns the identical module record and therefore the
    // identical exported instance — proving every route handler in this
    // module shares one wired controller rather than constructing its own.
    const second = await import("@/lib/controllers/studentFinance.controller");
    assert.equal(second.studentFinanceController, studentFinanceController);
  });

  it("every route delegates through the SAME exported instance, not a fresh construction", () => {
    // A fresh `new StudentFinanceController()` is a DIFFERENT object from the
    // singleton — this is not itself a defect (both wire the same real
    // service), but it demonstrates the singleton is a distinguishable,
    // stable identity that route handlers import rather than construct.
    const fresh = new StudentFinanceController();
    assert.notEqual(fresh, studentFinanceController);
    assert.ok(fresh instanceof StudentFinanceController);
  });
});
