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

/** Query schema for GET /api/batches. */
export const listBatchesQuerySchema = paginationQuerySchema;

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
