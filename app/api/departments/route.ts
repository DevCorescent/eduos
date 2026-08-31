// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Departments Collection
// FLOW   : List and create tenant-owned departments.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma Department model.
// PURPOSE: Manage departments within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import {
  createDepartmentSchema,
  listDepartmentsQuerySchema,
} from "@/lib/validations/department";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

// Department holds no BigInt, Decimal or Json column — only strings and
// timestamps — so neither the shared serialize() helper nor an InputJsonValue
// cast applies here. The schema is immutable, so that cannot change.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : listDepartmentsQuerySchema — ?page (default 1) and ?limit
//              (default 20, max 100), from the shared pagination contract.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              departments alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable. No campus or school relation is expanded: README
//              Phase 3 asks for the department list only, so both are
//              referenced by id.
// RESPONSE   : { success: true, data: { departments, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = listDepartmentsQuerySchema.safeParse(
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

    const { page, limit, q, campusId, schoolId } = parsed.data;

    // The tenant predicate is never optional and never overridable: it comes
    // from requireTenant, and every filter is composed INSIDE it.
    //
    // THAT IS ALSO WHAT MAKES THE ID FILTERS SAFE. campusId and schoolId are
    // foreign keys supplied by the client, so either could name a row in a
    // different university. Because tenantId is ANDed alongside them, such an
    // id matches no department rather than reaching across the boundary — the
    // answer is an empty list, not another institution's data.
    //
    // The three conditions are ANDed, not ORed: the toolbar reads as a
    // narrowing — this text, in this campus, in this school — and an OR would
    // widen the result the moment a second control was touched.
    //
    // `mode: "insensitive"` is what makes "COMPUTER" and "computer" one search;
    // `contains` is what makes "comp" match "Computer Science" rather than only
    // a name equal to it.
    const where: Prisma.DepartmentWhereInput = {
      tenantId: tenant.id,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { code: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
      // schoolId is nullable, so filtering by a school correctly excludes
      // standalone departments — they belong to no school to match.
      ...(campusId ? { campusId } : {}),
      ...(schoolId ? { schoolId } : {}),
    };


    // Paired in one transaction so the total cannot shift between the two
    // reads. The explicit ordering is required for correctness, not
    // presentation: offset pagination over an unordered result can repeat or
    // skip rows. Ordering matches the campus and school listings.
    const [departments, total] = await prisma.$transaction([
      prisma.department.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.department.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        departments,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/departments]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createDepartmentSchema — campusId, name and code required;
//              schoolId, hodName and email optional. tenantId is never accepted
//              from the client.
// FLOW       : Authorise → resolve tenant → parse body → verify campus
//              ownership, school ownership (only when supplied) and code
//              uniqueness as three independent reads issued together → apply
//              the results in a fixed precedence → create the department under
//              the resolved tenant.
//              Both ownership checks are scoped by tenantId, so a row owned by
//              another tenant is reported as NOT_FOUND exactly like a
//              nonexistent one; the endpoint never confirms another tenant's
//              ids. The database's foreign keys cannot achieve this on their
//              own — they verify only that the referenced row exists, not who
//              owns it.
//              Department.code is unique per tenant via @@unique([tenantId,
//              code]), so the same code may legitimately exist under a
//              different tenant.
// RESPONSE   : { success: true, data: <Department>,
//                message: "Department created" }
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

    const parsed = createDepartmentSchema.safeParse(body);
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

    // Three independent reads, so they are issued together rather than in
    // sequence. The school lookup is skipped entirely when no schoolId was
    // supplied, since the column is nullable.
    const [campus, school, duplicate] = await Promise.all([
      prisma.campus.findFirst({
        where: { id: input.campusId, tenantId: tenant.id },
        select: { id: true },
      }),
      input.schoolId === undefined
        ? Promise.resolve(null)
        : prisma.school.findFirst({
            where: { id: input.schoolId, tenantId: tenant.id },
            select: { id: true },
          }),
      prisma.department.findUnique({
        where: { tenantId_code: { tenantId: tenant.id, code: input.code } },
        select: { id: true },
      }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // happened to resolve first: invalid references before constraint clashes.
    if (!campus) {
      return NextResponse.json(fail("Campus not found", "NOT_FOUND"), { status: 404 });
    }

    if (input.schoolId !== undefined && !school) {
      return NextResponse.json(fail("School not found", "NOT_FOUND"), { status: 404 });
    }

    if (duplicate) {
      return NextResponse.json(
        fail("Department code already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context, never from the request body.
    const department = await prisma.department.create({
      data: {
        ...input,
        tenantId: tenant.id,
      },
    });

    return NextResponse.json(ok(department, "Department created"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the code between the check and the insert.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Department code already in use", "CONFLICT"),
          { status: 409 }
        );
      }
      // The campus or school was deleted between the ownership check and the
      // insert, so the foreign key rejected the reference. Which of the two it
      // was is not reliably recoverable from the error, so both are reported
      // together rather than guessed at.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced campus or school not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[POST /api/departments]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
