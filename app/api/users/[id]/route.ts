// ============================================================================
// OWNER  : Gauransh
// MODULE : Users & RBAC — User Detail
// FLOW   : Guard → tenant → params → body → ownership → duplicate check →
//          write → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: View, update and delete a single user within the authenticated
//          tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation, isRecordNotFound } from "@/lib/utils/prisma-errors";
import { updateUserSchema, userIdParamSchema } from "@/lib/validations/user";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a user.
 *
 * passwordHash is deliberately absent and must stay absent. This is why every
 * handler below uses an explicit select rather than returning the Prisma model:
 * User.passwordHash is a plain column, so a query without a select would place
 * the bcrypt hash straight into the response body.
 *
 * The collection route declares the same shape. It is restated here rather than
 * imported because a Next.js route module may only export route handlers and
 * segment config, so this constant cannot be shared from there. The invariant
 * that binds the two copies is simply that neither may ever gain passwordHash.
 */
const USER_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  displayName: true,
  avatarUrl: true,
  isActive: true,
  isVerified: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

// User holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : userIdParamSchema — the [id] segment must be non-empty once
//              trimmed.
// FLOW       : Authorise → resolve tenant → read the user filtered by BOTH id
//              and tenantId, so a user owned by another tenant is simply not
//              found rather than being disclosed.
//              Assigned roles are fetched in the same query through a nested
//              select limited to the role id and name — one round trip, not a
//              follow-up query per user. Permissions are not traversed: the
//              README asks only for the user's roles, and RolePermission would
//              add a row per grant.
//              The join rows are flattened to a roles array before responding,
//              matching how /api/auth/me presents the same relation rather than
//              exposing the userRoles wrapper.
// RESPONSE   : { success: true, data: <User & { roles: { id, name }[] }> }
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
    const parsed = userIdParamSchema.safeParse(await params);
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
    const user = await prisma.user.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
      select: {
        ...USER_SELECT,
        userRoles: {
          select: {
            role: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(fail("User not found", "NOT_FOUND"), { status: 404 });
    }

    const { userRoles, ...profile } = user;

    return NextResponse.json(
      ok({
        ...profile,
        roles: userRoles.map((assignment) => assignment.role),
      })
    );
  } catch (err) {
    console.error("[GET /api/users/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : userIdParamSchema for the [id] segment, updateUserSchema for the
//              body. Every field optional but at least one required.
//              password, passwordHash, tenantId, isVerified and lastLoginAt are
//              all absent from the schema, so a body supplying any of them has
//              it stripped before Prisma is reached — a credential, a tenant
//              move or a verification flag cannot be set through this endpoint.
//              Credential changes belong to the auth flow per README Phase 1.
// FLOW       : Authorise → resolve tenant → validate → confirm the user belongs
//              to this tenant (404 otherwise) → re-check email uniqueness ONLY
//              when the address is both supplied and changing → apply one
//              atomic update scoped by id and tenantId.
//              Assigned roles are not returned here: they are read on GET and
//              changed through /api/users/[id]/roles, not through this body.
// RESPONSE   : { success: true, data: <User>, message: "User updated" }
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

    const parsedBody = updateUserSchema.safeParse(body);
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

    // One lookup serves two purposes: existence with tenant ownership, and the
    // current email used to decide whether the uniqueness check is needed.
    const existing = await prisma.user.findFirst({
      where: { id: userId, tenantId: tenant.id },
      select: { id: true, email: true },
    });

    if (!existing) {
      return NextResponse.json(fail("User not found", "NOT_FOUND"), { status: 404 });
    }

    const input = parsedBody.data;

    // Uniqueness is only re-checked for an address that is actually changing —
    // resubmitting the user's own current email is not a conflict with itself.
    // The constraint is @@unique([tenantId, email]), so the same address may
    // legitimately exist under a different tenant.
    if (input.email !== undefined && input.email !== existing.email) {
      const clash = await prisma.user.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email: input.email } },
        select: { id: true },
      });

      if (clash) {
        return NextResponse.json(fail("Email already in use", "CONFLICT"), { status: 409 });
      }
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed. Single statement, so the update
    // is atomic on its own.
    const user = await prisma.user.update({
      where: { id: userId, tenantId: tenant.id },
      data: input,
      select: USER_SELECT,
    });

    return NextResponse.json(ok(user, "User updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the address between the check and the update.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(fail("Email already in use", "CONFLICT"), { status: 409 });
      }
      // The user was deleted between the lookup and the update.
      if (isRecordNotFound(err)) {
        return NextResponse.json(fail("User not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[PATCH /api/users/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// DELETE
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : userIdParamSchema — the [id] segment must be non-empty once
//              trimmed.
// FLOW       : Authorise → resolve tenant → confirm the user belongs to this
//              tenant (404 otherwise) → issue a single delete scoped by id and
//              tenantId.
//              No cascade is performed in application code and no dependency is
//              pre-counted; the database owns both outcomes. Student.userId,
//              FacultyMember.userId and Employee.userId are ON DELETE RESTRICT,
//              so a user carrying any profile cannot be removed and surfaces as
//              a foreign-key violation → CONFLICT. Unlike the role assignment
//              guard, that constraint is a real backstop: it holds even if a
//              profile is created in the instant before the delete, so no
//              pre-check is needed to make this race-safe.
//              Session.userId and UserRole.userId are ON DELETE CASCADE, so a
//              deleted user's sessions and role assignments go with them.
// RESPONSE   : { success: true, data: null, message: "User deleted" }
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

    const parsed = userIdParamSchema.safeParse(await params);
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

    const userId = parsed.data.id;

    const existing = await prisma.user.findFirst({
      where: { id: userId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(fail("User not found", "NOT_FOUND"), { status: 404 });
    }

    await prisma.user.delete({
      where: { id: userId, tenantId: tenant.id },
    });

    return NextResponse.json(ok(null, "User deleted"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A student, faculty or employee profile still references this user; the
      // database refuses the delete rather than orphaning it. Reported, not
      // worked around.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("User has dependent records and cannot be deleted", "CONFLICT"),
          { status: 409 }
        );
      }
      // The user was deleted between the lookup and the delete.
      if (isRecordNotFound(err)) {
        return NextResponse.json(fail("User not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[DELETE /api/users/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
