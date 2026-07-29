// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Academic Year
// FLOW   : Validates the academic year listing query, creation body, route
//          param and update body before any of them reach the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: No database access — Zod schema definitions only. Mirrors the
//          writable columns of the existing AcademicYear model.
// PURPOSE: Keep academic year request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

/**
 * Query schema for GET /api/academic-years.
 *
 * Pagination is the shared contract; no academic-year-specific filter is
 * defined, because README Phase 4 specifies listing only.
 */
export const listAcademicYearsQuerySchema = paginationQuerySchema;

export type ListAcademicYearsQuery = z.infer<typeof listAcademicYearsQuerySchema>;

/**
 * Route param schema for /api/academic-years/[id].
 *
 * AcademicYear.id is a cuid, but no format assertion is applied: the id is an
 * opaque key, and asserting a shape would turn an unrecognised-but-well-formed
 * id into a 400 when 404 is the accurate answer. Only an empty or
 * whitespace-only segment is rejected outright.
 */
export const academicYearIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type AcademicYearIdParam = z.infer<typeof academicYearIdParamSchema>;

/**
 * Body schema for POST /api/academic-years.
 *
 * Mirrors the writable scalar columns of the AcademicYear model. name,
 * startDate and endDate are required; isCurrent carries a schema default of
 * false, so an omitted key lets the database default apply.
 *
 * tenantId is intentionally absent: the tenant is derived from the validated
 * request context by requireTenant, never accepted from the client, so an
 * academic year cannot be created against another tenant.
 *
 * Dates are coerced from their JSON string form and rejected when unparseable.
 * No ordering rule is imposed between startDate and endDate, and no rule limits
 * how many years may carry isCurrent: the schema declares neither, and the
 * README states neither.
 *
 * Note that AcademicYear is unique on name — @@unique([tenantId, name]) — not
 * on a code column, and that the model carries createdAt but no updatedAt.
 */
export const createAcademicYearSchema = z.object({
  name: z.string().trim().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  isCurrent: z.boolean().optional(),
});

export type CreateAcademicYearInput = z.infer<typeof createAcademicYearSchema>;

/**
 * Body schema for PATCH /api/academic-years/[id].
 *
 * Derived from createAcademicYearSchema rather than restated, so the date
 * coercion and name rules stay defined in one place and cannot drift apart.
 *
 * tenantId is absent from the create schema, so .partial() cannot introduce it
 * — an academic year can never be moved between tenants through this endpoint.
 *
 * Every key is optional, but at least one must be present: an empty body is a
 * client error rather than a silent no-op.
 */
export const updateAcademicYearSchema = createAcademicYearSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateAcademicYearInput = z.infer<typeof updateAcademicYearSchema>;
