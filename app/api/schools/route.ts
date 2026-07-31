// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Schools Collection
// FLOW   : List and create tenant-owned schools.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma School model.
// PURPOSE: Manage schools within a university tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { createSchoolSchema, listSchoolsQuerySchema } from "@/lib/validations/school";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

// School holds no BigInt, Decimal or Json column — only strings and timestamps
// — so neither the shared serialize() helper nor an InputJsonValue cast applies
// here. The schema is immutable, so that cannot change.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : listSchoolsQuerySchema — ?page (default 1) and ?limit
//              (default 20, max 100), from the shared pagination contract.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              schools alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable. No campus relation is expanded: README Phase 3 asks
//              for the school list only, so the campus is referenced by
//              campusId.
// RESPONSE   : { success: true, data: { schools, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = listSchoolsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
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

    const { page, limit } = parsed.data;

    // Paired in one transaction so the total cannot shift between the two
    // reads. The explicit ordering is required for correctness, not
    // presentation: offset pagination over an unordered result can repeat or
    // skip rows.
    const [schools, total] = await prisma.$transaction([
      prisma.school.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.school.count({ where: { tenantId: tenant.id } }),
    ]);

    return NextResponse.json(
      ok({
        schools,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/schools]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createSchoolSchema — campusId, name and code required, deanName
//              and email optional. tenantId is never accepted from the client.
// FLOW       : Authorise → resolve tenant → parse body → confirm the referenced
//              campus exists AND belongs to this tenant → reject a code already
//              used within this tenant → create the school under the resolved
//              tenant.
//              The campus check is scoped by tenantId, so a campus owned by
//              another tenant is reported as NOT_FOUND exactly like a
//              nonexistent one; the endpoint never confirms another tenant's
//              ids. Relying on the foreign key alone would not achieve this —
//              the database would happily accept a valid campus id belonging to
//              a different tenant.
//              School.code is unique per tenant via @@unique([tenantId, code]),
//              so the same code may legitimately exist under a different tenant.
// RESPONSE   : { success: true, data: <School>, message: "School created" }
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

    const parsed = createSchoolSchema.safeParse(body);
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

    const input = parsed.data;

    // Ownership of the referenced campus is settled before the constraint
    // check, so an invalid reference is reported as such rather than being
    // masked by an unrelated code conflict.
    const campus = await prisma.campus.findFirst({
      where: { id: input.campusId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!campus) {
      return NextResponse.json(fail("Campus not found", "NOT_FOUND"), { status: 404 });
    }

    const existing = await prisma.school.findUnique({
      where: { tenantId_code: { tenantId: tenant.id, code: input.code } },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json(fail("School code already in use", "CONFLICT"), { status: 409 });
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context, never from the request body.
    const school = await prisma.school.create({
      data: {
        ...input,
        tenantId: tenant.id,
      },
    });

    return NextResponse.json(ok(school, "School created"), { status: 201 });
  } catch (err) {
    // The uniqueness pre-check above narrows the common case; this covers the
    // race where a concurrent request inserted the same code in between.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
      return NextResponse.json(fail("School code already in use", "CONFLICT"), { status: 409 });
    }

    console.error("[POST /api/schools]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
