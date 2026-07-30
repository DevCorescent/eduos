// ============================================================================
// OWNER  : Gauransh
// MODULE : Finance — Fee Structure Validation
// FLOW   : Validates the fee-structure route params and request bodies, including
//          the nested fee components, before either reaches the database.
// ACCESS : Not defined. The README's Phase 11 table names the routes but states
//          no role for them, and no approved decision assigns one, so none is
//          assumed here. Access control is performed by requireRole and the
//          routes regardless — this module never inspects a caller.
// BACKEND: No database access — Zod schema definitions only. No uniqueness
//          check, no tenant check and no foreign-key existence check is
//          performed here; each belongs to the route.
// PURPOSE: Keep fee-structure request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { FeeType } from "@/app/generated/prisma/client";

/**
 * Accepted shape for FeeComponent.amount, read directly off the column's
 * @db.Decimal(10, 2): at most eight integer digits and two fractional digits,
 * non-negative.
 *
 * Without this bound an oversized value reaches Postgres and surfaces as a
 * numeric-overflow 500 rather than a clean 400 — the same reason
 * Subscription.pricePerMonth and Parent.annualIncome carry patterns of their
 * own.
 *
 * The sign is excluded, matching pricePerMonth rather than annualIncome. The
 * project decides this per column: an income can legitimately be reported as a
 * loss, a price cannot be negative. A fee component is a charge — every FeeType
 * member names one — and the schema models reductions elsewhere, through
 * FeeStatus.WAIVED and the waiver endpoint the README defines on a demand, not
 * as a negative component. No other bound is imposed: the column carries no
 * check constraint and neither the schema nor the README states a maximum.
 */
const AMOUNT_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * Accepted shape for FeeComponent.taxPercent, read directly off the column's
 * @db.Decimal(5, 2): at most three integer digits and two fractional digits,
 * non-negative.
 *
 * Precision and sign only. No upper bound of 100 is imposed: the column permits
 * up to 999.99 and neither the schema nor the README caps a tax rate, so
 * capping it here would be an assumption rather than a rule.
 */
const TAX_PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

/**
 * A Decimal column input, bounded by the pattern its column declares.
 *
 * Accepts a number or a string and passes the value through as given. A string
 * preserves trailing zeros ("1500.00"), which Prisma accepts directly for a
 * Decimal column, so no conversion is performed that could lose precision. This
 * is the shape already used for Subscription.pricePerMonth and
 * Parent.annualIncome.
 */
function decimalMatching(pattern: RegExp) {
  return z.union([z.number(), z.string()]).refine((value) => pattern.test(String(value)));
}

/**
 * One fee component nested inside a structure.
 *
 * Mirrors the writable scalar columns of the FeeComponent model, in column
 * order. Module-private rather than exported, following the convention set by
 * timeOfDay in the timetable module and attachmentList in the assignment and
 * submission modules: it is a building block of the exported schemas, not a
 * request contract of its own. A route needing the element type derives it as
 * CreateFeeStructureInput["components"][number].
 *
 * name and amount are required — both columns are NOT NULL and neither carries a
 * default. type, isOptional and isTaxable all carry schema defaults (TUITION,
 * false and false), so an omitted key lets the database apply its own rather
 * than restating the value here. taxPercent is nullable and optional.
 *
 * type is validated directly against the Prisma enum, so the accepted values
 * cannot drift from the database.
 *
 * No relationship is asserted between isTaxable and taxPercent. The schema
 * declares none — isTaxable defaults to false and taxPercent is independently
 * nullable, with no check constraint linking them — and the README states none,
 * so a taxable component with no rate, and a rate on a non-taxable component,
 * are both accepted exactly as the database accepts them. Inventing that link
 * would be a business rule.
 *
 * Deliberately absent, and therefore stripped from any body that supplies them:
 *   id             — server-managed, a cuid from the database default.
 *   feeStructureId — established by the parent structure. On create it is the
 *                    row being written; on update it is the [id] route segment.
 *                    Accepting it from the body would let a component be filed
 *                    against a different structure than the one addressed.
 *   createdAt      — schema-managed timestamp. FeeComponent has no updatedAt
 *                    column at all, so there is no second timestamp to strip.
 */
const feeComponentSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(FeeType).optional(),
  amount: decimalMatching(AMOUNT_PATTERN),
  isOptional: z.boolean().optional(),
  isTaxable: z.boolean().optional(),
  taxPercent: decimalMatching(TAX_PERCENT_PATTERN).optional(),
});

