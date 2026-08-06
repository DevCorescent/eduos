// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Finance — Read Layer
// LAYER  : DTO
// PURPOSE: The shapes the finance portal returns, and the ONE boundary
//          conversion that produces them.
//
// NO PRISMA MODEL IS EVER RETURNED
//   Every mapper below takes a repository row and returns a plain object. A
//   Prisma row carries a `Decimal` instance and `Date` objects, neither of
//   which survives JSON serialisation honestly: a Decimal stringifies to
//   whatever its internal representation prints, and a Date becomes an ISO
//   string only by accident of JSON.stringify. Both are converted HERE,
//   explicitly, exactly once.
//
// MONEY IS A STRING, AND THAT IS NOT PEDANTRY
//   Every amount is Decimal(10,2). Emitted as a JSON number, ₹1,234.55 can
//   reach a browser as 1234.5499999999999 — and a portal that adds a column of
//   those to show a balance will display a total no ledger contains. A lossless
//   decimal string is the only safe representation across the boundary, and it
//   is the same convention every Phase 16 DTO already applies.
//
// WHAT THESE MAPPERS DO NOT DO
//   No arithmetic. `outstanding = total - paid - waived` is a calculation, and
//   calculations belong to a service this component is forbidden from creating.
//   The DTOs carry the three figures so a later component can compute it once;
//   computing it here would put the same subtraction in two layers.
// ============================================================================

import type { FeeStatus, FeeType, PaymentMethod, PaymentStatus } from "@/app/generated/prisma/enums";
import type {
  FeeDemandRow,
  FineSummaryRows,
  PaymentRow,
  ReceiptDetailRow,
  ReceiptDownloadRow,
} from "@/lib/repositories/studentFinance.repository";

/** Anything Prisma hands back as a Decimal. */
type DecimalLike = { toFixed(places: number): string } | null;

/** The scale every money column in this module is stored at. */
const MONEY_SCALE = 2;

/**
 * Render a Decimal column as a lossless string.
 *
 * `toFixed(2)` rather than `toString()`: Prisma's Decimal prints `1234.5` for a
 * value stored as `1234.50`, and a portal aligning a column of amounts would
 * show a ragged ledger. Fixing the scale makes every amount render the way the
 * column stores it.
 */
export function money(value: DecimalLike): string {
  return value === null ? "0.00" : value.toFixed(MONEY_SCALE);
}

/** Render a nullable Decimal, preserving the null. */
export function optionalMoney(value: DecimalLike): string | null {
  return value === null ? null : value.toFixed(MONEY_SCALE);
}

/** Render a Date as ISO-8601, preserving the null. */
export function isoDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

// --- Shapes -----------------------------------------------------------------

/** One payment on a student's ledger. */
export interface PaymentHistoryDto {
  id: string;
  receiptNo: string;
  /** Decimal(10,2) as a lossless string. */
  amount: string;
  method: PaymentMethod;
  status: PaymentStatus;
  /** Null until a gateway or cashier records one. */
  transactionId: string | null;
  /** ISO-8601, null while the payment has not settled. */
  paidAt: string | null;
  remarks: string | null;
  createdAt: string;
  /** Null for a payment not raised against a specific demand. */
  feeDemandId: string | null;
  /**
   * Whether this payment yields a receipt.
   *
   * Derived from `status`, not stored. A student looking at a ledger needs to
   * know which lines are downloadable without knowing that SUCCESS is the only
   * receipted state, and re-deriving that rule in a client would put it in two
   * places.
   */
  hasReceipt: boolean;
}

/** One receipt in a list. */
export interface ReceiptSummaryDto {
  id: string;
  receiptNo: string;
  amount: string;
  method: PaymentMethod;
  /** ISO-8601. A receipted payment always has one. */
  paidAt: string | null;
  feeDemandId: string | null;
}

/** One fee line on a printable receipt. */
export interface ReceiptFeeLineDto {
  id: string;
  name: string;
  type: FeeType;
  amount: string;
  isTaxable: boolean;
  /** Decimal(5,2) as a string, null when the line carries no tax. */
  taxPercent: string | null;
}

/** One receipt with the demand it settled. */
export interface ReceiptDetailDto {
  id: string;
  receiptNo: string;
  amount: string;
  method: PaymentMethod;
  status: PaymentStatus;
  transactionId: string | null;
  paidAt: string | null;
  remarks: string | null;
  createdAt: string;
  /** Null for a payment not raised against a specific demand. */
  demand: PendingFeeDto | null;
}

/** Everything a printable receipt renders from. */
export interface ReceiptDownloadDto extends ReceiptDetailDto {
  /** The fee structure's lines, so a receipt can itemise what was paid for. */
  feeLines: ReceiptFeeLineDto[];
  feeStructureName: string | null;
}

/**
 * One demand a student owes against.
 *
 * Carries `totalAmount`, `paidAmount` and `waivedAmount` separately and does
 * NOT subtract them. The outstanding figure is a calculation, and a DTO that
 * performed it would put the same subtraction in this layer and in whatever
 * service later needs it.
 */
export interface PendingFeeDto {
  id: string;
  semesterId: string | null;
  semesterName: string | null;
  feeStructureId: string | null;
  feeStructureName: string | null;
  /** ISO-8601. */
  dueDate: string;
  totalAmount: string;
  paidAmount: string;
  waivedAmount: string;
  status: FeeStatus;
  createdAt: string;
}

