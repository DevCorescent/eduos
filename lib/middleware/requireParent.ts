// ============================================================================
// OWNER  : Gauransh
// MODULE : Parent Portal Authorization (W2 — PRD §32)
// FLOW   : requireRole("PARENT") → requireTenant() → Parent by userId →
//          (for child routes) StudentParent ownership.
// ACCESS : PARENT only.
//
// THE FOUR THINGS EVERY PARENT REQUEST MUST PROVE
//   1. authenticated                  — delegated to requireAuth via requireRole
//   2. holds the PARENT role          — requireRole, re-read from the database
//   3. belongs to the resolved tenant — requireTenant, host vs token
//   4. IS the parent it claims to be  — Parent.userId === session.sub
//
//   And for anything about a child, a fifth: the child is THEIRS, proven by a
//   StudentParent row. That check is the whole point of this module.
//
// Parent.userId IS THE ONLY SOURCE OF TRUTH
//   Parent.email is optional AND non-unique, so it can never identify a
//   signed-in parent. Nothing here reads it. A parent with no linked account
//   simply does not resolve, which is correct: a contact record is not a login.
//
// A STUDENT ID FROM THE CLIENT IS NEVER TRUSTED
//   requireParentChild takes the id the caller supplied and answers only after
//   proving, in one query, that a StudentParent row joins it to THIS parent AND
//   that the student sits in THIS tenant. There is no path that reads a student
//   by id alone.
//
// AN UNRELATED CHILD ANSWERS 404, NOT 403
//   The existing convention across this codebase — see the tenant-scoped
//   lookups in /api/users/[id]/roles — is that a record the caller may not see
//   is reported as absent. 403 would confirm that the id names a real student
//   at this university, which is precisely what a probing parent wants to learn.
// ============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import type { JwtPayload } from "@/lib/auth/jwt";
import type { Tenant } from "@/app/generated/prisma/client";
import { fail, type ApiResponse } from "@/types";

/** The parent behind the request. Deliberately narrow — no contact fields. */
export interface ResolvedParent {
  readonly id: string;
  readonly tenantId: string;
}

export type ParentGuardResult =
  | { authorized: true; session: JwtPayload; tenant: Tenant; parent: ResolvedParent }
  | { authorized: false; response: NextResponse<ApiResponse<never>> };

export type ParentChildGuardResult =
  | {
      authorized: true;
      session: JwtPayload;
      tenant: Tenant;
      parent: ResolvedParent;
      /** Proven to belong to this parent, in this tenant. */
      studentId: string;
    }
  | { authorized: false; response: NextResponse<ApiResponse<never>> };

/** A record this caller may not see is reported as absent. See the header. */
function notFound(): NextResponse<ApiResponse<never>> {
  return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
}

/**
 * Require an authenticated PARENT with a linked Parent record in this tenant.
 *
 * @example
 * const guard = await requireParent()
 * if (!guard.authorized) return guard.response
 */
export async function requireParent(): Promise<ParentGuardResult> {
  // Role first: an anonymous caller gets requireAuth's 401 from inside here,
  // and a signed-in non-parent gets 403, before any tenant work is done.
  const roleGuard = await requireRole("PARENT");
  if (!roleGuard.authorized) return { authorized: false, response: roleGuard.response };

  // Then the tenant, which compares the host's tenant against the token's own.
  const tenantGuard = await requireTenant();
  if (!tenantGuard.resolved) return { authorized: false, response: tenantGuard.response };

  const { tenant, session } = tenantGuard;

  // Scoped by BOTH the account and the tenant. A Parent row belonging to
  // another university cannot resolve even if the ids somehow lined up.
  const parent = await prisma.parent.findFirst({
    where: { userId: session.sub, tenantId: tenant.id },
    select: { id: true, tenantId: true },
  });

  // Holds the role but is not linked to a Parent record — for instance a user
  // granted PARENT by hand. There is nothing for them to see, and saying so
  // plainly beats an empty dashboard that looks broken.
  if (!parent) {
    return {
      authorized: false,
      response: NextResponse.json(
        fail("This account is not linked to a parent record", "FORBIDDEN"),
        { status: 403 }
      ),
    };
  }

  return { authorized: true, session, tenant, parent };
}

/**
 * Require a parent AND prove the named student is their child.
 *
 * ONE query decides it: a StudentParent row joining this parent to this
 * student, where the student also sits in this tenant. Both halves matter —
 * the join alone would still admit a student whose tenant had changed, and the
 * tenant alone would admit every child at the university.
 */
export async function requireParentChild(
  studentId: string
): Promise<ParentChildGuardResult> {
  const guard = await requireParent();
  if (!guard.authorized) return guard;

  const { parent, tenant } = guard;

  const link = await prisma.studentParent.findFirst({
    where: {
      parentId: parent.id,
      studentId,
      student: { tenantId: tenant.id },
    },
    select: { studentId: true },
  });

  if (!link) return { authorized: false, response: notFound() };

  return { ...guard, studentId: link.studentId };
}
