// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Semester
// FLOW   : Validates the semester listing query, creation body, route param and
//          update body before any of them reach the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: No database access — Zod schema definitions only. Mirrors the
//          writable columns of the existing Semester model.
// PURPOSE: Keep semester request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

/** Query schema for GET /api/academic-years/[id]/semesters. */
export const listSemestersQuerySchema = paginationQuerySchema;

export type ListSemestersQuery = z.infer<typeof listSemestersQuerySchema>;

/**
 * Route param schema for /api/semesters/[id].
 *
 * Ids in this schema are cuids, not UUIDs, so no UUID assertion is applied —
 * it would reject every legitimate id. The value is an opaque key, and an
 * unrecognised-but-well-formed one is a 404 rather than a 400. Only an empty or
 * whitespace-only segment is rejected outright.
 */
export const semesterIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type SemesterIdParam = z.infer<typeof semesterIdParamSchema>;

/**
 * Body schema for POST /api/academic-years/[id]/semesters.
 *
 * Mirrors the writable scalar columns of the Semester model. name,
 * semesterNumber, startDate and endDate are required; isCurrent carries a
 * schema default of false.
 *
 * Two fields are deliberately absent so a client cannot supply them:
 *  - tenantId, derived from the validated request context.
 *  - academicYearId, taken from the route parameter, so a semester can never be
 *    attached to an academic year other than the one addressed by the URL.
 *
 * Semester is unique on @@unique([academicYearId, semesterNumber]) — scoped to
 * the academic year, not the tenant — so the same semester number may exist
 * under a different academic year.
 *
 * Note that Semester carries createdAt but no updatedAt.
 */
export const createSemesterSchema = z.object({
  name: z.string().trim().min(1),
  semesterNumber: z.number().int(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  isCurrent: z.boolean().optional(),
});

export type CreateSemesterInput = z.infer<typeof createSemesterSchema>;

/**
 * Body schema for PATCH /api/semesters/[id].
 *
 * Derived from createSemesterSchema so the date coercion, integer and name
 * rules stay defined once. Neither tenantId nor academicYearId can appear, so a
 * semester cannot be moved between tenants or reparented to another academic
 * year through this endpoint.
 *
 * Every key is optional, but at least one must be present.
 */
export const updateSemesterSchema = createSemesterSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateSemesterInput = z.infer<typeof updateSemesterSchema>;
