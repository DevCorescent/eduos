// ============================================================================
// OWNER  : Gauransh
// MODULE : Departments — head-of-department assignment
// LAYER  : Service (data access)
// PURPOSE: Turn the `hodUserId` a UNIVERSITY_ADMIN submitted into a value the
//          department write can trust, in one place, so POST and PATCH cannot
//          disagree about what a valid assignment is.
//
// WHY THIS IS NOT INLINE IN THE ROUTES
//   Two endpoints accept the field and both must apply the same three rules:
//   the user must exist IN THIS TENANT, the @unique constraint must be reported
//   as a readable conflict rather than a 500, and "" must mean "vacate". Stated
//   twice they would drift, and the one that drifted would be the one letting a
//   department point at another university's user.
//
// WHAT THIS DOES NOT DO
//   It does not touch authorization. Department scope is resolved by
//   lib/auth/departmentScope.ts from Department.hodUserId, and nothing here
//   changes how that works — this only makes the column settable through the
//   product instead of only through prisma/seed.ts.
//
//   It also does not touch `hodName`. That free-text field predates this link,
//   is still displayed, and is deliberately left alone: existing rows keep it.
// ============================================================================

import { prisma } from "@/lib/db/prisma";

export type HeadAssignment =
  | { readonly ok: true; readonly hodUserId: string | null }
  | { readonly ok: false; readonly error: string; readonly code: "NOT_FOUND" | "CONFLICT" };

/**
 * Resolve a submitted `hodUserId` for a department write.
 *
 * INPUT   : the raw value from the request body — undefined when the caller did
 *           not mention the field, "" when they chose "no head", or a user id.
 *           `departmentId` is the row being updated, or null on create.
 * RETURNS : `hodUserId: null` to vacate, a validated id to assign, or a
 *           refusal. `undefined` in, `{ ok: true, hodUserId: undefined }` is
 *           NOT produced — callers check for `undefined` before calling.
 *
 * TENANT SCOPE
 *   The user is looked up with `{ id, tenantId }`. A well-formed id belonging
 *   to another university resolves to nothing and is refused as "not found",
 *   disclosing nothing about who exists elsewhere.
 */
export async function resolveHeadAssignment(
  tenantId: string,
  rawHodUserId: string,
  departmentId: string | null
): Promise<HeadAssignment> {
  // "" is the picker's "No head assigned" option. Vacating is what makes the
  // field usable at all: Department.hodUserId is @unique, so a head cannot be
  // moved to a second department until the first releases them.
  if (rawHodUserId === "") {
    return { ok: true, hodUserId: null };
  }

  const user = await prisma.user.findFirst({
    where: { id: rawHodUserId, tenantId },
    select: { id: true },
  });

  if (user === null) {
    return { ok: false, error: "User not found", code: "NOT_FOUND" };
  }

  // The @unique constraint is the real guarantee; this read exists so the
  // caller is told WHICH department already claims them instead of receiving a
  // bare uniqueness violation. The constraint still backstops the race between
  // this check and the write, which the routes catch as P2002.
  const heldBy = await prisma.department.findUnique({
    where: { hodUserId: user.id },
    select: { id: true, name: true },
  });

  if (heldBy !== null && heldBy.id !== departmentId) {
    return {
      ok: false,
      code: "CONFLICT",
      error: `That user already heads ${heldBy.name}. A user can head only one department.`,
    };
  }

  return { ok: true, hodUserId: user.id };
}

/**
 * True when a failed write collided with the head-of-department index.
 *
 * Distinguished from the department-code index so the two conflicts do not
 * report each other's message — both are P2002 on the same table.
 */
export function isHeadUniqueViolation(meta: unknown): boolean {
  const target = (meta as { target?: unknown } | null)?.target;

  if (typeof target === "string") return target.includes("hodUserId");
  if (Array.isArray(target)) return target.some((f) => String(f).includes("hodUserId"));

  return false;
}
