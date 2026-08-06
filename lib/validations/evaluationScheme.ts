// ============================================================================
// OWNER  : Gauransh
// MODULE : Evaluation Scheme
// LAYER  : Validation
// PURPOSE: Shape and bounds for every evaluation-scheme request, applied before
//          the controller is reached and before any database work is done.
//
//          This layer validates SHAPE only. Whether a referenced grade scale
//          exists, whether it belongs to the caller's tenant, whether a status
//          transition is legal and which version number comes next are all
//          questions about stored state, and every one of them is answered in
//          the service. A schema that cannot read the database must never
//          pretend to enforce a rule that depends on it.
// ============================================================================

import { z } from "zod";
import { AttemptPolicy, EvaluationSchemeStatus, RoundingMode } from "@/app/generated/prisma/client";
import {
  EVALUATION_SCHEME_CODE_MAX_LENGTH,
  EVALUATION_SCHEME_CODE_MIN_LENGTH,
  EVALUATION_SCHEME_CODE_PATTERN,
  EVALUATION_SCHEME_DESCRIPTION_MAX_LENGTH,
  EVALUATION_SCHEME_NAME_MAX_LENGTH,
  EVALUATION_SCHEME_NAME_MIN_LENGTH,
  PRECISION_MAX,
  PRECISION_MIN,
} from "@/lib/constants/evaluationScheme";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { identifier } from "@/lib/validations/shared";

/**
 * The regulation code.
 *
 * Uppercased before the pattern is applied, so a caller sending "btech-r2023"
 * is normalised rather than rejected — the code is a stable business key that
 * must not fork on case. Length is bounded at both ends; the pattern then
 * rejects anything that is not alphanumeric, dash or underscore, and requires
 * the first character to be alphanumeric so a code can never lead with a
 * separator.
 */
const schemeCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(EVALUATION_SCHEME_CODE_MIN_LENGTH)
  .max(EVALUATION_SCHEME_CODE_MAX_LENGTH)
  .regex(EVALUATION_SCHEME_CODE_PATTERN);

const schemeName = z
  .string()
  .trim()
  .min(EVALUATION_SCHEME_NAME_MIN_LENGTH)
  .max(EVALUATION_SCHEME_NAME_MAX_LENGTH);

const schemeDescription = z.string().trim().max(EVALUATION_SCHEME_DESCRIPTION_MAX_LENGTH);

/**
 * A rounding precision, in decimal places.
 *
 * Bounded rather than left to the Int column, so a precision the arithmetic
 * cannot honour is refused at the boundary instead of being stored and
 * discovered by the calculation engine.
 */
const precision = z.number().int().min(PRECISION_MIN).max(PRECISION_MAX);

/**
 * The writable columns of EvaluationScheme.
 *
 * Declared as a bare object so both exported body schemas derive from it and
 * the field rules stay defined once — the same construction used by
 * lib/validations/examination.ts.
 *
 * The four policy fields are optional on create because the column carries a
 * schema default. Omitting one stores that default rather than failing, which
 * is what a default is for; supplying one pins it explicitly.
 *
 * Deliberately absent, and therefore stripped from any body that supplies them:
 *   id, tenantId   — server-managed. The tenant comes from requireTenant, never
 *                    from a body, so a scheme cannot be filed against another
 *                    university.
 *   version        — derived by the service from the existing revisions of the
 *                    same code. A client able to choose it could fork or
 *                    overwrite a regulation's history.
 *   status         — server-managed lifecycle state, advanced only through the
 *                    activate and archive endpoints, never by a field write.
 *   supersededById — written solely by the activation transaction, which is the
 *                    only operation that knows which revision replaced which.
 *   activatedAt,
 *   activatedById,
 *   archivedAt     — lifecycle timestamps and attribution, set by the service.
 *   createdById    — taken from the verified session, never from the body.
 *   createdAt,
 *   updatedAt      — schema-managed timestamps.
 *
 * A body supplying any of them has it stripped rather than rejected, which is
 * the project-wide behaviour of a plain z.object(): no schema in this project
 * uses .strict().
 */
const evaluationSchemeFields = z.object({
  code: schemeCode,
  name: schemeName,
  description: schemeDescription.optional(),
  gradeScaleId: identifier,
  attemptPolicy: z.enum(AttemptPolicy).optional(),
  marksRounding: z.enum(RoundingMode).optional(),
  marksPrecision: precision.optional(),
  gpaRounding: z.enum(RoundingMode).optional(),
  gpaPrecision: precision.optional(),
});

/**
 * Body schema for POST /api/evaluation-schemes.
 *
 * The same endpoint creates a regulation's first revision and drafts a further
 * revision of an existing one — the difference is decided entirely by whether
 * the code already exists, which only the service can see. There is therefore
 * no "create version" flag for a client to get wrong.
 */
export const createEvaluationSchemeSchema = evaluationSchemeFields;

export type CreateEvaluationSchemeInput = z.infer<typeof createEvaluationSchemeSchema>;

/**
 * Body schema for PATCH /api/evaluation-schemes/[id].
 *
 * `code` is omitted before .partial() and so can never be patched. The code is
 * the identity a revision shares with its siblings; changing it would move this
 * revision into a different regulation family while keeping a version number
 * computed against the old one, silently corrupting both histories. A
 * differently-coded regulation is a new scheme, not an edit.
 *
 * Every remaining key is optional, but at least one must be present: an empty
 * body is a client error, not a silent no-op that would still advance
 * updatedAt.
 *
 * As elsewhere in this project, omitting a key leaves the column unchanged;
 * there is no way to clear a nullable column back to null through this
 * endpoint.
 */
export const updateEvaluationSchemeSchema = evaluationSchemeFields
  .omit({ code: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateEvaluationSchemeInput = z.infer<typeof updateEvaluationSchemeSchema>;

/**
 * Query schema for GET /api/evaluation-schemes.
 *
 * Extends the shared pagination contract rather than restating it. All three
 * filters are optional and are ANDed by the service.
 *
 * Every filter here is index-backed, which is why these three and no others:
 * `status` rides @@index([tenantId, status]), `code` rides the leading columns
 * of @@unique([tenantId, code, version]), and `gradeScaleId` rides
 * @@index([tenantId, gradeScaleId]). A free-text search parameter is
 * deliberately not offered — it would be a sequential scan wearing the costume
 * of a filter.
 */
export const listEvaluationSchemesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(EvaluationSchemeStatus).optional(),
  code: schemeCode.optional(),
  gradeScaleId: identifier.optional(),
});

export type ListEvaluationSchemesQuery = z.infer<typeof listEvaluationSchemesQuerySchema>;

/**
 * Route param schema for /api/evaluation-schemes/[id] and its sub-routes.
 *
 * Keyed on `id` because that is the segment name.
 */
export const evaluationSchemeIdParamSchema = z.object({
  id: identifier,
});

export type EvaluationSchemeIdParam = z.infer<typeof evaluationSchemeIdParamSchema>;
