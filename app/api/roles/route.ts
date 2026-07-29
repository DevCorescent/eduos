// ============================================================================
// OWNER  : Gauransh
// MODULE : Users & RBAC — Role Collection
// FLOW   : Guard → tenant → query/body → duplicate check → write → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: List and create roles within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { createRoleSchema, listRolesQuerySchema } from "@/lib/validations/role";
import { ok, fail } from "@/types";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

// Role holds no BigInt, Decimal or Json column — only strings, a boolean and
// timestamps — so neither the shared serialize() helper nor an InputJsonValue
// cast applies here. The schema is immutable, so that cannot change.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : listRolesQuerySchema — ?page (default 1) and ?limit (default 20,
//              max 100), from the shared pagination contract.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              roles alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable. Neither rolePermissions nor userRoles is expanded:
//              README Phase 5 asks for the role list only, and joining either
//              would load a row per assignment for every role on the page.
// RESPONSE   : { success: true, data: { roles, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = listRolesQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const { page, limit } = parsed.data;

    // Paired in one transaction so the total cannot shift between the two
    // reads. The explicit ordering is required for correctness, not
    // presentation: offset pagination over an unordered result can repeat or
    // skip rows. Ordering matches every previous collection endpoint.
    const [roles, total] = await prisma.$transaction([
      prisma.role.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          tenantId: true,
          name: true,
          description: true,
          isSystem: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.role.count({ where: { tenantId: tenant.id } }),
    ]);

    return NextResponse.json(
      ok({
        roles,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/roles]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createRoleSchema — name required, description optional.
//              Neither tenantId nor isSystem is accepted from the client.
// FLOW       : Authorise → resolve tenant → parse body → reject a name already
//              used within this tenant → create the role under the resolved
//              tenant.
//              Role.name is unique per tenant via @@unique([tenantId, name]),
//              so the same name may legitimately exist under a different
//              tenant. Role has no foreign key of its own beyond the tenant, so
//              there is no reference to validate.
//              isSystem is written as false explicitly rather than left to the
//              database default, so a role created through the API is always a
//              tenant role regardless of what the client sent.
// RESPONSE   : { success: true, data: <Role>, message: "Role created" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = createRoleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const input = parsed.data;

    const existing = await prisma.role.findUnique({
      where: { tenantId_name: { tenantId: tenant.id, name: input.name } },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json(fail("Role name already in use", "CONFLICT"), { status: 409 });
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context and isSystem is forced to false,
    // never from the request body.
    const role = await prisma.role.create({
      data: {
        ...input,
        tenantId: tenant.id,
        isSystem: false,
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        description: true,
        isSystem: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(ok(role, "Role created"), { status: 201 });
  } catch (err) {
    // The uniqueness pre-check above narrows the common case; this covers the
    // race where a concurrent request inserted the same name in between.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
      return NextResponse.json(fail("Role name already in use", "CONFLICT"), { status: 409 });
    }

    console.error("[POST /api/roles]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
