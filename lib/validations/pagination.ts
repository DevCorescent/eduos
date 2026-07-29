// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Shared Pagination
// FLOW   : Coerces and validates ?page and ?limit search params before a route
//          performs any database work.
// ACCESS : Shared helper — no access control of its own.
// BACKEND: No database access — Zod schema definitions only.
// PURPOSE: Single definition of the pagination contract so tenant-scoped list
//          endpoints do not each restate the same page and limit rules.
// ============================================================================

import { z } from "zod";

/** Page size applied when ?limit is omitted. */
const DEFAULT_PAGE_SIZE = 20;

/** Upper bound on ?limit, so a single request cannot ask for every row. */
const MAX_PAGE_SIZE = 100;

/**
 * Query schema for paginated list endpoints.
 *
 * Search params always arrive as strings, so page and limit are coerced before
 * the integer and range checks. Both are optional — an omitted param falls back
 * to its default rather than failing validation.
 *
 * The Platform module carries an equivalent inline definition predating this
 * file. Those endpoints are complete and verified, so they are deliberately
 * left untouched rather than refactored onto this schema.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
