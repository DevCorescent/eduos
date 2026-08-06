// ============================================================================
// OWNER  : Gauransh
// MODULE : Core Infrastructure — Prisma JSON Input
// LAYER  : Utility (repository-layer plumbing)
// PURPOSE: Translate a plain value into what Prisma requires for a NULLABLE
//          Json column.
//
//          Prisma refuses a bare `null` on such a column: it cannot tell
//          whether the caller means SQL NULL or the JSON value `null`, and
//          demands DbNull or JsonNull to say which. Getting that wrong is
//          silent — a stored JSON `null` is a VALUE, so every reader
//          afterwards has to handle a third case that should never have
//          existed.
//
//          Defined once, here, so that distinction is made in one reviewed
//          place rather than re-derived by each repository that owns a
//          nullable Json column. Extracted from
//          evaluationComponent.repository.ts, which declared it first.
// ============================================================================

import { Prisma } from "@/app/generated/prisma/client";

/**
 * Prepare a value for a nullable Json column.
 *
 * `undefined` passes through untouched, which is how Prisma spells "leave this
 * column exactly as it is" on an update — distinct from clearing it.
 *
 * `null` becomes DbNull, i.e. SQL NULL, because "this record has no
 * configuration" is the absence of a value rather than a value meaning nothing.
 *
 * Anything else is passed as-is. The cast is confined to this function: callers
 * hand over their own DTOs, and a TypeScript interface has no implicit index
 * signature, so it is never assignable to Prisma.InputJsonValue however
 * JSON-shaped its contents actually are.
 */
export function toJsonInput(
  value: unknown
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return Prisma.DbNull;
  }

  return value as Prisma.InputJsonValue;
}
