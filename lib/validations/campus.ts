// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Campus Management
// FLOW   : Validates the campus listing query and the campus creation body
//          before either reaches the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: No database access — Zod schema definitions only. Mirrors the
//          writable columns of the existing Campus model.
// PURPOSE: Keep campus request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

/**
 * Query schema for GET /api/campuses.
 *
 * Pagination is the shared contract, extended with an optional free-text ?q.
 *
 * WHAT ?q SEARCHES, AND WHY ONLY THAT
 *   Name and code. Those are the two required, identifying columns on Campus
 *   and the two an administrator uses to refer to one — "Delhi Campus", "JPR".
 *   Phone and email are contact details rather than identifiers; matching a
 *   campus because a fragment of its phone number contained the typed digits
 *   would be a result nobody could account for. Narrow and predictable beats
 *   broad and surprising.
 *
 * AN EMPTY ?q IS "NO SEARCH", NOT AN ERROR
 *   Clearing the box removes the key entirely (useListParams deletes empty
 *   values), but a hand-edited or bookmarked "?q=" must not answer 400 for
 *   what is plainly a request for the unfiltered list. It is normalised to
 *   undefined here so the route has one shape to reason about.
 *
 * tenantId is deliberately absent, exactly as in the create schema: the tenant
 * comes from requireTenant, so no query can widen the search past its own
 * institution.
 */
export const listCampusesQuerySchema = paginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value === undefined || value === "" ? undefined : value)),
});

export type ListCampusesQuery = z.infer<typeof listCampusesQuerySchema>;

/**
 * Body schema for POST /api/campuses.
 *
 * Mirrors the writable scalar columns of the Campus model. Only name and code
 * are required — address, phone and email are nullable, and isMain carries a
 * schema default of false, so an omitted key lets the database default apply.
 *
 * tenantId is intentionally absent: the tenant is derived from the validated
 * request context by requireTenant, never accepted from the client, so a
 * campus cannot be created against another tenant.
 *
 * isMain is stored exactly as supplied. The schema places no unique constraint
 * on it and the README defines no "only one main campus" rule, so none is
 * enforced here.
 */
export const createCampusSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  address: z.record(z.string(), z.unknown()).optional(),
  phone: z.string().trim().min(1).optional(),
  email: z.email().optional(),
  isMain: z.boolean().optional(),
});

export type CreateCampusInput = z.infer<typeof createCampusSchema>;

/**
 * Route param schema for /api/campuses/[id].
 *
 * Campus.id is a cuid, but no format assertion is applied: the id is an opaque
 * key, and asserting a shape would turn an unrecognised-but-well-formed id into
 * a 400 when 404 is the accurate answer. Only an empty or whitespace-only
 * segment is rejected outright.
 */
export const campusIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type CampusIdParam = z.infer<typeof campusIdParamSchema>;

/**
 * Body schema for PATCH /api/campuses/[id].
 *
 * Derived from createCampusSchema rather than restated, so the email format,
 * trimming and field rules stay defined in one place and cannot drift apart.
 *
 * tenantId is absent from the create schema, so .partial() cannot introduce it
 * — a campus can never be moved between tenants through this endpoint.
 *
 * Every key is optional, but at least one must be present: an empty body is a
 * client error, not a silent no-op that would still advance updatedAt.
 *
 * As elsewhere, omitting a key leaves the column unchanged; there is no way to
 * clear a nullable column back to null through this endpoint.
 */
export const updateCampusSchema = createCampusSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateCampusInput = z.infer<typeof updateCampusSchema>;
