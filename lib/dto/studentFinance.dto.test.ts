// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Finance — Read Layer
// LAYER  : DTO — Unit Tests
// PURPOSE: Prove the boundary conversion is lossless and that no Prisma value
//          escapes through it.
//
//          The single most valuable test here is the money one. ₹1234.55
//          emitted as a JSON number can reach a browser as 1234.5499999999999,
//          and a portal summing a column of those shows a balance no ledger
//          contains. Everything else in this file guards the same boundary.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Prisma } from "@/app/generated/prisma/client";
import { FeeStatus, PaymentMethod, PaymentStatus } from "@/app/generated/prisma/enums";
import {
  isoDate,
  money,
  optionalMoney,
  toFineSummaryDto,
  toPaymentHistoryDto,
  toPendingFeeDto,
  toReceiptDetailDto,
  toReceiptDownloadDto,
  toReceiptSummaryDto,
  toScholarshipDto,
} from "@/lib/dto/studentFinance.dto";

const PAID_AT = new Date("2025-03-14T10:30:00.000Z");
const CREATED_AT = new Date("2025-03-01T00:00:00.000Z");
const DUE_DATE = new Date("2025-04-30T00:00:00.000Z");

function decimal(value: string) {
  return new Prisma.Decimal(value);
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment_1",
    receiptNo: "RC-2025-0001",
    amount: decimal("12500.50"),
    method: PaymentMethod.UPI,
    status: PaymentStatus.SUCCESS,
    transactionId: "txn_abc",
    paidAt: PAID_AT,
    remarks: null,
    createdAt: CREATED_AT,
    feeDemandId: "demand_1",
    ...overrides,
  } as Parameters<typeof toPaymentHistoryDto>[0];
}

function demandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "demand_1",
    semesterId: "sem_1",
    feeStructureId: "structure_1",
    dueDate: DUE_DATE,
    totalAmount: decimal("50000.00"),
    paidAmount: decimal("12500.50"),
    waivedAmount: decimal("5000.00"),
    status: FeeStatus.PARTIAL,
    createdAt: CREATED_AT,
    semester: { id: "sem_1", name: "Semester 1" },
    feeStructure: { id: "structure_1", name: "BTech 2025 Fee" },
    ...overrides,
  } as Parameters<typeof toPendingFeeDto>[0];
}

describe("money", () => {
  it("renders a Decimal at the column's own scale", () => {
    assert.equal(money(decimal("12500.5")), "12500.50");
  });

  it("keeps a trailing zero, so a ledger column aligns", () => {
    assert.equal(money(decimal("1000")), "1000.00");
  });

  it("is a STRING, never a number", () => {
    // A JSON number would hand the client back the float problem.
    assert.equal(typeof money(decimal("1234.55")), "string");
  });

  it("survives a value a float would corrupt", () => {
    assert.equal(money(decimal("1234.55")), "1234.55");
    assert.equal(money(decimal("0.07")), "0.07");
    assert.equal(money(decimal("999999.99")), "999999.99");
  });

  it("renders a null aggregate as zero, which is what no rows means", () => {
    assert.equal(money(null), "0.00");
  });

  it("renders a negative amount without losing the sign", () => {
    assert.equal(money(decimal("-250.25")), "-250.25");
  });
});

describe("optionalMoney", () => {
  it("PRESERVES a null rather than reporting zero", () => {
    // A tax percent of null means "no tax applies", which is not the same as a
    // tax of 0.00% — and a receipt must not print one as the other.
    assert.equal(optionalMoney(null), null);
  });

  it("renders a present value at scale", () => {
    assert.equal(optionalMoney(decimal("18")), "18.00");
  });
});

describe("isoDate", () => {
  it("renders a Date as ISO-8601", () => {
    assert.equal(isoDate(PAID_AT), "2025-03-14T10:30:00.000Z");
  });

  it("preserves a null", () => {
    assert.equal(isoDate(null), null);
  });
});

