// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Programme Collection
// FLOW   : Validates the programme listing query and the programme creation
//          body before either reaches the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: No database access — Zod schema definitions only. Mirrors the
//          writable columns of the existing Programme model.
// PURPOSE: Keep programme request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { DurationUnit, ProgrammeType } from "@/app/generated/prisma/client";
import { paginationQuerySchema } from "./pagination";

/**
 * Query schema for GET /api/programmes.
 *
 * Pagination is the shared contract; no programme-specific filter is defined,
 * because README Phase 3 specifies listing only.
 */
export const listProgrammesQuerySchema = paginationQuerySchema;

export type ListProgrammesQuery = z.infer<typeof listProgrammesQuerySchema>;

/**
 * Body schema for POST /api/programmes.
 *
 * Mirrors the writable scalar columns of the Programme model. departmentId,
 * name, code and durationValue are required — every other column is nullable or
 * carries a schema default (type UNDERGRADUATE, durationUnit YEARS, isActive
 * true), so an omitted key lets the database default apply.
 *
 * tenantId is intentionally absent: the tenant is derived from the validated
 * request context by requireTenant, never accepted from the client, so a
 * programme cannot be created against another tenant.
 *
 * departmentId is validated here only for shape. Ownership — that the
 * department exists AND belongs to the authenticated tenant — cannot be
 * expressed in Zod and is enforced against the database in the route.
 *
 * durationValue and totalCredits are checked as integers only. The schema
 * declares them plain Int with no check constraint, so no range is imposed
 * here: rejecting a value the database would accept would be a business rule
 * that neither the schema nor the README states.
 */
export const createProgrammeSchema = z.object({
  departmentId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  type: z.enum(ProgrammeType).optional(),
  durationValue: z.number().int(),
  durationUnit: z.enum(DurationUnit).optional(),
  totalCredits: z.number().int().optional(),
  eligibility: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  isActive: z.boolean().optional(),
});

export type CreateProgrammeInput = z.infer<typeof createProgrammeSchema>;

/**
 * Route param schema for /api/programmes/[id].
 *
 * Programme.id is a cuid, but no format assertion is applied: the id is an
 * opaque key, and asserting a shape would turn an unrecognised-but-well-formed
 * id into a 400 when 404 is the accurate answer. Only an empty or
 * whitespace-only segment is rejected outright.
 */
export const programmeIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type ProgrammeIdParam = z.infer<typeof programmeIdParamSchema>;

/**
 * Body schema for PATCH /api/programmes/[id].
 *
 * Derived from createProgrammeSchema rather than restated, so the enum
 * membership, trimming and integer rules stay defined in one place and cannot
 * drift apart. That inheritance also carries the deliberate absence of a range
 * on durationValue and totalCredits, matching the schema.
 *
 * tenantId is absent from the create schema, so .partial() cannot introduce it
 * — a programme can never be moved between tenants through this endpoint.
 *
 * departmentId remains updatable but is only shape-checked here. That the
 * target department exists AND belongs to the authenticated tenant is enforced
 * against the database in the route.
 *
 * Every key is optional, but at least one must be present: an empty body is a
 * client error, not a silent no-op that would still advance updatedAt.
 *
 * As elsewhere, omitting a key leaves the column unchanged; there is no way to
 * clear a nullable column back to null through this endpoint.
 */
export const updateProgrammeSchema = createProgrammeSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateProgrammeInput = z.infer<typeof updateProgrammeSchema>;
