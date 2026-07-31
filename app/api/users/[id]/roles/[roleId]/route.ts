// ============================================================================
// OWNER  : Gauransh
// MODULE : Users & RBAC — User Role Removal
// FLOW   : Guard → tenant → params → ownership → assignment lookup → delete →
//          response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Revoke a single role assignment from a tenant-owned user, leaving
//          both the user and the role intact.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation, isRecordNotFound } from "@/lib/utils/prisma-errors";
import { roleIdParamSchema } from "@/lib/validations/role";
import { userIdParamSchema } from "@/lib/validations/user";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// UserRole holds no BigInt, Decimal or Json column that is returned here — the
// response carries no record at all — so the shared serialize() helper does not
// apply.

// DELETE
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : userIdParamSchema for the [id] segment and roleIdParamSchema for
//              the [roleId] segment. The two rules are identical, so the role
//              schema is applied to the roleId value rather than a third
//              near-duplicate schema being declared for this route.
//              No request body is read: every input to this endpoint comes from
//              the URL, so there is nothing a client could inject.
// FLOW       : Authorise → resolve tenant → verify user ownership, role
//              ownership and the existence of the assignment as three
//              independent reads issued together → apply the results in a fixed
//              precedence → delete the join row alone.
//              Both ownership checks are scoped by tenantId, so a user or role
//              owned by another tenant is reported as NOT_FOUND exactly like a
//              nonexistent one; the endpoint never confirms another tenant's
//              ids. The foreign keys cannot provide this on their own — they
//              verify only that the referenced rows exist, not who owns them,
//              so without these checks a caller could revoke a role from a user
//              belonging to a different university.
//              The delete targets UserRole by its composite primary key,
//              @@id([userId, roleId]), so exactly one assignment is removed.
//              The User row, the Role row, that role's RolePermission grants
//              and every other assignment held by the user are untouched:
//              nothing cascades outward from a join row.
//              No transaction is used — the write is a single delete, already
//              atomic.
// RESPONSE   : { success: true, data: null, message: "Role unassigned" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; roleId: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const rawParams = await params;

    const parsedUserParam = userIdParamSchema.safeParse({ id: rawParams.id });
    const parsedRoleParam = roleIdParamSchema.safeParse({ id: rawParams.roleId });

    if (!parsedUserParam.success || !parsedRoleParam.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: [
            ...(parsedUserParam.success ? [] : validationDetails(parsedUserParam.error)),
            ...(parsedRoleParam.success ? [] : validationDetails(parsedRoleParam.error)),
          ],
        },
        { status: 400 }
      );
    }

    const userId = parsedUserParam.data.id;
    const roleId = parsedRoleParam.data.id;

    // Three independent reads, so they are issued together rather than in
    // sequence.
    const [user, role, assignment] = await Promise.all([
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
    // resolved first: invalid references before the missing assignment, and the
    // user before the role, so a request naming two unknown ids reports the one
    // addressed first by the URL.
    if (!user) {
      return NextResponse.json(fail("User not found", "NOT_FOUND"), { status: 404 });
    }

    if (!role) {
      return NextResponse.json(fail("Role not found", "NOT_FOUND"), { status: 404 });
    }

    if (!assignment) {
      return NextResponse.json(
        fail("Role is not assigned to this user", "NOT_FOUND"),
        { status: 404 }
      );
    }

    // Deletes the join row only, addressed by its composite primary key.
    await prisma.userRole.delete({
      where: { userId_roleId: { userId, roleId } },
    });

    return NextResponse.json(ok(null, "Role unassigned"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // The assignment was removed by a concurrent request between the lookup
      // and the delete.
      if (isRecordNotFound(err)) {
        return NextResponse.json(
          fail("Role is not assigned to this user", "NOT_FOUND"),
          { status: 404 }
        );
      }
      // Nothing in the schema references UserRole, so no dependent row can
      // block this delete and the branch is not currently reachable. It is
      // retained so a blocked delete could never be misreported as a 500 if a
      // future reference behaved differently.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Assignment has dependent records and cannot be deleted", "CONFLICT"),
          { status: 409 }
        );
      }
    }

    console.error("[DELETE /api/users/[id]/roles/[roleId]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
