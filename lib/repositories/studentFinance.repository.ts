// ============================================================================
// OWNER      : Gauransh
// MODULE     : Student Finance — Read Layer
// LAYER      : Repository
// PURPOSE    : Every read a student's finance portal needs, and nothing else.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • No calculation, no status derivation, no outstanding-balance arithmetic,
//     no currency formatting, no DTO mapping. `totalAmount - paidAt - waived`
//     is arithmetic, and arithmetic belongs to a service that does not exist
//     yet — so this file returns the columns and lets a later component decide
//     what they mean.
//
// TWO METHODS READ DATA THIS SCHEMA DOES NOT HAVE, AND SAY SO HERE
//   There is no Scholarship model and no Fine model anywhere in the schema —
//   `scholarship`, `fine`, `penalty` and `waiver` return zero matches, and
//   FeeType carries neither a SCHOLARSHIP nor a FINE member. Schema changes are
//   out of scope for this component, so rather than invent a taxonomy:
//
//     findScholarships()  reads demands carrying a WAIVER. In this schema a
//                         concession IS `FeeDemand.waivedAmount`, so a waived
//                         demand is the only real record of one. It cannot
//                         distinguish a merit scholarship from a hardship
//                         waiver, because nothing stored distinguishes them.
//
//     findFineSummary()   reads OVERDUE demands. A fine is not modelled, so
//                         what genuinely exists is overdue liability: which
//                         demands passed their due date and how much is still
//                         outstanding on them.
//
//   Both are named as the brief names them and documented as what they truly
//   are. A later component that introduces real Scholarship and Fine models
//   should replace these bodies, not wrap them.
//
// THE QUERY BUDGET
//   Every method issues a FIXED number of statements. The two paginated reads
//   cost two each (a page and its count); every other method costs one. There
//   is no per-row read anywhere, so no method can become an N+1 — the fee
//   components a receipt needs travel with it through a nested select rather
//   than a second query per component.
//
// TENANCY AND OWNERSHIP
//   EVERY query carries BOTH tenantId and studentId. Not one or the other: a
//   tenant predicate alone would let one student read another's receipts, and a
//   student predicate alone would trust an id the caller supplied. The pair is
//   what makes a stray or forged id return nothing rather than someone else's
//   ledger.
//
// INDEX NOTE, STATED HONESTLY
//   FeeDemand and Payment each carry SEPARATE @@index([tenantId]) and
//   @@index([studentId]) — there is no composite (tenantId, studentId). So
//   these reads are index-ASSISTED (the planner seeks on studentId, the more
//   selective of the two, then filters on tenantId) rather than a pure
//   composite seek. That is correct and fast at student scale, and it is not a
//   claim that it is optimal. Adding the composite index is a schema change and
//   therefore out of scope for this component; it is recorded as a
//   recommendation rather than quietly asserted as already true.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import {
  FeeStatus,
  PaymentStatus,
  type FeeType,
  type PaymentMethod,
  type Prisma,
} from "@/app/generated/prisma/client";
import type {
  FeeDemandSortField,
  PaymentSortField,
} from "@/lib/validations/studentFinance.validation";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/** A page of rows and the total that satisfied the same predicate. */
export interface Page<T> {
  readonly rows: readonly T[];
  readonly total: number;
}

// --- Filter shapes ----------------------------------------------------------
//
// Declared STRUCTURALLY rather than imported as the validation module's
// inferred types. The repository then depends on the shape it needs rather than
// on a Zod schema, so adding an optional field to a schema cannot silently
// change a query — and a caller other than a route (a batch job, a test) can
// satisfy these without constructing a parsed query object.

/** Filters both payment reads share. */
export interface PaymentSharedFilters {
  readonly status?: PaymentStatus;
  readonly method?: PaymentMethod;
  readonly search?: string;
  readonly dateFrom?: Date;
  readonly dateTo?: Date;
}

/** Everything the payment-history read accepts. */
export interface PaymentHistoryFilters extends PaymentSharedFilters {
  readonly page: number;
  readonly limit: number;
  readonly sortBy: PaymentSortField;
  readonly sortOrder: "asc" | "desc";
}

/**
 * Everything the receipt read accepts.
 *
 * `status` is absent by construction — a receipt exists only for a SUCCEEDED
 * payment, and the repository sets that predicate itself. Making it
 * unexpressible in the type is stronger than documenting that it is ignored.
 */
export interface ReceiptListFilters extends Omit<PaymentSharedFilters, "status"> {
  readonly page: number;
  readonly limit: number;
  readonly sortBy: PaymentSortField;
  readonly sortOrder: "asc" | "desc";
}