describe("toPaymentHistoryDto", () => {
  it("returns a plain object carrying no Prisma values", () => {
    const dto = toPaymentHistoryDto(paymentRow());

    assert.equal(typeof dto.amount, "string");
    assert.equal(typeof dto.paidAt, "string");
    assert.equal(typeof dto.createdAt, "string");

    // Every value is a primitive or an explicit null, so no Decimal instance
    // and no Date object escaped the boundary.
    for (const [key, value] of Object.entries(dto)) {
      assert.ok(
        value === null || typeof value !== "object",
        `${key} carries an object rather than a serialised value`
      );
    }
  });

  it("carries the ledger fields a student reads", () => {
    const dto = toPaymentHistoryDto(paymentRow());

    assert.equal(dto.receiptNo, "RC-2025-0001");
    assert.equal(dto.amount, "12500.50");
    assert.equal(dto.method, PaymentMethod.UPI);
    assert.equal(dto.transactionId, "txn_abc");
  });

  it("derives hasReceipt from the status", () => {
    assert.equal(toPaymentHistoryDto(paymentRow()).hasReceipt, true);

    for (const status of [
      PaymentStatus.PENDING,
      PaymentStatus.FAILED,
      PaymentStatus.REFUNDED,
      PaymentStatus.PARTIAL,
    ]) {
      assert.equal(toPaymentHistoryDto(paymentRow({ status })).hasReceipt, false, status);
    }
  });

  it("preserves a null paidAt, which is what an unsettled payment looks like", () => {
    const dto = toPaymentHistoryDto(paymentRow({ paidAt: null, status: PaymentStatus.PENDING }));

    assert.equal(dto.paidAt, null);
  });

  it("NEVER exposes gateway internals, even if a row carries them", () => {
    // The projection excludes them; this proves the mapper would not leak one
    // that reached it by another route.
    const dto = toPaymentHistoryDto(
      paymentRow({ gatewayRef: "pg_secret", gatewayMeta: { card: "4111" } })
    );

    assert.equal("gatewayRef" in dto, false);
    assert.equal("gatewayMeta" in dto, false);
    assert.equal(JSON.stringify(dto).includes("4111"), false);
  });
});

describe("toReceiptSummaryDto", () => {
  it("carries only what a receipt LIST needs", () => {
    const dto = toReceiptSummaryDto(paymentRow());

    assert.deepEqual(Object.keys(dto).sort(), [
      "amount",
      "feeDemandId",
      "id",
      "method",
      "paidAt",
      "receiptNo",
    ]);
  });

  it("omits remarks, which a list does not need", () => {
    assert.equal("remarks" in toReceiptSummaryDto(paymentRow()), false);
  });
});

describe("toPendingFeeDto", () => {
  it("carries the three money columns SEPARATELY, un-subtracted", () => {
    // The outstanding figure is a calculation. Performing it here would put the
    // same subtraction in this layer and in whatever service later needs it.
    const dto = toPendingFeeDto(demandRow());

    assert.equal(dto.totalAmount, "50000.00");
    assert.equal(dto.paidAmount, "12500.50");
    assert.equal(dto.waivedAmount, "5000.00");
    assert.equal("outstanding" in dto, false);
  });

  it("flattens the semester and structure names", () => {
    const dto = toPendingFeeDto(demandRow());

    assert.equal(dto.semesterName, "Semester 1");
    assert.equal(dto.feeStructureName, "BTech 2025 Fee");
  });

  it("survives a demand with no semester or structure", () => {
    const dto = toPendingFeeDto(
      demandRow({ semester: null, feeStructure: null, semesterId: null, feeStructureId: null })
    );

    assert.equal(dto.semesterName, null);
    assert.equal(dto.feeStructureName, null);
  });

  it("renders the due date as ISO-8601", () => {
    assert.equal(toPendingFeeDto(demandRow()).dueDate, "2025-04-30T00:00:00.000Z");
  });
});

describe("toReceiptDetailDto", () => {
  it("nests the demand it settled", () => {
    const dto = toReceiptDetailDto({ ...paymentRow(), feeDemand: demandRow() } as never);

    assert.equal(dto.demand?.id, "demand_1");
    assert.equal(dto.demand?.totalAmount, "50000.00");
  });

  it("preserves a null demand for a payment raised against none", () => {
    const dto = toReceiptDetailDto({ ...paymentRow(), feeDemand: null } as never);

    assert.equal(dto.demand, null);
  });
});