/**
 * One concession granted to a student.
 *
 * DERIVED FROM A WAIVER, because this schema has no Scholarship model. There is
 * no award name, no sponsor and no award date, and none of those are omitted by
 * choice — nothing stores them. `source` records that plainly rather than
 * letting a client infer a richer provenance than exists.
 */
export interface ScholarshipDto {
  /** The demand the concession was granted against. */
  feeDemandId: string;
  semesterId: string | null;
  semesterName: string | null;
  feeStructureName: string | null;
  /** The concession itself. */
  waivedAmount: string;
  /** What it was waived from, for context. */
  totalAmount: string;
  status: FeeStatus;
  grantedOn: string;
  /** Always "FEE_WAIVER" — the only concession this schema records. */
  source: "FEE_WAIVER";
}

/**
 * A student's overdue position.
 *
 * NAMED for the brief and DOCUMENTED for the schema: no Fine model exists, so
 * this reports overdue liability rather than levied fines. `demandCount` and
 * the three totals come from a database aggregate, never from summing rows in
 * application code.
 */
export interface FineSummaryDto {
  demandCount: number;
  totalDemanded: string;
  totalPaid: string;
  totalWaived: string;
  /** The overdue demands themselves, oldest due date first. */
  overdueDemands: PendingFeeDto[];
  /** Always "OVERDUE_DEMAND" — no fine is modelled in this schema. */
  source: "OVERDUE_DEMAND";
}

// --- Mappers ----------------------------------------------------------------

/** Whether a payment in this state yields a receipt. */
function hasReceipt(status: PaymentStatus): boolean {
  return status === "SUCCESS";
}

export function toPaymentHistoryDto(row: PaymentRow): PaymentHistoryDto {
  return {
    id: row.id,
    receiptNo: row.receiptNo,
    amount: money(row.amount),
    method: row.method,
    status: row.status,
    transactionId: row.transactionId,
    paidAt: isoDate(row.paidAt),
    remarks: row.remarks,
    createdAt: row.createdAt.toISOString(),
    feeDemandId: row.feeDemandId,
    hasReceipt: hasReceipt(row.status),
  };
}

export function toReceiptSummaryDto(row: PaymentRow): ReceiptSummaryDto {
  return {
    id: row.id,
    receiptNo: row.receiptNo,
    amount: money(row.amount),
    method: row.method,
    paidAt: isoDate(row.paidAt),
    feeDemandId: row.feeDemandId,
  };
}

export function toPendingFeeDto(row: FeeDemandRow): PendingFeeDto {
  return {
    id: row.id,
    semesterId: row.semesterId,
    semesterName: row.semester?.name ?? null,
    feeStructureId: row.feeStructureId,
    feeStructureName: row.feeStructure?.name ?? null,
    dueDate: row.dueDate.toISOString(),
    totalAmount: money(row.totalAmount),
    paidAmount: money(row.paidAmount),
    waivedAmount: money(row.waivedAmount),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toReceiptDetailDto(row: ReceiptDetailRow): ReceiptDetailDto {
  return {
    id: row.id,
    receiptNo: row.receiptNo,
    amount: money(row.amount),
    method: row.method,
    status: row.status,
    transactionId: row.transactionId,
    paidAt: isoDate(row.paidAt),
    remarks: row.remarks,
    createdAt: row.createdAt.toISOString(),
    demand: row.feeDemand === null ? null : toPendingFeeDto(row.feeDemand),
  };
}

export function toReceiptDownloadDto(row: ReceiptDownloadRow): ReceiptDownloadDto {
  const components = row.feeDemand?.feeStructure?.components ?? [];

  return {
    id: row.id,
    receiptNo: row.receiptNo,
    amount: money(row.amount),
    method: row.method,
    status: row.status,
    transactionId: row.transactionId,
    paidAt: isoDate(row.paidAt),
    remarks: row.remarks,
    createdAt: row.createdAt.toISOString(),
    demand:
      row.feeDemand === null
        ? null
        : toPendingFeeDto({
            ...row.feeDemand,
            feeStructure:
              row.feeDemand.feeStructure === null
                ? null
                : {
                    id: row.feeDemand.feeStructure.id,
                    name: row.feeDemand.feeStructure.name,
                  },
          }),
    feeStructureName: row.feeDemand?.feeStructure?.name ?? null,
    feeLines: components.map((component) => ({
      id: component.id,
      name: component.name,
      type: component.type,
      amount: money(component.amount),
      isTaxable: component.isTaxable,
      taxPercent: optionalMoney(component.taxPercent),
    })),
  };
}

export function toScholarshipDto(row: FeeDemandRow): ScholarshipDto {
  return {
    feeDemandId: row.id,
    semesterId: row.semesterId,
    semesterName: row.semester?.name ?? null,
    feeStructureName: row.feeStructure?.name ?? null,
    waivedAmount: money(row.waivedAmount),
    totalAmount: money(row.totalAmount),
    status: row.status,
    grantedOn: row.createdAt.toISOString(),
    source: "FEE_WAIVER",
  };
}

export function toFineSummaryDto(rows: FineSummaryRows): FineSummaryDto {
  return {
    demandCount: rows.totals._count._all,
    totalDemanded: money(rows.totals._sum.totalAmount),
    totalPaid: money(rows.totals._sum.paidAmount),
    totalWaived: money(rows.totals._sum.waivedAmount),
    overdueDemands: rows.rows.map(toPendingFeeDto),
    source: "OVERDUE_DEMAND",
  };
}
