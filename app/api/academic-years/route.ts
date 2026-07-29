// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Academic Year Collection
// FLOW   : List and create tenant-owned academic years.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma AcademicYear model.
// PURPOSE: Manage academic years within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import {
  createAcademicYearSchema,
  listAcademicYearsQuerySchema,
} from "@/lib/validations/academic-year";
import { ok, fail } from "@/types";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

// AcademicYear holds no BigInt, Decimal or Json column — only strings, dates
// and a boolean — so neither the shared serialize() helper nor an
// InputJsonValue cast applies here. The schema is immutable, so that cannot
// change. Note also that this model carries createdAt but no updatedAt.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : listAcademicYearsQuerySchema — ?page (default 1) and ?limit
//              (default 20, max 100), from the shared pagination contract.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              academic years alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable. No semester or batch relation is expanded.
// RESPONSE   : { success: true, data: { academicYears, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = listAcademicYearsQuerySchema.safeParse(
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
    const [academicYears, total] = await prisma.$transaction([
      prisma.academicYear.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.academicYear.count({ where: { tenantId: tenant.id } }),
    ]);

    return NextResponse.json(
      ok({
        academicYears,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/academic-years]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createAcademicYearSchema — name, startDate and endDate required;
//              isCurrent optional, falling back to its schema default.
//              tenantId is never accepted from the client.
// FLOW       : Authorise → resolve tenant → parse body → reject a name already
//              used within this tenant → create the academic year under the
//              resolved tenant.
//              AcademicYear is unique on name via @@unique([tenantId, name]),
//              so the same name may legitimately exist under a different
//              tenant. This model has no foreign key of its own beyond the
//              tenant, so there is no reference to validate.
// RESPONSE   : { success: true, data: <AcademicYear>,
//                message: "Academic year created" }
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

    const parsed = createAcademicYearSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const input = parsed.data;

    const existing = await prisma.academicYear.findUnique({
      where: { tenantId_name: { tenantId: tenant.id, name: input.name } },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json(
        fail("Academic year name already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    const data = { ...input, tenantId: tenant.id };

    // At most one academic year per tenant may be current. When this one claims
    // it, the previous holder is cleared and the row inserted in a single
    // transaction, so the two never diverge — no window exists in which the
    // tenant has two current years or none.
    // Only an explicit isCurrent: true triggers the clear; false or omitted
    // leaves any existing current year alone.
    const academicYear =
      input.isCurrent === true
        ? (
            await prisma.$transaction([
              prisma.academicYear.updateMany({
                where: { tenantId: tenant.id, isCurrent: true },
                data: { isCurrent: false },
              }),
              prisma.academicYear.create({ data }),
            ])
          )[1]
        : await prisma.academicYear.create({ data });

    return NextResponse.json(ok(academicYear, "Academic year created"), { status: 201 });
  } catch (err) {
    // The uniqueness pre-check above narrows the common case; this covers the
    // race where a concurrent request inserted the same name in between.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
      return NextResponse.json(
        fail("Academic year name already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    console.error("[POST /api/academic-years]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
