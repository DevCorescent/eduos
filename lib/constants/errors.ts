// ============================================================================
// OWNER  : Gauransh
// MODULE : Core Infrastructure — API Error Codes
// LAYER  : Constants
// PURPOSE: The single set of machine-readable error codes the backend emits in
//          fail(error, code). types/api.ts declares ApiErrorCode as a union of
//          string literals but exports no values, so before this module every
//          route restated the literals inline — the exact "magic string"
//          duplication Phase 16 forbids.
//
//          `satisfies` is deliberate: it pins every value to a member of the
//          existing ApiErrorCode union at compile time, so a typo here is a
//          build error rather than a code the frontend cannot classify, while
//          still letting each property keep its literal type.
// ============================================================================

import type { ApiErrorCode } from "@/types/api";

export const ERROR_CODE = {
  VALIDATION: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  // No route rate-limits today. The code exists so the taxonomy is complete
  // and the UI already classifies a 429 correctly when one does.
  RATE_LIMITED: "RATE_LIMITED",
  SERVER: "SERVER_ERROR",
} as const satisfies Record<string, ApiErrorCode>;

/** HTTP statuses paired with the codes above, so neither is written inline. */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  SERVER_ERROR: 500,
} as const;

/** The generic message returned with every VALIDATION_ERROR, as elsewhere. */
export const INVALID_INPUT_MESSAGE = "Invalid input";

/** The generic message returned with every unhandled 500, as elsewhere. */
export const SERVER_ERROR_MESSAGE = "Internal server error";