/** Everything the pending-fee read accepts. */
export interface PendingFeeFilters {
  readonly page: number;
  readonly limit: number;
  readonly sortBy: FeeDemandSortField;
  readonly sortOrder: "asc" | "desc";
  readonly status?: FeeStatus;
  readonly semesterId?: string;
  readonly dueBefore?: Date;
}

/** Everything the concession read accepts. */
export interface ScholarshipFilters {
  readonly semesterId?: string;
  readonly feeType?: FeeType;
}

// --- Row shapes -------------------------------------------------------------
//
// Derived from the selects above, so a column added to a projection reaches the
// DTO mapper as a type error rather than as an untyped surprise.

export type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

export type FeeDemandRow = Prisma.FeeDemandGetPayload<{ select: typeof FEE_DEMAND_SELECT }>;

export type ReceiptDetailRow = Prisma.PaymentGetPayload<{
  select: typeof PAYMENT_SELECT & { feeDemand: { select: typeof FEE_DEMAND_SELECT } };
}>;

export type ReceiptDownloadRow = Prisma.PaymentGetPayload<{
  select: typeof RECEIPT_DETAIL_SELECT;
}>;

/** The overdue rows and the totals the database summed for them. */
export interface FineSummaryRows {
  readonly rows: readonly FeeDemandRow[];
  readonly totals: {
    readonly _count: { readonly _all: number };
    readonly _sum: {
      readonly totalAmount: Prisma.Decimal | null;
      readonly paidAmount: Prisma.Decimal | null;
      readonly waivedAmount: Prisma.Decimal | null;
    };
  };
}

/**
 * Payment columns a student may see.
 *
 * `gatewayRef` and `gatewayMeta` are deliberately ABSENT. Both carry provider
 * internals — and gatewayMeta is an unbounded JSON blob written by the payment
 * gateway, so nobody can state what it contains. Projecting a column whose
 * contents are not enumerable is how card metadata reaches a browser.
 */
export const PAYMENT_SELECT = {
  id: true,
  receiptNo: true,
  amount: true,
  method: true,
  status: true,
  transactionId: true,
  paidAt: true,
  remarks: true,
  createdAt: true,
  feeDemandId: true,
} as const;

/** Fee-demand columns a student may see. */
export const FEE_DEMAND_SELECT = {
  id: true,
  semesterId: true,
  feeStructureId: true,
  dueDate: true,
  totalAmount: true,
  paidAmount: true,
  waivedAmount: true,
  status: true,
  createdAt: true,
  semester: { select: { id: true, name: true } },
  feeStructure: { select: { id: true, name: true } },
} as const;

/**
 * The fee breakdown a printable receipt needs.
 *
 * Nested one level so the components arrive WITH the demand. Reading them per
 * demand would be the N+1 this layer exists to avoid, and a receipt with eight
 * fee lines would cost nine statements instead of one.
 */
export const RECEIPT_DETAIL_SELECT = {
  ...PAYMENT_SELECT,
  feeDemand: {
    select: {
      ...FEE_DEMAND_SELECT,
      feeStructure: {
        select: {
          id: true,
          name: true,
          components: {
            select: { id: true, name: true, type: true, amount: true, isTaxable: true, taxPercent: true },
            orderBy: { name: "asc" },
          },
        },
      },
    },
  },
} as const;

/**
 * Demand states that still owe money.
 *
 * WAIVED and PAID are excluded because neither is pending. A waived demand is
 * settled by the institution rather than by the student, and listing it as
 * outstanding would show a debt that does not exist.
 */
export const OUTSTANDING_FEE_STATUSES = [
  FeeStatus.PENDING,
  FeeStatus.PARTIAL,
  FeeStatus.OVERDUE,
] as const;

/**
 * The only payment state that yields a receipt.
 *
 * A receipt is proof that money changed hands. PENDING, FAILED and REFUNDED
 * payments have receipt numbers in this schema but no such proof, so they are
 * excluded at the QUERY rather than filtered afterwards — a receipt for a
 * failed payment must be unreachable, not merely unrendered.
 */
export const RECEIPTED_PAYMENT_STATUS = PaymentStatus.SUCCESS;

