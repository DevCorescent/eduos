// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty — Non-Teaching Employee Collection
// FLOW   : Guard → tenant → query/body → parallel ownership and existence
//          checks → duplicate checks → create → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: List and create non-teaching employees within the authenticated
//          tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { createEmployeeSchema, employeeQuerySchema } from "@/lib/validations/employee";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for an employee. Declared once so both handlers answer with
 * the same shape.
 *
 * No relation is expanded — the linked User, and therefore the employee's name
 * and email, is reached through GET /api/employees/[id] rather than being joined
 * into every list row.
 */
const EMPLOYEE_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  employeeId: true,
  departmentId: true,
  designation: true,
  type: true,
  status: true,
  joinDate: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Employee holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : employeeQuerySchema — ?page (default 1) and ?limit (default 20,
//              max 100), from the shared pagination contract. No search
//              parameter is defined: the project implements none on any existing
//              collection endpoint.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              employees alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable.
// RESPONSE   : { success: true, data: { employees, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = employeeQuerySchema.safeParse(
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
    // tiebreaker matters because employees onboarded in the same batch can share
    // a createdAt timestamp, leaving createdAt alone non-deterministic.
    const [employees, total] = await prisma.$transaction([
      prisma.employee.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: EMPLOYEE_SELECT,
      }),
      prisma.employee.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        employees,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/employees]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createEmployeeSchema — userId, employeeId and joinDate required;
//              the rest optional. tenantId, id, createdAt and updatedAt are
//              absent from the schema and so are stripped from any body that
//              supplies them.
// FLOW       : Authorise → resolve tenant → parse body → run four independent
//              lookups together → apply them in a fixed precedence → create.
//
//              Every reference is verified against this tenant, not merely for
//              existence. The two references are not equally protected by the
//              database: Employee.userId carries a foreign key, so a nonexistent
//              user would be refused anyway — though the key says nothing about
//              ownership, which is why the lookup is still tenant-scoped. But
//              Employee.departmentId has neither a relation nor a foreign key in
//              the schema, unlike FacultyMember.departmentId which does, so the
//              column would accept any string at all. For that reference the
//              check here is the only one that exists anywhere, on create and on
//              update alike.
//
//              Two uniqueness rules apply. Employee.userId is @unique globally,
//              so a user may hold at most one employee record;
//              @@unique([tenantId, employeeId]) makes an employee id unique
//              within the tenant while allowing the same id under a different
//              tenant. Note that a user already registered as a FacultyMember is
//              not prevented from also holding an Employee record: the two models
//              carry separate constraints and neither schema nor README forbids
//              the overlap.
// RESPONSE   : { success: true, data: <Employee>,
//                message: "Employee created" }
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

    const parsed = createEmployeeSchema.safeParse(body);
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

    // Four independent reads, so they are issued together rather than in
    // sequence. The department lookup is skipped entirely when no departmentId
    // was supplied, since the column is nullable.
    const [user, employeeForUser, duplicateEmployeeId, department] = await Promise.all([
      prisma.user.findFirst({
        where: { id: input.userId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.employee.findUnique({
        where: { userId: input.userId },
        select: { id: true },
      }),
      prisma.employee.findUnique({
        where: {
          tenantId_employeeId: { tenantId: tenant.id, employeeId: input.employeeId },
        },
        select: { id: true },
      }),
      input.departmentId === undefined
        ? Promise.resolve(null)
        : prisma.department.findFirst({
            where: { id: input.departmentId, tenantId: tenant.id },
            select: { id: true },
          }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: invalid references before constraint clashes, and the user
    // before the department since it is the employee's identity.
    if (!user) {
      return NextResponse.json(fail("User not found", "NOT_FOUND"), { status: 404 });
    }

    if (input.departmentId !== undefined && !department) {
      return NextResponse.json(fail("Department not found", "NOT_FOUND"), { status: 404 });
    }

    if (employeeForUser) {
      return NextResponse.json(
        fail("User is already linked to an employee", "CONFLICT"),
        { status: 409 }
      );
    }

    if (duplicateEmployeeId) {
      return NextResponse.json(
        fail("Employee id already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context, never from the request body.
    const employee = await prisma.employee.create({
      data: {
        ...input,
        tenantId: tenant.id,
      },
      select: EMPLOYEE_SELECT,
    });

    return NextResponse.json(ok(employee, "Employee created"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the employee id or the user between the checks
      // and the insert. Which of the two unique constraints was violated is not
      // reliably recoverable from the error under the driver adapter, so both are
      // reported together rather than guessed at.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Employee id or user already in use", "CONFLICT"),
          { status: 409 }
        );
      }
      // The user was deleted between its check and the insert, so the foreign key
      // rejected the reference. departmentId cannot appear here: it has no
      // foreign key, so a department deleted in that window leaves a dangling id
      // rather than raising anything.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(fail("User not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[POST /api/employees]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
