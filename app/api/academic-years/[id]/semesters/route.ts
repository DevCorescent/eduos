// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Academic Year Semesters
// FLOW   : List and create semesters for a tenant-owned academic year.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma Semester model.
// PURPOSE: Manage semesters within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { academicYearIdParamSchema } from "@/lib/validations/academic-year";
import {
  createSemesterSchema,
  listSemestersQuerySchema,
} from "@/lib/validations/semester";
import { ok, fail } from "@/types";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

// Semester holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here. The [id] segment is the ACADEMIC YEAR id, so the
// existing academic year param schema is reused rather than redeclared.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : academicYearIdParamSchema for the [id] segment,
//              listSemestersQuerySchema for ?page and ?limit.
// FLOW       : Authorise → resolve tenant → confirm the academic year exists
//              AND belongs to this tenant (404 for either) → read one page of
//              its semesters alongside the total in a single transaction.
//              The parent check comes first: without it an unknown academic
//              year would return an empty list rather than 404.
// RESPONSE   : { success: true, data: { semesters, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
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
    const parsedParams = academicYearIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedQuery = listSemestersQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const academicYearId = parsedParams.data.id;

    const academicYear = await prisma.academicYear.findFirst({
      where: { id: academicYearId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!academicYear) {
      return NextResponse.json(fail("Academic year not found", "NOT_FOUND"), { status: 404 });
    }

    const { page, limit } = parsedQuery.data;
    const where = { tenantId: tenant.id, academicYearId };

    const [semesters, total] = await prisma.$transaction([
      prisma.semester.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.semester.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        semesters,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/academic-years/[id]/semesters]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : academicYearIdParamSchema for the [id] segment,
//              createSemesterSchema for the body. Neither tenantId nor
//              academicYearId is accepted from the client.
// FLOW       : Authorise → resolve tenant → parse body → verify academic year
//              ownership and semesterNumber uniqueness as two independent reads
//              issued together → apply in fixed precedence → create.
//              Uniqueness is @@unique([academicYearId, semesterNumber]), scoped
//              to the academic year rather than the tenant.
//              At most one semester per ACADEMIC YEAR may be current; claiming
//              it clears the previous holder in the same transaction.
// RESPONSE   : { success: true, data: <Semester>,
//                message: "Semester created" }
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

    const parsedParams = academicYearIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = createSemesterSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const academicYearId = parsedParams.data.id;
    const input = parsedBody.data;

    // Two independent reads, issued together rather than in sequence.
    const [academicYear, duplicate] = await Promise.all([
      prisma.academicYear.findFirst({
        where: { id: academicYearId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.semester.findUnique({
        where: {
          academicYearId_semesterNumber: {
            academicYearId,
            semesterNumber: input.semesterNumber,
          },
        },
        select: { id: true },
      }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: an invalid parent before a constraint clash.
    if (!academicYear) {
      return NextResponse.json(fail("Academic year not found", "NOT_FOUND"), { status: 404 });
    }

    if (duplicate) {
      return NextResponse.json(
        fail("Semester number already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    const data = { ...input, tenantId: tenant.id, academicYearId };

    // At most one semester per academic year may be current. When this one
    // claims it, the previous holder is cleared and the row inserted in a single
    // transaction, so the two never diverge. Only an explicit isCurrent: true
    // triggers the clear.
    const semester =
      input.isCurrent === true
        ? (
            await prisma.$transaction([
              prisma.semester.updateMany({
                where: { academicYearId, isCurrent: true },
                data: { isCurrent: false },
              }),
              prisma.semester.create({ data }),
            ])
          )[1]
        : await prisma.semester.create({ data });

    return NextResponse.json(ok(semester, "Semester created"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the semester number between check and insert.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Semester number already in use", "CONFLICT"),
          { status: 409 }
        );
      }
      // The academic year was deleted between the ownership check and the
      // insert, so the foreign key rejected the reference.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(fail("Academic year not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[POST /api/academic-years/[id]/semesters]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
