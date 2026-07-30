// ============================================================================
// OWNER  : Gauransh
// MODULE : Finance — Fee Demand Validation
// FLOW   : Validates the fee-demand generation body, the waiver body and the
//          route param before any of them reaches the database.
// ACCESS : Not defined. The README's Phase 11 table names the routes but states
//          no role for them, and no approved decision assigns one, so none is
//          assumed here. Access control is performed by requireRole and the
//          routes regardless — this module never inspects a caller.
// BACKEND: No database access — Zod schema definitions only. No foreign-key
//          existence check, no uniqueness check, no total is calculated and no
//          demand is generated here; each belongs to the route.
// PURPOSE: Keep fee-demand request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";

/**
 * Accepted shape for FeeDemand.totalAmount and FeeDemand.waivedAmount, read
 * directly off their shared @db.Decimal(10, 2): at most eight integer digits and
 * two fractional digits, non-negative.
 *
 * Without this bound an oversized value reaches Postgres and surfaces as a
 * numeric-overflow 500 rather than a clean 400 — the same reason
 * Subscription.pricePerMonth, Parent.annualIncome and FeeComponent.amount carry
 * patterns of their own.
 *
 * The sign is excluded, matching pricePerMonth and FeeComponent.amount rather
 * than annualIncome. The project decides this per column: an income can
 * legitimately be reported as a loss; a charge and a waiver cannot be negative. A
 * negative waiver would be an additional charge, which the schema models as the
 * demand's own totalAmount rather than as a reduction. No other bound is imposed:
 * neither column carries a check constraint, and nothing in the schema or the
 * README caps either value or relates one to the other.
 */
const MONEY_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * A Decimal column input, bounded by the pattern its column declares.
 *
 * Accepts a number or a string and passes the value through as given. A string
 * preserves trailing zeros ("1500.00"), which Prisma accepts directly for a
 * Decimal column, so no conversion is performed that could lose precision. This
 * is the shape already used for Subscription.pricePerMonth, Parent.annualIncome
 * and the fee-structure module's component amounts.
 *
 * Module-private, following the convention set by timeOfDay in the timetable
 * module and attachmentList in the assignment and submission modules.
 */
const money = z.union([z.number(), z.string()]).refine((value) => MONEY_PATTERN.test(String(value)));

/**
 * Body schema for POST /api/fee-demands/generate.
 *
 * The README describes this endpoint as generating demands "for a batch/semester",
 * so the body is a generation instruction rather than a single FeeDemand row. The
 * route expands it into one demand per student; this module validates only the
 * instruction's shape.
 *
 * batchId is required and is the only field that is not a FeeDemand column. It
 * names the set of students the demands are generated for, and generation is not
 * possible without it — Batch is the only student grouping the README names for
 * this endpoint. It is validated here for shape only; that the batch exists AND
 * belongs to the authenticated tenant is enforced against the database in the
 * route, never here.
 *
 * semesterId and feeStructureId are optional because both columns are nullable
 * on FeeDemand. Each is recorded on every demand the run produces, so a demand
 * carries the semester it covers and the structure it was priced from.
 *
 * dueDate is required and coerced, matching the project-wide z.coerce.date()
 * convention. The column is NOT NULL with no default, so nothing else can supply
 * it. No bound is placed on the value: nothing in the schema or the README
 * forbids a past or future due date, and inventing one would be a business rule.
 *
 * totalAmount is required. FeeDemand.totalAmount is NOT NULL with no default, so
 * every generated demand must carry one, and it is supplied here rather than
 * derived because no derivation rule exists to derive it by. A fee structure's
 * components carry isOptional, isTaxable and taxPercent, and neither the schema
 * nor the README states whether an optional component counts toward a demand,
 * nor whether tax is added to the total or reported separately. Summing them
 * would mean choosing answers to both questions, which is exactly the kind of
 * business rule this module must not invent. The caller therefore states the
 * amount and feeStructureId records what it was priced from.
 *
 * Deliberately absent, and therefore stripped from any body that supplies them:
 *   id, tenantId   — server-managed. The tenant is derived from the validated
 *                    request context by requireTenant, never accepted from the
 *                    client, so demands cannot be generated against another
 *                    tenant.
 *   studentId      — established by the run. Each demand's student comes from the
 *                    batch, so a body-supplied studentId would contradict the
 *                    batch the run is for.
 *   paidAmount     — settled by payments through the Payment model, not by
 *                    generation. The column defaults to 0.
 *   waivedAmount   — settled by PATCH /api/fee-demands/[id]/waive, which the
 *                    README gives its own endpoint. The column defaults to 0.
 *   status         — FeeStatus is lifecycle state and defaults to PENDING. No
 *                    transition rule is defined anywhere, so none is inferred and
 *                    the column is never written from a request body. It is the
 *                    model's only enum, so no enum is client-writable here.
 *   createdAt,
 *   updatedAt      — schema-managed timestamps.
 *
 * A body supplying any of them has it stripped rather than rejected, which is the
 * project-wide behaviour of a plain z.object(): no schema in this project uses
 * .strict().
 */
