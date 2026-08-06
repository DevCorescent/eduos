// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Finance — Read Layer
// LAYER  : Validation
// PURPOSE: Shape, bounds and — above all — the SORT WHITELIST for every
//          finance read.
//
// WHY THE SORT WHITELIST IS A SECURITY CONTROL AND NOT A CONVENIENCE
//   A sort field taken from a query string flows directly into Prisma's
//   `orderBy`. Passed through unchecked, a caller could order by any column on
//   the model — including ones the projection deliberately withholds, such as
//   `gatewayRef` or `gatewayMeta`. Ordering by a hidden column leaks it: a
//   caller who can sort by it and page through the results can reconstruct its
//   ordering, and for a low-cardinality column that is the value itself. So the
//   permitted fields are enumerated here and nowhere else, and the repository
//   accepts only these.
//
// WHAT IS ENFORCED HERE AND WHAT IS NOT
//   Here : shape, bounds, enum membership, sort and order membership, and that
//          a date range is not inverted.
//   Not  : that the receipt exists, that it belongs to this student, or that
//          the caller may read it. Ownership is a REPOSITORY predicate — every
//          query carries both tenantId and studentId — and existence is a 404.
//
// Pagination is NOT redefined. paginationQuerySchema already states the page
// and limit contract for the whole project; a second definition here would be
// a second chance for the two to disagree about MAX_PAGE_SIZE.
// ============================================================================

import { z } from "zod";
import { FeeStatus, FeeType, PaymentMethod, PaymentStatus } from "@/app/generated/prisma/enums";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { identifier } from "@/lib/validations/shared";

/** Longest a free-text search term may be. */
const SEARCH_MAX_LENGTH = 64;

/**
 * Sort direction.
 *
 * Defaulted to descending because every finance list is a ledger, and a ledger
 * is read newest first.
 */
export const sortOrderSchema = z.enum(["asc", "desc"]).default("desc");

/**
 * Columns a payment list may be ordered by.
 *
 * Deliberately excludes `gatewayRef`, `gatewayMeta`, `transactionId` and
 * `remarks`. The first two are never projected at all; ordering by a column the
 * response withholds is a disclosure channel, not a feature.
 */
export const PAYMENT_SORT_FIELDS = ["paidAt", "createdAt", "amount", "receiptNo"] as const;

export type PaymentSortField = (typeof PAYMENT_SORT_FIELDS)[number];

/** Columns a fee-demand list may be ordered by. */
export const FEE_DEMAND_SORT_FIELDS = ["dueDate", "createdAt", "totalAmount"] as const;

export type FeeDemandSortField = (typeof FEE_DEMAND_SORT_FIELDS)[number];

/**
 * A free-text term matched against a receipt number or a transaction id.
 *
 * Trimmed, bounded, and optional. An empty string is rejected rather than
 * treated as absent: `?search=` is a client bug, and silently returning the
 * unfiltered ledger would hide it behind a plausible-looking response.
 */
const searchTerm = z.string().trim().min(1).max(SEARCH_MAX_LENGTH);

/**
 * An ISO date bound.
 *
 * Coerced because a search param is always a string. An unparseable value is
 * rejected rather than becoming an Invalid Date, which Prisma would either
 * reject opaquely or — worse — treat as a predicate that matches nothing.
 */
const dateBound = z.coerce.date();

/**
 * Reject an inverted range.
 *
 * `from` after `to` matches nothing, and an empty ledger is indistinguishable
 * from a student who has never paid. Refusing it turns a silent wrong answer
 * into a 400 the client can act on.
 */
function rangeIsOrdered(data: { dateFrom?: Date; dateTo?: Date }): boolean {
  if (data.dateFrom === undefined || data.dateTo === undefined) {
    return true;
  }

  return data.dateFrom <= data.dateTo;
}

const RANGE_MESSAGE = { message: "dateFrom must not be after dateTo" };

/** Query for the payment history list. */
export const paymentHistoryQuerySchema = paginationQuerySchema
  .extend({
    sortBy: z.enum(PAYMENT_SORT_FIELDS).default("paidAt"),
    sortOrder: sortOrderSchema,
    status: z.enum(PaymentStatus).optional(),
    method: z.enum(PaymentMethod).optional(),
    search: searchTerm.optional(),
    dateFrom: dateBound.optional(),
    dateTo: dateBound.optional(),
  })
  .refine(rangeIsOrdered, RANGE_MESSAGE);

export type PaymentHistoryQuery = z.infer<typeof paymentHistoryQuerySchema>;

/**
 * Query for the receipt list.
 *
 * No `status` filter, and its absence is the point: a receipt exists only for a
 * payment that SUCCEEDED. Offering a status filter would imply a receipt for a
 * failed payment can be listed, and the repository refuses to produce one.
 */
export const receiptListQuerySchema = paginationQuerySchema
  .extend({
    sortBy: z.enum(PAYMENT_SORT_FIELDS).default("paidAt"),
    sortOrder: sortOrderSchema,
    method: z.enum(PaymentMethod).optional(),
    search: searchTerm.optional(),
    dateFrom: dateBound.optional(),
    dateTo: dateBound.optional(),
  })
  .refine(rangeIsOrdered, RANGE_MESSAGE);

export type ReceiptListQuery = z.infer<typeof receiptListQuerySchema>;

/** Query for the pending-fee list. */
export const pendingFeeQuerySchema = paginationQuerySchema
  .extend({
    sortBy: z.enum(FEE_DEMAND_SORT_FIELDS).default("dueDate"),
    sortOrder: sortOrderSchema.removeDefault().default("asc"),
    status: z.enum(FeeStatus).optional(),
    semesterId: identifier.optional(),
    dueBefore: dateBound.optional(),
  })
  .strict();

export type PendingFeeQuery = z.infer<typeof pendingFeeQuerySchema>;

/**
 * Route param for a single receipt.
 *
 * `receiptId` is Payment.id, an opaque cuid, so no format is asserted: an
 * unrecognised but well-formed id must be a 404 rather than a 400.
 */
export const receiptParamSchema = z.object({
  receiptId: identifier,
});

export type ReceiptParam = z.infer<typeof receiptParamSchema>;

/**
 * Optional filter for the concession list.
 *
 * `feeType` narrows to concessions granted against a particular kind of fee.
 * There is no scholarship-name filter because there are no scholarship records
 * to name — see the repository header.
 */
export const scholarshipQuerySchema = z.object({
  semesterId: identifier.optional(),
  feeType: z.enum(FeeType).optional(),
});

export type ScholarshipQuery = z.infer<typeof scholarshipQuerySchema>;
