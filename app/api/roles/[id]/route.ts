// ============================================================================
// OWNER  : Gauransh
// MODULE : Users & RBAC — Role Detail
// FLOW   : Guard → tenant → params → body → ownership → duplicate/assignment
//          checks → write → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: View, update and delete a single role within the authenticated
//          tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation, isRecordNotFound } from "@/lib/utils/prisma-errors";
import { roleIdParamSchema, updateRoleSchema } from "@/lib/validations/role";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a role. Declared once so every handler in this file
 * answers with the same shape.
 */
const ROLE_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  description: true,
  isSystem: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Role holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : roleIdParamSchema — the [id] segment must be non-empty once
//              trimmed.
// FLOW       : Authorise → resolve tenant → read the role filtered by BOTH id
//              and tenantId, so a role owned by another tenant is simply not
//              found rather than being disclosed. No relation is expanded.
// RESPONSE   : { success: true, data: <Role> }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsed = roleIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsed.error),
        },
        { status: 400 }
      );
    }

    // findFirst rather than findUnique: the tenant filter is part of the lookup,
    // so another tenant's row can never be returned or even acknowledged.
    const role = await prisma.role.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
      select: ROLE_SELECT,
    });

    if (!role) {
      return NextResponse.json(fail("Role not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(role));
  } catch (err) {
    console.error("[GET /api/roles/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : roleIdParamSchema for the [id] segment, updateRoleSchema for the
//              body. Every field optional but at least one required.
//              Neither tenantId nor isSystem can appear in the body, so a role
//              cannot be moved between tenants or promoted to a system role.
// FLOW       : Authorise → resolve tenant → validate → confirm the role belongs
//              to this tenant (404 otherwise) → re-check name uniqueness ONLY
//              when the name is both supplied and changing → apply one atomic
//              update scoped by id and tenantId.
// RESPONSE   : { success: true, data: <Role>, message: "Role updated" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsedParams = roleIdParamSchema.safeParse(await params);
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

    const parsedBody = updateRoleSchema.safeParse(body);
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

    const roleId = parsedParams.data.id;

    // One lookup serves two purposes: existence with tenant ownership, and the
    // current name used to decide whether the uniqueness check is needed at all.
    const existing = await prisma.role.findFirst({
      where: { id: roleId, tenantId: tenant.id },
      select: { id: true, name: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Role not found", "NOT_FOUND"), { status: 404 });
    }

    const input = parsedBody.data;

    // Uniqueness is only re-checked for a name that is actually changing —
    // resubmitting the role's own current name is not a conflict with itself.
    // The constraint is @@unique([tenantId, name]), so the same name may
    // legitimately exist under a different tenant.
    if (input.name !== undefined && input.name !== existing.name) {
      const clash = await prisma.role.findUnique({
        where: { tenantId_name: { tenantId: tenant.id, name: input.name } },
        select: { id: true },
      });

      if (clash) {
        return NextResponse.json(fail("Role name already in use", "CONFLICT"), { status: 409 });
      }
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed. Single statement, so the update
    // is atomic on its own.
    const role = await prisma.role.update({
      where: { id: roleId, tenantId: tenant.id },
      data: input,
      select: ROLE_SELECT,
    });

    return NextResponse.json(ok(role, "Role updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the name between the check and the update.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(fail("Role name already in use", "CONFLICT"), { status: 409 });
      }
      // The role was deleted between the lookup and the update.
      if (isRecordNotFound(err)) {
        return NextResponse.json(fail("Role not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[PATCH /api/roles/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// DELETE
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : roleIdParamSchema — the [id] segment must be non-empty once
//              trimmed.
// FLOW       : Authorise → resolve tenant → confirm the role belongs to this
//              tenant AND count its user assignments, as two independent reads
//              issued together → apply in fixed precedence, existence before
//              assignment → delete only when unassigned.
//
//              The assignment guard is application-level by necessity, not by
//              preference. UserRole.roleId is ON DELETE CASCADE, so the
//              database would accept the delete and silently strip the role
//              from every user holding it — unlike Campus, Department or
//              Programme, whose RESTRICT constraints refuse the delete
//              themselves. There is therefore no database backstop behind this
//              check: a role assigned in the instant between the count and the
//              delete would still be removed along with that assignment. The
//              check is scoped by roleId alone, which is complete because the
//              preceding lookup already proves the role belongs to this tenant.
//
//              RolePermission.roleId is likewise ON DELETE CASCADE and is left
//              to cascade: deleting an unassigned role removes its permission
//              grants, which no rule in the schema or README prohibits.
// RESPONSE   : { success: true, data: null, message: "Role deleted" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = roleIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsed.error),
        },
        { status: 400 }
      );
    }

    const roleId = parsed.data.id;

    // Two independent reads, so they are issued together rather than in
    // sequence.
    const [existing, assignmentCount] = await Promise.all([
      prisma.role.findFirst({
        where: { id: roleId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.userRole.count({ where: { roleId } }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: a role belonging to another tenant is reported as missing
    // rather than as assigned, which would confirm that the id exists.
    if (!existing) {
      return NextResponse.json(fail("Role not found", "NOT_FOUND"), { status: 404 });
    }

    if (assignmentCount > 0) {
      return NextResponse.json(
        fail("Role is assigned to users and cannot be deleted", "CONFLICT"),
        { status: 409 }
      );
    }

    await prisma.role.delete({
      where: { id: roleId, tenantId: tenant.id },
    });

    return NextResponse.json(ok(null, "Role deleted"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // No constraint on Role is RESTRICT today, so this branch is not
      // currently reachable. It is retained so a blocked delete could never be
      // misreported as a 500 if a future reference behaved differently.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Role has dependent records and cannot be deleted", "CONFLICT"),
          { status: 409 }
        );
      }
      // The role was deleted between the lookup and the delete.
      if (isRecordNotFound(err)) {
        return NextResponse.json(fail("Role not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[DELETE /api/roles/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
