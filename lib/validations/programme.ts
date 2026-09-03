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
 * An optional free-text or id value from the query string.
 *
 * Empty and whitespace-only collapse to undefined. The filter controls write an
 * empty value when reset to "All departments", and useListParams removes the
 * key — but a hand-edited or bookmarked "?departmentId=" must mean "no filter"
 * rather than answer 400 to an obviously well-meant URL.
 *
 * NO FORMAT ASSERTION on the id. It is an opaque foreign key, and asserting a
 * cuid shape would turn an unrecognised-but-well-formed id into a 400 when an
 * empty result is the accurate answer. An id naming nothing — or naming another
 * tenant's department — simply matches no programme, because the tenant
 * predicate is ANDed alongside it in the route.
 */
const optionalFilter = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value === undefined || value === "" ? undefined : value));

/**
 * Query schema for GET /api/programmes.
 *
 * Pagination is the shared contract, extended with the three parameters this
 * screen's controls actually send: a free-text ?q, the ?departmentId filter and
 * the ?type filter. Nothing else is accepted — an unknown key is dropped by Zod
 * before the handler sees it, which is what keeps a client-supplied tenantId
 * from ever reaching the query.
 *
 * WHAT ?q SEARCHES
 *   Name and code — the two required, identifying columns on Programme, and the
 *   same pair the campus, school and department listings search, so every setup
 *   collection behaves identically.
 *
 * WHY THERE IS NO ?campusId OR ?schoolId HERE
 *   Programme has neither column. It carries departmentId alone, and campus and
 *   school are reached only THROUGH that department. This screen's own controls
 *   are Department and Type, so those are what the schema accepts. Adding
 *   campus and school filters would mean new controls and a nested relation
 *   filter — a change to the page, not a fix to it.
 *
 * ?type IS A CLOSED SET
 *   Unlike the opaque id, ProgrammeType is an enum the API defines, so a value
 *   outside it is a client error worth naming rather than silently ignoring.
 *   The control can only ever send a member of the set.
 */
export const listProgrammesQuerySchema = paginationQuerySchema.extend({
  q: optionalFilter,
  departmentId: optionalFilter,
  /**
   * Campus and school, which a Programme does NOT carry as columns.
   *
   * The tester asked for "All Campuses" and "All Schools" on this page and the
   * controls did nothing, because the schema accepted neither and Zod dropped
   * them before the handler could see them. They are accepted here and applied
   * through the relation the model actually has: Programme -> Department, where
   * Department carries campusId (required) and schoolId (nullable). Filtering
   * through the relation is what makes these real filters rather than labels;
   * see the where clause in app/api/programmes/route.ts.
   */
  campusId: optionalFilter,
  schoolId: optionalFilter,
  type: z
    .preprocess(
      // Reset writes an empty value; treat it as "no filter" BEFORE the enum
      // check, so "all types" is not reported as an invalid ProgrammeType.
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.nativeEnum(ProgrammeType).optional()
    )
    .optional(),
});

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
