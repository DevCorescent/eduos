// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty — Non-Teaching Employee Validation
// FLOW   : Validates the employee listing query, route param, creation body and
//          update body before any of them reach the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Keep employee request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { EmployeeStatus, EmployeeType } from "@/app/generated/prisma/client";
import { paginationQuerySchema } from "./pagination";

/**
 * A filter the toolbar may send empty.
 *
 * Restated here rather than shared, matching how each validation module in this
 * project keeps its own copy. "" means "no filter": the ListFilter reset writes
 * an empty value, and a hand-edited or bookmarked "?departmentId=" must mean the
 * same rather than answer 400.
 *
 * NO FORMAT ASSERTION on the id: it is an opaque key, and one naming nothing —
 * or naming another tenant's row — simply matches no employees, because the
 * tenant predicate is ANDed alongside it in the route.
 */
const optionalFilter = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value === undefined || value === "" ? undefined : value));

/**
 * Query schema for GET /api/employees — tester issue #28.
 *
 * WHAT WAS WRONG
 *   This was `paginationQuerySchema` and nothing else, so Zod dropped ?q,
 *   ?status, ?type and ?departmentId before the handler saw them and the route
 *   read every employee in the tenant. The Employees page knew: it rendered its
 *   search box and all three filters DISABLED, with a note saying they would
 *   work once the backend accepted the parameters. This is that.
 *
 *   The page has always read the four parameters from its searchParams, passed
 *   them to listEmployees and carried them through pagination, so nothing there
 *   changes except removing the disabled state.
 *
 * WHY status AND type ARE PREPROCESSED
 *   "All statuses" and "All types" write an empty value. Treating it as absent
 *   BEFORE the enum check is what stops "no filter" being reported as an invalid
 *   EmployeeStatus or EmployeeType — the same reason listStudentsQuerySchema
 *   does it for StudentStatus.
 */
export const employeeQuerySchema = paginationQuerySchema.extend({
  q: optionalFilter,
  departmentId: optionalFilter,
  status: z
    .preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.nativeEnum(EmployeeStatus).optional()
    )
    .optional(),
  type: z
    .preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.nativeEnum(EmployeeType).optional()
    )
    .optional(),
});

export type EmployeeQuery = z.infer<typeof employeeQuerySchema>;

/**
 * Route param schema for /api/employees/[id].
 *
 * Employee.id is a cuid, not a UUID, so no UUID assertion is applied — it would
 * reject every legitimate id. The value is an opaque key, and an
 * unrecognised-but-well-formed one is a 404 rather than a 400. Only an empty or
 * whitespace-only segment is rejected outright.
 */
export const employeeIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type EmployeeIdParam = z.infer<typeof employeeIdParamSchema>;

/**
 * Body schema for POST /api/employees.
 *
 * Mirrors the writable scalar columns of the Employee model. userId, employeeId
 * and joinDate are required; departmentId and designation are nullable, and type
 * and status carry schema defaults (NON_TEACHING and ACTIVE), so an omitted key
 * lets the database default apply.
 *
 * tenantId is intentionally absent, along with id, createdAt and updatedAt: the
 * tenant is derived from the validated request context by requireTenant, never
 * accepted from the client, so an employee cannot be created against another
 * tenant.
 *
 * userId and departmentId are validated here only for shape. That each
 * referenced row exists AND belongs to the authenticated tenant is enforced
 * against the database in the route. The two are not equally protected there:
 * Employee.userId carries a foreign key, but Employee.departmentId has neither a
 * relation nor a foreign key in the schema — unlike FacultyMember.departmentId,
 * which does — so for that column the route's lookup is the only check that
 * exists anywhere.
 *
 * Two uniqueness rules apply and both are the route's to check: Employee.userId
 * is @unique globally, so a user may hold at most one employee record, while
 * @@unique([tenantId, employeeId]) makes an employee id unique within the tenant
 * and allows the same id under a different tenant.
 *
 * Employee has no experience column, so the non-negative bound applied to
 * FacultyMember.experience has no counterpart here.
 */
export const createEmployeeSchema = z.object({
  userId: z.string().trim().min(1),
  /**
   * Optional since WP-1: omitted, the identifier engine issues it from the
   * institution's configured sequence (PRD §9). Supplied, the value is used
   * as given, which is what keeps legacy imports and institutions without a
   * configured sequence working exactly as before.
   */
  employeeId: z.string().trim().min(1).optional(),
  joinDate: z.coerce.date(),
  departmentId: z.string().trim().min(1).optional(),
  designation: z.string().trim().min(1).optional(),
  type: z.enum(EmployeeType).optional(),
  status: z.enum(EmployeeStatus).optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

/**
 * Body schema for PATCH /api/employees/[id].
 *
 * Derived from createEmployeeSchema rather than restated, so the enum
 * membership, date coercion and trimming rules stay defined in one place and
 * cannot drift apart.
 *
 * userId is omitted before the schema is made partial, leaving only mutable
 * columns. An employee record stays permanently bound to the User it was created
 * against: re-pointing one at a different person is an account transfer rather
 * than a profile edit, and no such feature is described in the schema or the
 * README. This matches the restriction already applied to Student.userId and
 * FacultyMember.userId.
 *
 * tenantId is absent from the create schema, so .partial() cannot introduce it
 * — an employee can never be moved between tenants through this endpoint.
 *
 * Every remaining key is optional, but at least one must be present: an empty
 * body is a client error, not a silent no-op that would still advance updatedAt.
 *
 * As elsewhere, omitting a key leaves the column unchanged; there is no way to
 * clear a nullable column back to null through this endpoint.
 */
export const updateEmployeeSchema = createEmployeeSchema
  .omit({ userId: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
