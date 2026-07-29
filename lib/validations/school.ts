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
 * Pagination is the shared contract; no school-specific filter is defined,
 * because README Phase 3 specifies listing only.
 */
export const listSchoolsQuerySchema = paginationQuerySchema;

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