/**
 * Body schema for POST /api/fee-structures.
 *
 * Mirrors the writable scalar columns of the FeeStructure model, in column
 * order, plus its nested components.
 *
 * name is the only required field: it is the model's sole NOT NULL column
 * without a default. programmeId, batchId and academicYearId are all nullable,
 * so a structure may be scoped to any combination of them or to none at all —
 * the schema requires no scope and states no rule about which combinations are
 * meaningful, so none is enforced. That each supplied id exists AND belongs to
 * the authenticated tenant is checked against the database in the route, never
 * here.
 *
 * isActive carries the schema default true, so an omitted key lets the database
 * apply it.
 *
 * components is optional and may be empty. Nothing in the schema or the README
 * requires a structure to carry at least one component — FeeComponent[] is a
 * plain relation with no minimum — so a structure created without any is a
 * legitimate outcome rather than a malformed request.
 *
 * No cross-field rule is declared, because neither the schema nor the README
 * documents one. There is no constraint relating isActive to the scope columns,
 * no rule about component totals, and nothing linking a component's isTaxable to
 * its taxPercent. Every invariant the model does carry is a per-column type,
 * default or precision, and each is expressed above.
 *
 * Deliberately absent, and therefore stripped from any body that supplies them:
 *   id, tenantId — server-managed. The tenant is derived from the validated
 *                  request context by requireTenant, never accepted from the
 *                  client, so a structure cannot be created against another
 *                  tenant.
 *   createdAt,
 *   updatedAt    — schema-managed timestamps.
 *
 * A body supplying any of them has it stripped rather than rejected, which is
 * the project-wide behaviour of a plain z.object(): no schema in this project
 * uses .strict().
 */
export const createFeeStructureSchema = z.object({
  programmeId: z.string().trim().min(1).optional(),
  batchId: z.string().trim().min(1).optional(),
  academicYearId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  isActive: z.boolean().optional(),
  components: z.array(feeComponentSchema).optional(),
});

export type CreateFeeStructureInput = z.infer<typeof createFeeStructureSchema>;

/**
 * Body schema for PATCH /api/fee-structures/[id].
 *
 * Derived from createFeeStructureSchema rather than restated, so the enum
 * membership, Decimal precision, trimming and component rules stay defined in
 * one place and cannot drift apart.
 *
 * Nothing is omitted before .partial(). programmeId, batchId and academicYearId
 * stay mutable, matching Course.departmentId and Assignment.courseId, whose
 * detail routes re-validate a changed reference rather than freezing it; none of
 * the three is a @unique identity binding.
 *
 * tenantId is absent from the create schema, so .partial() cannot introduce it —
 * a structure can never be moved between tenants through this endpoint.
 *
 * Every key is optional, but at least one must be present: an empty body is a
 * client error, not a silent no-op that would still advance updatedAt.
 *
 * components remains accepted, since the README describes this endpoint as
 * managing the structure and its components together. What a supplied array
 * means — replace the existing set, or merge into it — is a route decision that
 * neither the schema nor the README settles, so this module asserts only the
 * shape of each element.
 *
 * Every rule that applies on create applies here unchanged. There is no
 * cross-field rule to reapply, because none is declared: the create schema
 * carries no refine beyond the per-column patterns, which .partial() preserves
 * on every key that is present.
 *
 * As elsewhere, omitting a key leaves the column unchanged; there is no way to
 * clear a nullable column back to null through this endpoint.
 */
export const updateFeeStructureSchema = createFeeStructureSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateFeeStructureInput = z.infer<typeof updateFeeStructureSchema>;

/**
 * Route param schema for /api/fee-structures/[id].
 *
 * FeeStructure.id is a cuid, but no format assertion is applied: the id is an
 * opaque key, and asserting a shape would turn an unrecognised-but-well-formed
 * id into a 400 when 404 is the accurate answer. Only an empty or
 * whitespace-only segment is rejected outright. Keyed on id because that is the
 * segment name.
 */
export const feeStructureIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type FeeStructureIdParam = z.infer<typeof feeStructureIdParamSchema>;

// No query schema is declared. GET /api/fee-structures pages on the shared
// contract, and paginationQuerySchema is consumed directly by the route exactly
// as the timetable, attendance, assignment and examination routes consume it.
// No filter parameter is defined for this phase.
