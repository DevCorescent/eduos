// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Schools Collection
// FLOW   : Validates the school listing query and the school creation body
//          before either reaches the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: No database access — Zod schema definitions only. Mirrors the
//          writable columns of the existing School model.
// PURPOSE: Keep school request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

/**
 * Query schema for GET /api/schools.
 *
 * Pagination is the shared contract, extended with an optional free-text ?q —
 * the same contract GET /api/campuses uses, so the two setup collections are
 * searched the same way and neither has to be learned separately.
 *
 * WHAT ?q SEARCHES
 *   Name and code: the two required, identifying columns on School, and the
 *   two an administrator uses to refer to one. deanName and email are people
 *   and contact details rather than identifiers — matching a school because a
 *   fragment of its dean's name contained the typed letters would be a result
 *   nobody could account for.
 *
 * AN EMPTY ?q IS "NO SEARCH", NOT AN ERROR
 *   Clearing the box removes the key entirely, but a hand-edited or bookmarked
 *   "?q=" must not answer 400 for what is plainly a request for the whole list.
 *   It is normalised to undefined so the route has one shape to reason about.
 *
 * tenantId is deliberately absent, exactly as in the create schema: the tenant
 * comes from requireTenant, so no query can widen the search past its own
 * institution.
 */
export const listSchoolsQuerySchema = paginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value === undefined || value === "" ? undefined : value)),
});

export type ListSchoolsQuery = z.infer<typeof listSchoolsQuerySchema>;

/**
 * Body schema for POST /api/schools.
 *
 * Mirrors the writable scalar columns of the School model. campusId, name and
 * code are required; deanName and email are nullable in the schema.
 *
 * tenantId is intentionally absent: the tenant is derived from the validated
 * request context by requireTenant, never accepted from the client, so a school
 * cannot be created against another tenant.
 *
 * campusId is validated here only for shape. Ownership — that the campus exists
 * AND belongs to the authenticated tenant — cannot be expressed in Zod and is
 * enforced against the database in the route.
 */
export const createSchoolSchema = z.object({
  campusId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  deanName: z.string().trim().min(1).optional(),
  email: z.email().optional(),
});

export type CreateSchoolInput = z.infer<typeof createSchoolSchema>;

/**
 * Route param schema for /api/schools/[id].
 *
 * School.id is a cuid, but no format assertion is applied: the id is an opaque
 * key, and asserting a shape would turn an unrecognised-but-well-formed id into
 * a 400 when 404 is the accurate answer. Only an empty or whitespace-only
 * segment is rejected outright.
 */
export const schoolIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type SchoolIdParam = z.infer<typeof schoolIdParamSchema>;

/**
 * Body schema for PATCH /api/schools/[id].
 *
 * Derived from createSchoolSchema rather than restated, so the trimming, email
 * format and field rules stay defined in one place and cannot drift apart.
 *
 * tenantId is absent from the create schema, so .partial() cannot introduce it
 * — a school can never be moved between tenants through this endpoint.
 *
 * campusId remains updatable but is only shape-checked here. That the target
 * campus exists AND belongs to the authenticated tenant cannot be expressed in
 * Zod and is enforced against the database in the route.
 *
 * Every key is optional, but at least one must be present: an empty body is a
 * client error, not a silent no-op that would still advance updatedAt.
 *
 * As elsewhere, omitting a key leaves the column unchanged; there is no way to
 * clear a nullable column back to null through this endpoint.
 */
export const updateSchoolSchema = createSchoolSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateSchoolInput = z.infer<typeof updateSchoolSchema>;