export const generateFeeDemandSchema = z.object({
  batchId: z.string().trim().min(1),
  semesterId: z.string().trim().min(1).optional(),
  feeStructureId: z.string().trim().min(1).optional(),
  dueDate: z.coerce.date(),
  totalAmount: money,
});

export type GenerateFeeDemandInput = z.infer<typeof generateFeeDemandSchema>;

/**
 * Body schema for PATCH /api/fee-demands/[id]/waive.
 *
 * waivedAmount is the only writable field. It is required, so an empty body is a
 * validation failure without needing the at-least-one-key refine the project's
 * partial update schemas use — a waiver request that names no amount is not a
 * waiver request.
 *
 * It is bounded to the precision its Decimal(10, 2) column declares and to
 * non-negative values, as described on MONEY_PATTERN above. Zero is permitted:
 * the column defaults to 0, so setting a waiver back to nothing is expressible,
 * and nothing in the schema forbids it.
 *
 * No relationship to totalAmount or paidAmount is asserted. The schema declares
 * no check constraint tying the three together, and the README states none, so a
 * waiver larger than the demand is accepted here exactly as the database accepts
 * it. Whether that should be refused is a rule the route would have to read the
 * stored demand to apply, and no source defines it.
 *
 * Deliberately absent, and therefore stripped: id, tenantId, studentId,
 * semesterId, feeStructureId, dueDate, totalAmount, paidAmount, status, createdAt
 * and updatedAt. A waiver changes what was waived and nothing else — it cannot
 * re-point the demand at a different student, restate its total, record a
 * payment, or move it to WAIVED. FeeStatus is lifecycle state with no transition
 * rule defined anywhere, so it is not written from this body.
 *
 * FeeDemand carries no column for a waiver reason, approver or timestamp, so
 * none is accepted. Adding one would mean inventing a field the model does not
 * have.
 */
export const waiveFeeDemandSchema = z.object({
  waivedAmount: money,
});

export type WaiveFeeDemandInput = z.infer<typeof waiveFeeDemandSchema>;

/**
 * Route param schema for /api/fee-demands/[id]/waive.
 *
 * FeeDemand.id is a cuid, but no format assertion is applied: the id is an opaque
 * key, and asserting a shape would turn an unrecognised-but-well-formed id into a
 * 400 when 404 is the accurate answer. Only an empty or whitespace-only segment
 * is rejected outright. Keyed on id because that is the segment name.
 */
export const feeDemandIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type FeeDemandIdParam = z.infer<typeof feeDemandIdParamSchema>;

// No query schema is declared. The README names filters for GET /api/fee-demands
// — "filter by student/semester" — but this module is specified to export exactly
// the three schemas above, so that contract belongs with the route that
// implements it. Pagination, where it applies, is consumed directly from
// paginationQuerySchema as in every other collection route.
