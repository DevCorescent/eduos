// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Programme Specialisations
// FLOW   : Validates the specialisation listing query and the specialisation
//          creation body before either reaches the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: No database access — Zod schema definitions only. Mirrors the
//          writable columns of the existing Specialisation model.
// PURPOSE: Keep specialisation request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

/**
 * Query schema for GET /api/programmes/[id]/specialisations.
 *
 * Pagination is the shared contract; no specialisation-specific filter is
 * defined, because README Phase 3 specifies listing only. The programme is
 * taken from the route parameter, not from the query string.
 */
export const listSpecialisationsQuerySchema = paginationQuerySchema;

export type ListSpecialisationsQuery = z.infer<typeof listSpecialisationsQuerySchema>;

/**
 * Body schema for POST /api/programmes/[id]/specialisations.
 *
 * Mirrors the writable scalar columns of the Specialisation model. name and
 * code are required; description is nullable and isActive carries a schema
 * default of true, so an omitted key lets the database default apply.
 *
 * Two fields are deliberately absent so they cannot be supplied by a client:
 *  - tenantId, which is derived from the validated request context.
 *  - programmeId, which is taken from the route parameter. A body-supplied
 *    programmeId is stripped by Zod before Prisma sees it, so a specialisation
 *    can never be attached to a programme other than the one addressed by the
 *    URL.
 *
 * Note that Specialisation.code is unique per TENANT — @@unique([tenantId,
 * code]) — not per programme, so the same code cannot be reused under a
 * different programme of the same tenant. That is the schema's constraint and
 * is enforced as written rather than narrowed to the programme.
 */
export const createSpecialisationSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  isActive: z.boolean().optional(),
});

export type CreateSpecialisationInput = z.infer<typeof createSpecialisationSchema>;
