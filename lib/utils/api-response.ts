// ============================================================================
// OWNER  : Gauransh
// MODULE : Core Infrastructure — Route Response Helpers
// LAYER  : Utility (route-layer plumbing)
// PURPOSE: Turn a Zod failure or a thrown error into the project's existing
//          response envelope, once, instead of in every route handler.
//
//          Phase 15 established the shape of both blocks but restated them in
//          each route file. With four route files in this module alone, that
//          would be eight copies of the same twelve lines — and eight places
//          for the status mapping to drift apart. Neither helper makes a
//          business decision: they translate an already-decided outcome into
//          HTTP, which is exactly the route layer's remit.
// ============================================================================

import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import { AppError } from "@/lib/errors/AppError";
import { isForeignKeyViolation, isRecordNotFound } from "@/lib/utils/prisma-errors";
import { validationDetails } from "@/lib/utils/validation-error";
import {
  ERROR_CODE,
  HTTP_STATUS,
  INVALID_INPUT_MESSAGE,
  SERVER_ERROR_MESSAGE,
} from "@/lib/constants/errors";
import { fail, type ApiResponse } from "@/types";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Prisma's write-conflict / deadlock code.
 *
 * Raised when a SERIALIZABLE transaction is rolled back because committing it
 * would have produced a result no serial ordering could. The evaluation-scheme
 * activation path relies on exactly that to hold the single-ACTIVE-revision
 * invariant, so this is an expected outcome under contention rather than a
 * fault — the caller may simply retry.
 */
const TRANSACTION_CONFLICT = "P2034";

/** The 400 answered for every schema rejection, with per-field details. */
export function validationFailure(error: ZodError): NextResponse<ApiResponse<never>> {
  return NextResponse.json(
    {
      success: false as const,
      error: INVALID_INPUT_MESSAGE,
      code: ERROR_CODE.VALIDATION,
      details: validationDetails(error),
    },
    { status: HTTP_STATUS.BAD_REQUEST }
  );
}

/** The 400 answered for a body that is not parseable JSON at all. */
export function malformedBody(): NextResponse<ApiResponse<never>> {
  return NextResponse.json(fail(INVALID_INPUT_MESSAGE, ERROR_CODE.VALIDATION), {
    status: HTTP_STATUS.BAD_REQUEST,
  });
}

/**
 * Map a thrown error onto the response envelope.
 *
 * PRECEDENCE : AppError first — the service layer raises it deliberately and
 *              carries its own status and code, so it is never reinterpreted.
 *              Prisma's known errors follow, covering the races a
 *              tenant-scoped check cannot close: a row taken between the read
 *              and the write, a reference deleted mid-transaction, or a
 *              serialization conflict. Anything else is a genuine fault and is
 *              logged with its route scope before becoming an opaque 500, so
 *              no internal detail reaches the client.
 *
 * @param scope route identifier used in the server log, e.g. "POST /api/x"
 */
export function handleRouteError(scope: string, err: unknown): NextResponse<ApiResponse<never>> {
  if (err instanceof AppError) {
    // A rejection carrying per-field detail reports all of it at once, in the
    // same shape a Zod failure uses, so the caller never has to fix one
    // violation at a time to discover the next.
    if (err.details !== undefined && err.details.length > 0) {
      return NextResponse.json(
        {
          success: false as const,
          error: err.message,
          code: err.code,
          details: err.details,
        },
        { status: err.statusCode }
      );
    }

    return NextResponse.json(fail(err.message, err.code), { status: err.statusCode });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === UNIQUE_VIOLATION) {
      return NextResponse.json(fail("Resource already exists", ERROR_CODE.CONFLICT), {
        status: HTTP_STATUS.CONFLICT,
      });
    }

    if (err.code === TRANSACTION_CONFLICT) {
      return NextResponse.json(
        fail("Concurrent modification, please retry", ERROR_CODE.CONFLICT),
        { status: HTTP_STATUS.CONFLICT }
      );
    }

    if (isRecordNotFound(err)) {
      return NextResponse.json(fail("Resource not found", ERROR_CODE.NOT_FOUND), {
        status: HTTP_STATUS.NOT_FOUND,
      });
    }

    if (isForeignKeyViolation(err)) {
      return NextResponse.json(
        fail("Resource has dependent records or an unresolved reference", ERROR_CODE.CONFLICT),
        { status: HTTP_STATUS.CONFLICT }
      );
    }
  }

  console.error(`[${scope}]`, err);

  return NextResponse.json(fail(SERVER_ERROR_MESSAGE, ERROR_CODE.SERVER), {
    status: HTTP_STATUS.SERVER_ERROR,
  });
}
