// ============================================================================
// OWNER  : Gauransh
// PURPOSE: Custom application error.
//
// Phase 16 addition: an optional `details` array.
//
// Some service-layer rejections are not a single sentence. Activating an
// evaluation scheme can fail because four separate components are misconfigured,
// and collapsing that into one message would force the caller to fix and retry
// four times to discover all four. `details` reuses the ValidationDetail shape
// Zod failures already return, so a client parses one detail format regardless
// of whether the rejection came from the schema layer or the service layer.
//
// The parameter is optional and trails the existing three, so every existing
// `new AppError(message, status, code)` call site is unaffected.
// ============================================================================

import type { ValidationDetail } from "@/lib/utils/validation-error";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: readonly ValidationDetail[];

  constructor(
    message: string,
    statusCode = 400,
    code = "BAD_REQUEST",
    details?: readonly ValidationDetail[]
  ) {
    super(message);

    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}
