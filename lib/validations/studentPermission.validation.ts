// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Permission System (Phase 21)
// LAYER  : Validation
// PURPOSE: The query contract for GET /api/student/permissions.
//
// AN EMPTY SCHEMA IS STILL A SCHEMA
//   The endpoint takes no input: the matrix is the same for every student, and
//   the caller is resolved from session.sub. The schema is nonetheless parsed
//   so that any key a client appends is STRIPPED rather than carried forward —
//   the same reasoning, and the same shape, as Phase 18's profileQuerySchema.
//
//   That strip is what makes `?studentId=<someone else>` inexpressible: it does
//   not reach the controller, which has no parameter to receive it, which calls
//   a service method that takes a userId it did not get from the request.
// ============================================================================

import { z } from "zod";

/** No filters, no selection, no identity. Parsed to strip, not to accept. */
export const studentPermissionQuerySchema = z.object({});

export type StudentPermissionQuery = z.infer<typeof studentPermissionQuerySchema>;

/**
 * The identity keys no client may supply to this module.
 *
 * Exported so the guarantee is stated once and asserted against that same
 * statement, matching FORBIDDEN_IDENTITY_KEYS in the Phase 18 module.
 */
export const FORBIDDEN_PERMISSION_QUERY_KEYS = ["studentId", "userId", "tenantId"] as const;
