// ============================================================================
// OWNER  : Gauransh
// MODULE : Core Infrastructure — Shared Validation Primitives
// LAYER  : Validation
// PURPOSE: The two Zod primitives every Phase 16 module needs, defined once.
//
//          `identifier` was declared independently in evaluationScheme.ts and
//          evaluationComponent.ts, and C4 and C5 would have made four copies.
//          `boundedDecimal` carries subtle floating-point reasoning that must
//          not be re-derived per module — a second copy is a second chance to
//          get the tolerance wrong.
// ============================================================================

import { z } from "zod";
import { DECIMAL_FACTOR, DECIMAL_SCALE, SCALE_TOLERANCE } from "@/lib/constants/decimal";

/**
 * An opaque identifier segment — a route param or a foreign key in a body.
 *
 * Ids in this project are cuids, but no format is asserted: asserting one turns
 * an unrecognised-but-well-formed id into a 400 when 404 is the accurate
 * answer. Only an empty or whitespace-only value is rejected.
 */
export const identifier = z.string().trim().min(1);

/**
 * A number destined for a Decimal(_, 2) column.
 *
 * The scale check is not decoration. PostgreSQL SILENTLY ROUNDS a value with
 * more decimal places than the column's scale, so 33.335 would be stored as
 * 33.34 with no error and no notice — and the figure the administrator entered
 * would not be the figure the engine uses. Rejecting it here is the only place
 * that difference is ever visible.
 *
 * @param minimum inclusive lower bound
 * @param maximum inclusive upper bound, normally the column's own ceiling
 */
export function boundedDecimal(minimum: number, maximum: number) {
  return z
    .number()
    .min(minimum)
    .max(maximum)
    .refine(
      (value) => {
        const scaled = value * DECIMAL_FACTOR;
        return Math.abs(scaled - Math.round(scaled)) < SCALE_TOLERANCE;
      },
      { message: `At most ${DECIMAL_SCALE} decimal places are stored` }
    );
}
