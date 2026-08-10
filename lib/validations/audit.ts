import { z } from "zod";
import { identifier } from "@/lib/validations/shared";
import { AuditStatus } from "@/app/generated/prisma/enums";
import { AUDIT_MAX_PAGE_SIZE, AUDIT_PAGE_SIZE } from "@/lib/constants/audit";

// ============================================================================
// MODULE : Validations — Audit Log (WP-2, PRD §47)
// PURPOSE: Bound what the viewer may ask for.
//
// STRICT, DELIBERATELY
//   An unknown query parameter is a 400 rather than being ignored. A reader who
//   mistypes `?resourse=USER` and receives an unfiltered page of the whole
//   audit trail has been shown far more than they asked for, and will believe
//   they are looking at a filtered view.
//
// `action` AND `resource` ARE FREE STRINGS, NOT ENUMS
//   Eleven modules wrote audit rows before WP-2 existed, each with its own
//   action vocabulary. Constraining the filter to WP-2's catalogue would make
//   every one of those rows unfindable — the filter would reject the only value
//   that matches them. Length-capped instead, and matched exactly.
// ============================================================================

/**
 * A calendar date the reader typed, as YYYY-MM-DD.
 *
 * Interpreted at UTC midnight so it compares cleanly against a timestamp
 * column, and stated explicitly rather than relying on Date parsing so a future
 * format change cannot silently introduce a local timezone offset.
 */
const fromDate = z.iso
  .date()
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

/**
 * The end of the range, advanced to the FOLLOWING midnight.
 *
 * A reader asking for "to 5 August" means the whole of the 5th. Comparing
 * `<= 2026-08-05T00:00:00Z` would silently drop everything after midnight —
 * which is every entry of that day — and the reader would conclude nothing
 * happened. The query uses `lt` against this advanced value.
 */
const toDate = z.iso.date().transform((value) => {
  const midnight = new Date(`${value}T00:00:00.000Z`);
  midnight.setUTCDate(midnight.getUTCDate() + 1);
  return midnight;
});

export const auditLogQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(AUDIT_MAX_PAGE_SIZE).default(AUDIT_PAGE_SIZE),
    action: z.string().trim().min(1).max(64).optional(),
    resource: z.string().trim().min(1).max(64).optional(),
    resourceId: z.string().trim().min(1).max(64).optional(),
    status: z.enum(AuditStatus).optional(),
    userId: identifier.optional(),
    from: fromDate.optional(),
    to: toDate.optional(),
  })
  .strict()
  .refine(
    (value) => !value.from || !value.to || value.from < value.to,
    // Silently swapping them would answer a question the reader did not ask.
    { message: "The start of the range must fall before its end.", path: ["to"] }
  );

export const auditLogParamSchema = z.object({ id: identifier });
