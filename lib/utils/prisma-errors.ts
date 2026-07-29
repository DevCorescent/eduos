// ============================================================================
// OWNER  : Gauransh
// MODULE : Core Infrastructure — Prisma Error Classification
// FLOW   : Inspects a PrismaClientKnownRequestError and reports whether it was
//          caused by a dependent row blocking the operation.
// ACCESS : Shared helper — no access control of its own.
// BACKEND: No database access. Classifies errors already raised by Prisma.
// PURPOSE: Prisma 7's driver adapters do not always surface a blocked write as
//          the classic P2003, so the check is non-obvious and must not be
//          reimplemented per route. Single definition for every endpoint that
//          maps a foreign-key failure onto the existing CONFLICT response.
// ============================================================================

import { Prisma } from "@/app/generated/prisma/client";

/** Prisma's classic foreign-key constraint failure code. */
const FOREIGN_KEY_VIOLATION = "P2003";

/** Prisma's "record required but not found" code, raised by update/delete. */
const RECORD_NOT_FOUND = "P2025";

/**
 * Postgres SQLSTATEs meaning a dependent row prevents the operation:
 * 23001 restrict_violation, 23503 foreign_key_violation.
 */
const FOREIGN_KEY_SQLSTATES = new Set(["23001", "23503"]);

/**
 * Recognise an operation blocked by a dependent row.
 *
 * Prisma 7's driver adapters do not always raise the classic P2003 here. A
 * delete blocked by an ON DELETE RESTRICT constraint was observed to surface as
 * P2039 wrapping the driver's own error, with the real cause carried at
 * meta.driverAdapterError.cause.code as SQLSTATE 23001. Unique violations are
 * unaffected and still arrive as P2002, so only this case needs the extra
 * unwrapping.
 *
 * Both shapes are accepted so the mapping does not depend on which one the
 * client produces.
 *
 * INPUT   : an error already narrowed to PrismaClientKnownRequestError.
 * RETURNS : true when a foreign-key or restrict constraint blocked the write.
 */
export function isForeignKeyViolation(err: Prisma.PrismaClientKnownRequestError): boolean {
  if (err.code === FOREIGN_KEY_VIOLATION) return true;

  const sqlState = (
    err.meta as { driverAdapterError?: { cause?: { code?: unknown } } } | undefined
  )?.driverAdapterError?.cause?.code;

  return typeof sqlState === "string" && FOREIGN_KEY_SQLSTATES.has(sqlState);
}

/**
 * Recognise an update or delete whose target row no longer exists.
 *
 * Unlike the foreign-key case, this arrives as the plain P2025 code and needs
 * no unwrapping — but it is exposed here alongside it so routes classify Prisma
 * failures through one module rather than each declaring its own code constant.
 *
 * INPUT   : an error already narrowed to PrismaClientKnownRequestError.
 * RETURNS : true when the record required by the operation was not found.
 */
export function isRecordNotFound(err: Prisma.PrismaClientKnownRequestError): boolean {
  return err.code === RECORD_NOT_FOUND;
}
