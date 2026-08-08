// ============================================================================
// MODULE : Errors — the application's error taxonomy
// PURPOSE: Give every failure a TYPE, so callers stop matching on strings.
//
// WHY SUBCLASSES RATHER THAN A NEW TAXONOMY
//   AppError already exists and every service throws it, carrying a
//   statusCode, a machine-readable code and optional validation details. A
//   second, parallel hierarchy would mean two vocabularies for one concept and
//   a translation layer between them — so these are subclasses of AppError, not
//   replacements. Every existing `throw new AppError(...)` keeps working, every
//   existing `catch (e) { if (e instanceof AppError) }` keeps matching, and the
//   status/code pairing simply stops being retyped at each throw site.
//
//   The codes come from ERROR_CODE and the statuses from HTTP_STATUS, both of
//   which are already pinned to ApiErrorCode at compile time. Nothing here
//   invents a literal.
//
// WHAT THIS BUYS THE UI
//   resolveUiState can accept a thrown error as readily as a response envelope,
//   so a screen's failure branch stops depending on the shape the backend
//   happens to serialise. When the transport changes, this file changes and the
//   sixty screens do not.
// ============================================================================

import { AppError } from "./AppError";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import type { ValidationDetail } from "@/lib/utils/validation-error";

export { AppError };

/** 400 — the request was understood and its contents are wrong. */
export class ValidationError extends AppError {
  constructor(message = "Invalid input", details?: readonly ValidationDetail[]) {
    super(message, HTTP_STATUS.BAD_REQUEST, ERROR_CODE.VALIDATION, details);
    this.name = "ValidationError";
  }
}

/** 401 — nobody is signed in, or the session has ended. */
export class AuthError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, HTTP_STATUS.UNAUTHORIZED, ERROR_CODE.UNAUTHORIZED);
    this.name = "AuthError";
  }
}

/**
 * 403 — the caller is known and not permitted.
 *
 * Distinct from AuthError in the one way that matters to a screen: signing in
 * again cannot fix it. That is why the UI renders this as unavailable rather
 * than as a failure.
 */
export class PermissionError extends AppError {
  constructor(message = "Forbidden") {
    super(message, HTTP_STATUS.FORBIDDEN, ERROR_CODE.FORBIDDEN);
    this.name = "PermissionError";
  }
}

/** 404 — the resource does not exist, or is not visible to this caller. */
export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, HTTP_STATUS.NOT_FOUND, ERROR_CODE.NOT_FOUND);
    this.name = "NotFoundError";
  }
}

/** 409 — the request conflicts with the current state, e.g. a duplicate slug. */
export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(message, HTTP_STATUS.CONFLICT, ERROR_CODE.CONFLICT);
    this.name = "ConflictError";
  }
}

/**
 * 429 — too many requests.
 *
 * `retryAfterSeconds` is carried because the only useful thing a screen can say
 * here is how long to wait, and it is the one piece of information a retry
 * button cannot substitute for.
 */
export class RateLimitError extends AppError {
  readonly retryAfterSeconds?: number;

  constructor(message = "Too many requests", retryAfterSeconds?: number) {
    super(message, HTTP_STATUS.TOO_MANY_REQUESTS, ERROR_CODE.RATE_LIMITED);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** 500 — an unhandled fault. Retrying is reasonable. */
export class ServerError extends AppError {
  constructor(message = "Internal server error") {
    super(message, HTTP_STATUS.SERVER_ERROR, ERROR_CODE.SERVER);
    this.name = "ServerError";
  }
}

/**
 * Narrow an unknown thrown value to an AppError.
 *
 * `catch` gives `unknown`, and every call site would otherwise repeat the same
 * instanceof. Exported so the check is written once and cannot drift.
 */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
