// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Batch
// FLOW   : Validates the batch listing query, creation body, route param and
//          update body before any of them reach the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: No database access — Zod schema definitions only. Mirrors the
//          writable columns of the existing Batch model.
// PURPOSE: Keep batch request validation declarative and in one place, matching
//          the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

/**
 * A filter value that may legitimately arrive empty.
 *
 * The same definition the other setup collections use (see campus.ts and
 * department.ts). The filter controls remove their key from the URL when reset
 * to "All programmes"/"All years", but a hand-edited or bookmarked
 * "?programmeId=" must mean "no filter" rather than answer 400 to an obviously
 * well-meant URL.
 *
 * NO FORMAT ASSERTION on the ids. They are opaque foreign keys, and asserting a
 * cuid shape would turn an unrecognised-but-well-formed id into a 400 when an
 * empty result is the accurate answer. An id naming nothing — or naming another
 * tenant's row — simply matches no batches, because the tenant predicate is
 * ANDed alongside it in the route.
 */
const optionalFilter = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value === undefined || value === "" ? undefined : value));

/**
 * Query schema for GET /api/batches.
 *
 * Pagination is the shared contract, extended with the three parameters the
 * Batches screen's controls actually send: a free-text ?q, and the
 * ?programmeId and ?academicYearId filters. Nothing else is accepted — an
 * unknown key is dropped by Zod before the handler sees it, which is what keeps
 * a client-supplied tenantId from ever reaching the query.
 *
 * WHAT ?q SEARCHES
 *   name and code — the two required, identifying columns on Batch, and the
 *   same pair GET /api/campuses, /api/schools, /api/departments and
 *   /api/programmes search, so every setup collection behaves identically.
 *
 * WHY THIS EXISTED BEFORE AND DID NOTHING
 *   The page has always rendered an ENABLED search box and two ENABLED filters
 *   and has always sent these three keys. The schema was pagination-only, so
 *   Zod dropped them and the route read every batch in the tenant. A control
 *   that accepts input and silently returns the unfiltered list is worse than
 *   no control, because the reader believes they have searched.
 */
export const listBatchesQuerySchema = paginationQuerySchema.extend({
  q: optionalFilter,
  programmeId: optionalFilter,
  academicYearId: optionalFilter,
});

export type ListBatchesQuery = z.infer<typeof listBatchesQuerySchema>;

/**
 * Route param schema for /api/batches/[id].
 *
 * Ids in this schema are cuids, not UUIDs, so no UUID assertion is applied —
 * it would reject every legitimate id. An unrecognised-but-well-formed id is a
 * 404 rather than a 400.
 */
export const batchIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type BatchIdParam = z.infer<typeof batchIdParamSchema>;

/**
 * Body schema for POST /api/batches.
 *
 * Mirrors the writable scalar columns of the Batch model. programmeId,
 * academicYearId, name and code are required; maxStrength is nullable.
 *
 * tenantId is intentionally absent: the tenant is derived from the validated
 * request context, never accepted from the client.
 *
 * programmeId and academicYearId are validated here only for shape. That each
 * exists AND belongs to the authenticated tenant is enforced against the
 * database in the route.
 *
 * maxStrength is checked as an integer only. The schema declares it plain Int?
 * with no check constraint, so no range is imposed.
 *
 * Note that Batch carries createdAt but no updatedAt.
 */
export const createBatchSchema = z.object({
  programmeId: z.string().trim().min(1),
  academicYearId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  maxStrength: z.number().int().optional(),
});

export type CreateBatchInput = z.infer<typeof createBatchSchema>;

/**
 * Body schema for PATCH /api/batches/[id].
 *
 * Derived from createBatchSchema so the trimming and integer rules stay defined
 * once. tenantId cannot appear, so a batch can never be moved between tenants.
 *
 * Every key is optional, but at least one must be present.
 */
export const updateBatchSchema = createBatchSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateBatchInput = z.infer<typeof updateBatchSchema>;
