// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Programme Collection
// FLOW   : List and create tenant-owned programmes.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma Programme model.
// PURPOSE: Manage programmes within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import {
  createProgrammeSchema,
  listProgrammesQuerySchema,
} from "@/lib/validations/programme";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

// Programme holds no BigInt, Decimal or Json column — only strings, integers, a
// boolean, enums and timestamps — so neither the shared serialize() helper nor
// an InputJsonValue cast applies here. The schema is immutable, so that cannot
// change.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : listProgrammesQuerySchema — ?page (default 1) and ?limit
//              (default 20, max 100), from the shared pagination contract.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              programmes alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable. No department relation is expanded: README Phase 3
//              asks for the programme list only, so it is referenced by
//              departmentId.
// RESPONSE   : { success: true, data: { programmes, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = listProgrammesQuerySchema.safeParse(
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

    const { page, limit, q, departmentId, type } = parsed.data;

    // The tenant predicate is never optional and never overridable: it comes
    // from requireTenant, and every filter is composed INSIDE it.
    //
    // THAT IS ALSO WHAT MAKES THE ID FILTER SAFE. departmentId is a foreign key
    // supplied by the client, so it could name a department in a different
    // university. Because tenantId is ANDed alongside it, such an id matches no
    // programme rather than reaching across the boundary — the answer is an
    // empty list, not another institution's data.
    //
    // The conditions are ANDed, not ORed: the toolbar reads as a narrowing —
    // this text, in this department, of this type — and an OR would widen the
    // result the moment a second control was touched.
    //
    // `mode: "insensitive"` is what makes "COMPUTER" and "computer" one search;
    // `contains` is what makes "comp" match "Computer Science" rather than only
    // a name equal to it.
    const where: Prisma.ProgrammeWhereInput = {
      tenantId: tenant.id,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { code: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(type ? { type } : {}),
    };


    // Paired in one transaction so the total cannot shift between the two
    // reads. The explicit ordering is required for correctness, not
    // presentation: offset pagination over an unordered result can repeat or
    // skip rows. Ordering matches every previous collection endpoint.
    const [programmes, total] = await prisma.$transaction([
      prisma.programme.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.programme.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        programmes,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/programmes]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createProgrammeSchema — departmentId, name, code and
//              durationValue required; type, durationUnit, totalCredits,
//              eligibility, description and isActive optional, each falling
//              back to its schema default. tenantId is never accepted from the
//              client.
// FLOW       : Authorise → resolve tenant → parse body → verify department
//              ownership and code uniqueness as two independent reads issued
//              together → apply the results in a fixed precedence → create the
//              programme under the resolved tenant.
//              The ownership check is scoped by tenantId, so a department owned
//              by another tenant is reported as NOT_FOUND exactly like a
//              nonexistent one; the endpoint never confirms another tenant's
//              ids. The database's foreign key cannot achieve this on its own —
//              it verifies only that the referenced row exists, not who owns it.
//              Programme.code is unique per tenant via @@unique([tenantId,
//              code]), so the same code may legitimately exist under a
//              different tenant.
// RESPONSE   : { success: true, data: <Programme>,
//                message: "Programme created" }
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

    const parsed = createProgrammeSchema.safeParse(body);
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

    // Two independent reads, so they are issued together rather than in
    // sequence.
    const [department, duplicate] = await Promise.all([
      prisma.department.findFirst({
        where: { id: input.departmentId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.programme.findUnique({
        where: { tenantId_code: { tenantId: tenant.id, code: input.code } },
        select: { id: true },
      }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // happened to resolve first: invalid references before constraint clashes.
    if (!department) {
      return NextResponse.json(fail("Department not found", "NOT_FOUND"), { status: 404 });
    }

    if (duplicate) {
      return NextResponse.json(
        fail("Programme code already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context, never from the request body.
    const programme = await prisma.programme.create({
      data: {
        ...input,
        tenantId: tenant.id,
      },
    });

    return NextResponse.json(ok(programme, "Programme created"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the code between the check and the insert.
      // This is the backstop the pre-check cannot provide: two requests can
      // both pass the lookup before either has written.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Programme code already in use", "CONFLICT"),
          { status: 409 }
        );
      }
      // The department was deleted between the ownership check and the insert,
      // so the foreign key rejected the reference.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(fail("Department not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[POST /api/programmes]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
