// ============================================================================
// OWNER  : Gauransh
// MODULE : Students — Parent and Student-Parent Link Validation
// FLOW   : Validates the parent creation body, the student-parent listing query
//          and the link body before any of them reach the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Keep parent-domain request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

/**
 * Accepted shape for Parent.annualIncome, read directly off the column's
 * @db.Decimal(12, 2): at most ten integer digits and two fractional digits.
 *
 * Without this bound an oversized value reaches Postgres and surfaces as a
 * numeric-overflow 500 rather than a clean 400.
 *
 * A leading minus is permitted. The bound imposed here is precision only,
 * because that is what the column declares; the schema places no check
 * constraint on the sign, so none is imposed. Note that this differs from
 * Subscription.pricePerMonth, whose pattern excludes negatives — a price and an
 * income are not the same quantity, and only the latter can legitimately be
 * reported as a loss.
 */
const ANNUAL_INCOME_PATTERN = /^-?\d{1,10}(\.\d{1,2})?$/;

/**
 * Body schema for POST /api/parents.
 *
 * Mirrors the writable scalar columns of the Parent model. firstName, lastName,
 * phone and relation are required — phone and relation are both non-null in the
 * schema — while email, occupation and annualIncome are nullable.
 *
 * tenantId is intentionally absent: the tenant is derived from the validated
 * request context by requireTenant, never accepted from the client, so a parent
 * cannot be created against another tenant.
 *
 * relation is a free-form String in the schema, not an enum, so no vocabulary
 * is enforced for it here. Neither the schema nor the README defines a set of
 * permitted values.
 *
 * annualIncome is passed through as given. A string preserves trailing zeros
 * ("50000.00"), which Prisma accepts directly for a Decimal column, so no
 * conversion is performed that could lose precision.
 *
 * Parent carries no unique constraint beyond its primary key, so two parents
 * with identical details are a legitimate outcome and creation has no duplicate
 * case to reject.
 */
export const createParentSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  relation: z.string().trim().min(1),
  email: z.email().optional(),
  occupation: z.string().trim().min(1).optional(),
  annualIncome: z
    .union([z.number(), z.string()])
    .refine((value) => ANNUAL_INCOME_PATTERN.test(String(value)))
    .optional(),
});

export type CreateParentInput = z.infer<typeof createParentSchema>;

/**
 * Query schema for GET /api/students/[id]/parents.
 *
 * Pagination is the shared contract. No search or filter parameter is defined:
 * the project implements none on any existing collection endpoint.
 */
export const listStudentParentsQuerySchema = paginationQuerySchema;

export type ListStudentParentsQuery = z.infer<typeof listStudentParentsQuerySchema>;

/**
 * Body schema for POST /api/students/[id]/parents.
 *
 * Mirrors the writable columns of the StudentParent join model that a client
 * may supply. StudentParent has a composite primary key, @@id([studentId,
 * parentId]), and no id column of its own.
 *
 * studentId is intentionally absent: it comes from the route parameter, so a
 * parent can never be linked to a student other than the one addressed by the
 * URL.
 *
 * isPrimary carries a schema default of false. The schema places no constraint
 * limiting a student to a single primary parent and the README describes none,
 * so no such rule is enforced — linking two primary parents is permitted.
 *
 * The endpoint links an existing parent rather than creating one inline:
 * README Phase 6 assigns parent creation to POST /api/parents and describes
 * this route as "List / link parents".
 */
export const linkParentSchema = z.object({
  parentId: z.string().trim().min(1),
  isPrimary: z.boolean().optional(),
});

export type LinkParentInput = z.infer<typeof linkParentSchema>;