export class StudentFinanceRepository {
    /**
   * Resolves the authenticated user's student record.
   *
   * Authentication is performed against the User table, while every finance
   * read in this repository is keyed by studentId. This lookup is therefore
   * the bridge between authentication and the finance domain.
   *
   * The lookup is tenant-scoped so the same user identifier cannot resolve a
   * student belonging to another tenant. Returning only the student id keeps
   * this method narrowly focused and avoids exposing unrelated student data to
   * callers that only need the finance owner.
   *
   * Returning null for a missing record rather than throwing lets the service
   * distinguish "this authenticated user has no linked student profile" from
   * genuine infrastructure failures.
   *
   * COST: one statement.
   */
  async findStudentByUserId(
    tenantId: string,
    userId: string,
    client: DbClient = prisma
  ): Promise<{ id: string } | null> {
    return client.student.findFirst({
      where: {
        tenantId,
        userId,
      },
      select: {
        id: true,
      },
    });
  }
  /**
   * One student's payments, filtered, sorted and paged.
   *
   * COST: two statements — the page and its count, both under the identical
   * predicate so the total can never describe a wider set than the caller can
   * read. They are issued separately rather than in a transaction: this is a
   * read-only report, and a count that drifts by one under a concurrent write
   * is a far smaller cost than holding a transaction open for a portal page.
   */
  async findPaymentHistory(
    tenantId: string,
    studentId: string,
    query: PaymentHistoryFilters,
    client: DbClient = prisma
  ): Promise<Page<PaymentRow>> {
    const where = this.paymentWhere(tenantId, studentId, query);

    const rows = await client.payment.findMany({
      where,
      select: PAYMENT_SELECT,
      orderBy: this.paymentOrderBy(query.sortBy, query.sortOrder),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    const total = await client.payment.count({ where });

    return { rows, total };
  }

  /**
   * One student's receipts.
   *
   * The same shape as the payment history with one predicate added, and that
   * predicate is the whole difference: only a SUCCEEDED payment is a receipt.
   */
  async findReceipts(
    tenantId: string,
    studentId: string,
    query: ReceiptListFilters,
    client: DbClient = prisma
  ): Promise<Page<PaymentRow>> {
    const where = {
      ...this.paymentWhere(tenantId, studentId, query),
      status: RECEIPTED_PAYMENT_STATUS,
    };

    const rows = await client.payment.findMany({
      where,
      select: PAYMENT_SELECT,
      orderBy: this.paymentOrderBy(query.sortBy, query.sortOrder),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    const total = await client.payment.count({ where });

    return { rows, total };
  }

  /**
   * One receipt, by its payment id.
   *
   * findFirst rather than findUnique, and that is not a stylistic choice:
   * findUnique accepts only the primary key, so the tenant and student
   * predicates could not be part of the lookup and would have to be checked
   * afterwards. Checking afterwards means the row was already read — and a
   * caller who can distinguish "found but not yours" from "not found" learns
   * that someone else's receipt exists. findFirst folds ownership into the
   * query, so both cases return null identically.
   *
   * COST: one statement.
   */
  async findReceiptById(
    tenantId: string,
    studentId: string,
    receiptId: string,
    client: DbClient = prisma
  ) {
    return client.payment.findFirst({
      where: {
        id: receiptId,
        tenantId,
        studentId,
        status: RECEIPTED_PAYMENT_STATUS,
      },
      select: {
        ...PAYMENT_SELECT,
        feeDemand: { select: FEE_DEMAND_SELECT },
      },
    });
  }

  /**
   * Everything a printable receipt needs, in ONE statement.
   *
   * The same ownership predicate as findReceiptById with a wider projection:
   * the fee structure and its components travel with the payment, so a receipt
   * listing eight fee lines still costs one statement rather than nine.
   *
   * This returns the DATA a receipt is rendered from. It does not render one —
   * producing a PDF is neither a query nor this layer's concern, and nothing in
   * the schema stores a receipt artifact to fetch.
   *
   * COST: one statement.
   */
  async findReceiptDownload(
    tenantId: string,
    studentId: string,
    receiptId: string,
    client: DbClient = prisma
  ) {
    return client.payment.findFirst({
      where: {
        id: receiptId,
        tenantId,
        studentId,
        status: RECEIPTED_PAYMENT_STATUS,
      },
      select: RECEIPT_DETAIL_SELECT,
    });
  }

  /**
   * Demands that still owe money.
   *
   * `status` narrows within the outstanding set rather than replacing it, so a
   * caller cannot ask this method for PAID demands — "pending fees" means
   * pending, and a filter that could contradict the method's own name would be
   * a trap.
   *
   * COST: two statements.
   */
  async findPendingFees(
    tenantId: string,
    studentId: string,
    query: PendingFeeFilters,
    client: DbClient = prisma
  ): Promise<Page<FeeDemandRow>> {
    const where: Prisma.FeeDemandWhereInput = {
      tenantId,
      studentId,
      status:
        query.status === undefined
          ? { in: [...OUTSTANDING_FEE_STATUSES] }
          : { in: [...OUTSTANDING_FEE_STATUSES].filter((status) => status === query.status) },
      ...(query.semesterId === undefined ? {} : { semesterId: query.semesterId }),
      ...(query.dueBefore === undefined ? {} : { dueDate: { lte: query.dueBefore } }),
    };

    const rows = await client.feeDemand.findMany({
      where,
      select: FEE_DEMAND_SELECT,
      orderBy: this.feeDemandOrderBy(query.sortBy, query.sortOrder),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    const total = await client.feeDemand.count({ where });

    return { rows, total };
  }

  /**
   * Concessions granted to one student.
   *
   * Reads demands carrying a WAIVER, because in this schema a concession is
   * `FeeDemand.waivedAmount` and nothing else. There is no Scholarship model,
   * so this cannot report a scholarship's name, its sponsor or its award date —
   * none of those are stored anywhere.
   *
   * Not paginated. A student's concessions are bounded by the demands raised
   * against them, which is a handful per semester, and a page of them would
   * make the total meaningless to a portal that wants to show one figure.
   *
   * COST: one statement.
   */
  async findScholarships(
    tenantId: string,
    studentId: string,
    query: ScholarshipFilters = {},
    client: DbClient = prisma
  ): Promise<readonly FeeDemandRow[]> {
    return client.feeDemand.findMany({
      where: {
        tenantId,
        studentId,
        // The predicate that makes this a concession list at all.
        waivedAmount: { gt: 0 },
        ...(query.semesterId === undefined ? {} : { semesterId: query.semesterId }),
        ...(query.feeType === undefined
          ? {}
          : { feeStructure: { components: { some: { type: query.feeType } } } }),
      },
      select: FEE_DEMAND_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  /**
   * Overdue liability for one student.
   *
   * No Fine model exists, so this reports what genuinely does: demands past
   * their due date, with the totals a caller needs to state the position. The
   * aggregate is computed BY THE DATABASE rather than by summing rows here —
   * summing in application code would be arithmetic, which this layer does not
   * do, and would also require reading every row to add them up.
   *
   * `_sum` and `_count` come back on one aggregate, so the summary and the rows
   * together cost two statements and never more, however many demands overdue.
   *
   * COST: two statements.
   */
  async findFineSummary(
    tenantId: string,
    studentId: string,
    client: DbClient = prisma
  ): Promise<FineSummaryRows> {
    const where: Prisma.FeeDemandWhereInput = {
      tenantId,
      studentId,
      status: FeeStatus.OVERDUE,
    };

    const rows = await client.feeDemand.findMany({
      where,
      select: FEE_DEMAND_SELECT,
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    });

    const totals = await client.feeDemand.aggregate({
      where,
      _count: { _all: true },
      _sum: { totalAmount: true, paidAmount: true, waivedAmount: true },
    });

    return { rows, totals };
  }

  // --- Predicate and ordering builders --------------------------------------

  /**
   * The predicate every payment read shares.
   *
   * Built once so the page and its count cannot drift apart, and so tenant and
   * student scoping is written in ONE place — the property most worth being
   * unable to forget.
   */
  private paymentWhere(
    tenantId: string,
    studentId: string,
    query: PaymentSharedFilters
  ): Prisma.PaymentWhereInput {
    return {
      tenantId,
      studentId,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.method === undefined ? {} : { method: query.method }),
      ...(query.dateFrom === undefined && query.dateTo === undefined
        ? {}
        : {
            paidAt: {
              ...(query.dateFrom === undefined ? {} : { gte: query.dateFrom }),
              ...(query.dateTo === undefined ? {} : { lte: query.dateTo }),
            },
          }),
      ...(query.search === undefined
        ? {}
        : {
            // Matched against the two identifiers a student actually quotes
            // when querying a payment. Deliberately NOT against remarks, which
            // is free text an administrator wrote and may name other people.
            OR: [
              { receiptNo: { contains: query.search, mode: "insensitive" } },
              { transactionId: { contains: query.search, mode: "insensitive" } },
            ],
          }),
    };
  }

  /**
   * Ordering for a payment list, always a TOTAL order.
   *
   * `id` is appended to every ordering, and it is not decoration. Offset
   * pagination over a non-total order is unstable: `paidAt` is nullable and
   * duplicated across same-day payments, so two rows that compare equal may
   * come back in either order between page one and page two — silently
   * skipping one row and repeating another. The unique tiebreaker removes that
   * entirely.
   */
  private paymentOrderBy(
    sortBy: PaymentSortField,
    sortOrder: "asc" | "desc"
  ): Prisma.PaymentOrderByWithRelationInput[] {
    return [{ [sortBy]: sortOrder }, { id: sortOrder }];
  }

  /** Ordering for a fee-demand list. Total, for the same reason. */
  private feeDemandOrderBy(
    sortBy: FeeDemandSortField,
    sortOrder: "asc" | "desc"
  ): Prisma.FeeDemandOrderByWithRelationInput[] {
    return [{ [sortBy]: sortOrder }, { id: sortOrder }];
  }
}

export const studentFinanceRepository = new StudentFinanceRepository();
