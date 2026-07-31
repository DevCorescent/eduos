// ============================================================================
// OWNER  : Gauransh
// MODULE : Core Infrastructure — Validation Error Detail
// FLOW   : Turns a ZodError into a compact, client-safe list of field problems.
// ACCESS : None — a pure function. Inspects no caller and reads no request.
// BACKEND: None. No database access and no Prisma model.
// PURPOSE: Let a 400 tell the caller WHICH field is wrong. The project's
//          existing responses carry only "Invalid input", which is why a login
//          missing `tenantSlug` was indistinguishable from a broken endpoint.
// ============================================================================

import type { ZodError } from "zod";

/** One field-level problem, in the order Zod reported it. */
export type ValidationDetail = {
  /** Dotted path to the offending field, e.g. "tenantSlug" or "components.0.amount". */
  field: string;
  /** Zod's own message, e.g. "Required" or "Invalid email". */
  message: string;
};

/**
 * Flatten a ZodError into field/message pairs.
 *
 * Only the path and the message are exposed. Zod's `code`, `expected`,
 * `received` and any nested union detail are deliberately dropped: they describe
 * the schema's internals rather than the caller's mistake, and forwarding them
 * would leak the shape of validation logic that is not part of the public
 * contract.
 *
 * A top-level failure — a body that is a string, an array or null — has an empty
 * path, which is reported as the field "body" so the entry is never anonymous.
 */
export function validationDetails(error: ZodError): ValidationDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "body",
    message: issue.message,
  }));
}
