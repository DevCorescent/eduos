// ============================================================================
// OWNER  : Gauransh
// MODULE : Users & RBAC — User Role Assignment
// FLOW   : Guard → tenant → params → body → ownership → duplicate check →
//          write → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Grant a tenant-owned role to a tenant-owned user.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { assignRoleSchema, userIdParamSchema } from "@/lib/validations/user";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for an assignment.
 *
 * UserRole has a composite primary key, @@id([userId, roleId]), and no id
 * column of its own, so the pair is the identity of the row. The role is
 * expanded to its id and name in the same query — a single join, not a
 * follow-up read — so the response names the role that was granted rather than
 * returning an opaque id. Permissions are not traversed.
 */
const ASSIGNMENT_SELECT = {
  userId: true,
  roleId: true,
  scope: true,
  grantedAt: true,
  grantedBy: true,
  role: {
    select: { id: true, name: true },
  },
} as const;

// UserRole holds no BigInt or Decimal column, so the shared serialize() helper
// is not applied here. Its scope column is Json and is cast at the Prisma
// boundary below.

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : userIdParamSchema for the [id] segment, assignRoleSchema for the
//              body. roleId is required and scope optional.
//              userId, tenantId and grantedBy are all absent from the body
//              schema, so a request supplying any of them has it stripped
//              before Prisma is reached: the user comes from the route, the
//              tenant from the resolved context, and grantedBy from the
//              authenticated session.
// FLOW       : Authorise → resolve tenant → parse body → verify user ownership,
//              role ownership and the absence of an existing assignment as
//              three independent reads issued together → apply the results in a
//              fixed precedence → create the assignment.
//              Both ownership checks are scoped by tenantId, so a user or role
//              owned by another tenant is reported as NOT_FOUND exactly like a
//              nonexistent one; the endpoint never confirms another tenant's
//              ids. The database's foreign keys cannot achieve this alone —
//              they verify only that the referenced rows exist, not who owns
//              them, so without these checks a caller could graft one of their
//              own roles onto a user belonging to a different university.
//              No transaction is used: the write is a single insert, already
//              atomic, and the duplicate case is backed by the composite
//              primary key rather than by the pre-check alone.
// RESPONSE   : { success: true, data: <UserRole & { role }>,
//                message: "Role assigned" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsedParams = userIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParams.error),
        },
        { status: 400 }
      );
    }

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = assignRoleSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedBody.error),
        },
        { status: 400 }
      );
    }

    const userId = parsedParams.data.id;
    const { roleId, scope } = parsedBody.data;

    // Three independent reads, so they are issued together rather than in
    // sequence.
    const [user, role, existing] = await Promise.all([
      prisma.user.findFirst({
        where: { id: userId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.role.findFirst({
        where: { id: roleId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.userRole.findUnique({
        where: { userId_roleId: { userId, roleId } },
        select: { userId: true },
      }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: invalid references before the duplicate, and the user
    // before the role, so a request naming two unknown ids reports the one
    // addressed by the URL.
    if (!user) {
      return NextResponse.json(fail("User not found", "NOT_FOUND"), { status: 404 });
    }

    if (!role) {
      return NextResponse.json(fail("Role not found", "NOT_FOUND"), { status: 404 });
    }

    if (existing) {
      return NextResponse.json(
        fail("Role is already assigned to this user", "CONFLICT"),
        { status: 409 }
      );
    }

    // Single write — already atomic, so no transaction is warranted. grantedBy
    // records who performed the grant and is taken from the authenticated
    // session, never from the request body. The Json column is cast at this
    // boundary because Zod infers an unknown-valued record, which Prisma's
    // InputJsonValue does not accept directly.
    const assignment = await prisma.userRole.create({
      data: {
        userId,
        roleId,
        grantedBy: guard.session.sub,
        scope: scope as Prisma.InputJsonValue | undefined,
      },
      select: ASSIGNMENT_SELECT,
    });

    return NextResponse.json(ok(assignment, "Role assigned"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request created the same assignment between the check and
      // the insert. The composite primary key makes this race-safe: unlike the
      // role-deletion guard, the database refuses the duplicate itself.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Role is already assigned to this user", "CONFLICT"),
          { status: 409 }
        );
      }
      // The user or role was deleted between the ownership check and the
      // insert, so the foreign key rejected the reference. Which of the two it
      // was is not reliably recoverable from the error, so both are reported
      // together rather than guessed at.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced user or role not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[POST /api/users/[id]/roles]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
