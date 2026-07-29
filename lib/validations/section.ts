// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Section
// FLOW   : Validates the section listing query, creation body, route param and
//          update body before any of them reach the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: No database access — Zod schema definitions only. Mirrors the
//          writable columns of the existing Section model.
// PURPOSE: Keep section request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

/** Query schema for GET /api/batches/[id]/sections. */
export const listSectionsQuerySchema = paginationQuerySchema;

export type ListSectionsQuery = z.infer<typeof listSectionsQuerySchema>;

/**
 * Route param schema for /api/sections/[id].
 *
 * Ids are cuids, not UUIDs, so only non-empty validation is applied.
 * An unrecognised-but-well-formed id results in 404 rather than 400.
 */
export const sectionIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type SectionIdParam = z.infer<typeof sectionIdParamSchema>;

/**
 * Body schema for POST /api/batches/[id]/sections.
 *
 * Mirrors the writable scalar columns of the Section model.
 *
 * semesterId and name are required.
 * maxStrength is optional.
 *
 * batchId is intentionally absent because it comes from the route.
 * tenantId is intentionally absent because it comes from the
 * authenticated request context.
 *
 * semesterId is validated only for shape here.
 * Ownership is verified against the database in the route.
 */
export const createSectionSchema = z.object({
  semesterId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  maxStrength: z.number().int().optional(),
});

export type CreateSectionInput = z.infer<typeof createSectionSchema>;

/**
 * Body schema for PATCH /api/sections/[id].
 *
 * Derived from createSectionSchema so all field rules stay defined once.
 *
 * batchId is absent from the create schema because creation addresses the batch
 * through the route, but it is accepted here: the schema models Section.batchId
 * as an ordinary mutable column, and the route already verifies that a changed
 * batch belongs to the authenticated tenant before applying it. Adding it here
 * rather than in createSectionSchema keeps POST unable to target a batch other
 * than the one in its URL.
 *
 * tenantId remains absent throughout, so a section can never be moved between
 * tenants.
 *
 * Every field is optional but at least one must be supplied.
 */
export const updateSectionSchema = createSectionSchema
  .partial()
  .extend({ batchId: z.string().trim().min(1).optional() })
  .refine((data) => Object.keys(data).length > 0);

export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;