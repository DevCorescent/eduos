// ============================================================================
// OWNER  : Gauransh
// MODULE : Curriculum — Course Collection
// FLOW   : Guard → tenant → query/body → department ownership check → duplicate
//          code check → list/create → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: List and create courses within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { courseQuerySchema, createCourseSchema } from "@/lib/validations/course";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a course. Declared once so both handlers answer with the
 * same shape.
 *
 * No relation is expanded, and for this model none could be: Course declares no
 * department relation in the schema, so the department's name is not reachable
 * through a nested select here at all — the response carries departmentId and
 * nothing more. This differs from other modules, where omitting a relation is a
 * choice rather than a constraint.
 */
const COURSE_SELECT = {
  id: true,
  tenantId: true,
  departmentId: true,
  name: true,
  code: true,
  type: true,
  credits: true,
  description: true,
  syllabus: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Course holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : courseQuerySchema — ?page (default 1) and ?limit (default 20,
//              max 100), from the shared pagination contract. No search or
//              filter parameter is defined: the project implements none on any
//              existing collection endpoint. In particular there is no
//              ?isActive filter, so inactive courses list alongside active ones
//              and the client reads the flag.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              courses alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable.
// RESPONSE   : { success: true, data: { courses, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = courseQuerySchema.safeParse(
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
    const where = { tenantId: tenant.id };

    // Paired in one transaction so the total cannot shift between the two reads.
    // The ordering is required for correctness, not presentation: offset
    // pagination over an unordered result can repeat or skip rows, and the id
    // tiebreaker matters because courses imported in the same batch can share a
    // createdAt timestamp, leaving createdAt alone non-deterministic.
    const [courses, total] = await prisma.$transaction([
      prisma.course.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: COURSE_SELECT,
      }),
      prisma.course.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        courses,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/courses]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createCourseSchema — name and code required, the rest optional.
//              tenantId, id, createdAt and updatedAt are absent from the schema
//              and so are stripped from any body that supplies them.
//              No validation is applied beyond what the schema declares: credits
//              may be zero or negative because Course.credits is a plain Int with
//              no constraint, and type, credits and isActive are left absent when
//              omitted so the database defaults (CORE, 3, true) apply rather than
//              being restated here.
// FLOW       : Authorise → resolve tenant → parse body → run both lookups
//              together → apply them in a fixed precedence → create.
//
//              departmentId is optional, and the lookup is skipped entirely when
//              it is not supplied. When it is, the department is verified to exist
//              AND to belong to this tenant, and that check is the only protection
//              the reference has anywhere: Course declares no foreign key at all
//              in the migration — not on departmentId, and not even on tenantId —
//              so the column would otherwise accept any string, including another
//              tenant's id. An unknown department and one owned by another tenant
//              return the identical 404, so no id is ever confirmed to exist
//              elsewhere.
//
//              @@unique([tenantId, code]) makes a course code unique within the
//              tenant while allowing the same code under a different tenant, so
//              the duplicate check is scoped to the resolved tenant rather than
//              being global.
// RESPONSE   : { success: true, data: <Course>, message: "Course created" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              No foreign-key branch is handled here, and none is reachable:
//              Course has no foreign key on any column, so a department deleted
//              between its check and the insert leaves a dangling departmentId
//              rather than raising anything — the same silent outcome as
//              Student.programmeId and Employee.departmentId. P2002 remains the
//              race backstop for the tenant-scoped code, which is a real unique
//              index.
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

    const parsed = createCourseSchema.safeParse(body);
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
    // sequence. The department lookup is skipped entirely when no departmentId
    // was supplied, since the column is nullable.
    const [department, duplicateCode] = await Promise.all([
      input.departmentId === undefined
        ? Promise.resolve(null)
        : prisma.department.findFirst({
            where: { id: input.departmentId, tenantId: tenant.id },
            select: { id: true },
          }),
      prisma.course.findUnique({
        where: { tenantId_code: { tenantId: tenant.id, code: input.code } },
        select: { id: true },
      }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: an invalid reference before the constraint clash.
    if (input.departmentId !== undefined && !department) {
      return NextResponse.json(fail("Department not found", "NOT_FOUND"), { status: 404 });
    }

    if (duplicateCode) {
      return NextResponse.json(
        fail("Course code already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context, never from the request body.
    const course = await prisma.course.create({
      data: {
        ...input,
        tenantId: tenant.id,
      },
      select: COURSE_SELECT,
    });

    return NextResponse.json(ok(course, "Course created"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the code between the pre-check and the insert.
      // The tenant-scoped code is the model's only unique constraint, so it is
      // the only cause this branch can have.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Course code already in use", "CONFLICT"),
          { status: 409 }
        );
      }
    }

    console.error("[POST /api/courses]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