describe("toReceiptDownloadDto", () => {
  function downloadRow() {
    return {
      ...paymentRow(),
      feeDemand: {
        ...demandRow(),
        feeStructure: {
          id: "structure_1",
          name: "BTech 2025 Fee",
          components: [
            {
              id: "c1",
              name: "Tuition",
              type: "TUITION",
              amount: decimal("40000"),
              isTaxable: false,
              taxPercent: null,
            },
            {
              id: "c2",
              name: "Library",
              type: "LIBRARY",
              amount: decimal("2500.75"),
              isTaxable: true,
              taxPercent: decimal("18"),
            },
          ],
        },
      },
    } as never;
  }

  it("itemises every fee line", () => {
    const dto = toReceiptDownloadDto(downloadRow());

    assert.equal(dto.feeLines.length, 2);
    assert.equal(dto.feeLines[0].name, "Tuition");
    assert.equal(dto.feeLines[0].amount, "40000.00");
    assert.equal(dto.feeStructureName, "BTech 2025 Fee");
  });

  it("preserves a null tax percent distinctly from zero", () => {
    const dto = toReceiptDownloadDto(downloadRow());

    assert.equal(dto.feeLines[0].taxPercent, null, "no tax applies");
    assert.equal(dto.feeLines[1].taxPercent, "18.00");
  });

  it("still carries the demand alongside the lines", () => {
    const dto = toReceiptDownloadDto(downloadRow());

    assert.equal(dto.demand?.id, "demand_1");
    assert.equal(dto.demand?.feeStructureName, "BTech 2025 Fee");
  });

  it("survives a receipt with no fee structure", () => {
    const dto = toReceiptDownloadDto({
      ...paymentRow(),
      feeDemand: { ...demandRow(), feeStructure: null },
    } as never);

    assert.deepEqual(dto.feeLines, []);
    assert.equal(dto.feeStructureName, null);
  });
});

describe("toScholarshipDto", () => {
  it("reports the waiver as the concession", () => {
    const dto = toScholarshipDto(demandRow());

    assert.equal(dto.waivedAmount, "5000.00");
    assert.equal(dto.totalAmount, "50000.00");
    assert.equal(dto.feeDemandId, "demand_1");
  });

  it("declares its SOURCE honestly", () => {
    // There is no Scholarship model in this schema. `source` records that the
    // record is a fee waiver rather than letting a client infer a richer
    // provenance — an award name, a sponsor — that nothing stores.
    assert.equal(toScholarshipDto(demandRow()).source, "FEE_WAIVER");
  });

  it("does not invent an award name or a sponsor", () => {
    const dto = toScholarshipDto(demandRow());

    assert.equal("name" in dto, false);
    assert.equal("sponsor" in dto, false);
    assert.equal("awardedBy" in dto, false);
  });

  it("reports when the concession was recorded", () => {
    assert.equal(toScholarshipDto(demandRow()).grantedOn, "2025-03-01T00:00:00.000Z");
  });
});

describe("toFineSummaryDto", () => {
  function summary(overrides: Record<string, unknown> = {}) {
    return {
      rows: [demandRow({ status: FeeStatus.OVERDUE })],
      totals: {
        _count: { _all: 1 },
        _sum: {
          totalAmount: decimal("50000.00"),
          paidAmount: decimal("12500.50"),
          waivedAmount: decimal("5000.00"),
        },
      },
      ...overrides,
    } as Parameters<typeof toFineSummaryDto>[0];
  }

  it("carries the database's own totals", () => {
    const dto = toFineSummaryDto(summary());

    assert.equal(dto.demandCount, 1);
    assert.equal(dto.totalDemanded, "50000.00");
    assert.equal(dto.totalPaid, "12500.50");
    assert.equal(dto.totalWaived, "5000.00");
  });

  it("lists the overdue demands themselves", () => {
    const dto = toFineSummaryDto(summary());

    assert.equal(dto.overdueDemands.length, 1);
    assert.equal(dto.overdueDemands[0].status, FeeStatus.OVERDUE);
  });

  it("declares its SOURCE honestly", () => {
    // No Fine model exists. This is overdue liability, not levied fines.
    assert.equal(toFineSummaryDto(summary()).source, "OVERDUE_DEMAND");
  });

  it("reports ZERO totals for a student with nothing overdue", () => {
    // An aggregate over no rows returns null sums, which must render as 0.00
    // rather than as null — a student owing nothing owes 0.00.
    const dto = toFineSummaryDto(
      summary({
        rows: [],
        totals: {
          _count: { _all: 0 },
          _sum: { totalAmount: null, paidAmount: null, waivedAmount: null },
        },
      })
    );

    assert.equal(dto.demandCount, 0);
    assert.equal(dto.totalDemanded, "0.00");
    assert.deepEqual(dto.overdueDemands, []);
  });
});

describe("every DTO survives JSON serialisation unchanged", () => {
  it("round-trips without losing a decimal place", () => {
    // The real boundary: whatever survives JSON.stringify is what the client
    // receives, and a Decimal or a Date that slipped through would not.
    const dto = toPaymentHistoryDto(paymentRow());
    const roundTripped = JSON.parse(JSON.stringify(dto));

    assert.deepEqual(roundTripped, dto);
    assert.equal(roundTripped.amount, "12500.50");
  });

  it("round-trips a pending fee unchanged", () => {
    const dto = toPendingFeeDto(demandRow());

    assert.deepEqual(JSON.parse(JSON.stringify(dto)), dto);
  });
});
