// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Departments Collection
// FLOW   : Validates the department listing query and the department creation
//          body before either reaches the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: No database access — Zod schema definitions only. Mirrors the
//          writable columns of the existing Department model.
// PURPOSE: Keep department request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

/**
 * An optional filter value from the query string.
 *
 * Empty and whitespace-only collapse to undefined. The filter controls write an
 * empty value when reset to "All campuses"/"All schools", and useListParams
 * removes the key — but a hand-edited or bookmarked "?campusId=" must mean "no
 * filter" rather than answer 400 to an obviously well-meant URL.
 *
 * NO FORMAT ASSERTION. These are opaque foreign keys, and asserting a cuid
 * shape would turn an unrecognised-but-well-formed id into a 400 when an empty
 * result is the accurate answer. An id naming nothing — or naming another
 * tenant's row — simply matches no departments, because the tenant predicate is
 * ANDed alongside it in the route.
 */
const optionalFilter = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value === undefined || value === "" ? undefined : value));

/**
 * Query schema for GET /api/departments.
 *
 * Pagination is the shared contract, extended with the three parameters this
 * screen's controls actually send: a free-text ?q, and the ?campusId and
 * ?schoolId filters. Nothing else is accepted — an unknown key is dropped by
 * Zod before the handler sees it, which is what keeps a client-supplied
 * tenantId from ever reaching the query.
 *
 * WHAT ?q SEARCHES
 *   Name and code — the two required, identifying columns on Department, and
 *   the same pair GET /api/campuses and GET /api/schools search, so the three
 *   setup collections behave identically. hodName and email are a person and a
 *   contact detail rather than identifiers.
 *
 * WHY BOTH IDs ARE PLAIN COLUMNS HERE
 *   Department carries campusId AND schoolId directly, so neither filter needs
 *   to reach through a relation. schoolId is nullable — a standalone department
 *   belongs to no school — so filtering by a school correctly excludes them.
 */
export const listDepartmentsQuerySchema = paginationQuerySchema.extend({
  q: optionalFilter,
  campusId: optionalFilter,
  schoolId: optionalFilter,
});

export type ListDepartmentsQuery = z.infer<typeof listDepartmentsQuerySchema>;

/**
 * Body schema for POST /api/departments.
 *
 * Mirrors the writable scalar columns of the Department model. campusId, name
 * and code are required; schoolId, hodName and email are nullable in the
 * schema, so an omitted key lets the column stay null.
 *
 * tenantId is intentionally absent: the tenant is derived from the validated
 * request context by requireTenant, never accepted from the client, so a
 * department cannot be created against another tenant.
 *
 * campusId and schoolId are validated here only for shape. Ownership — that
 * each referenced row exists AND belongs to the authenticated tenant — cannot
 * be expressed in Zod and is enforced against the database in the route.
 *
 * Note that the schema models campusId and schoolId independently: it does not
 * require the referenced school to belong to the referenced campus, and no such
 * rule is imposed here because neither the schema nor the README states one.
 */
export const createDepartmentSchema = z.object({
  campusId: z.string().trim().min(1),
  schoolId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  hodName: z.string().trim().min(1).optional(),
  email: z.email().optional(),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

/**
 * Route param schema for /api/departments/[id].
 *
 * Department.id is a cuid, but no format assertion is applied: the id is an
 * opaque key, and asserting a shape would turn an unrecognised-but-well-formed
 * id into a 400 when 404 is the accurate answer. Only an empty or
 * whitespace-only segment is rejected outright.
 */
export const departmentIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type DepartmentIdParam = z.infer<typeof departmentIdParamSchema>;

/**
 * Body schema for PATCH /api/departments/[id].
 *
 * Derived from createDepartmentSchema rather than restated, so the trimming,
 * email format and field rules stay defined in one place and cannot drift
 * apart.
 *
 * tenantId is absent from the create schema, so .partial() cannot introduce it
 * — a department can never be moved between tenants through this endpoint.
 *
 * campusId and schoolId remain updatable but are only shape-checked here. That
 * each referenced row exists AND belongs to the authenticated tenant is
 * enforced against the database in the route. No relationship between the two
 * is imposed, matching the schema.
 *
 * Every key is optional, but at least one must be present: an empty body is a
 * client error, not a silent no-op that would still advance updatedAt.
 *
 * As elsewhere, omitting a key leaves the column unchanged; there is no way to
 * clear a nullable column back to null through this endpoint.
 */
export const updateDepartmentSchema = createDepartmentSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
