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
import { requireModule } from "@/lib/middleware/requireModule";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { createEmployeeSchema, employeeQuerySchema } from "@/lib/validations/employee";
import { generateIdentifier } from "@/lib/services/identifier.service";
import { recordAudit } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
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
//              max 100) from the shared pagination contract, plus the four
//              parameters this screen's controls already send: ?q over name,
//              employee ID, designation and address, ?status, ?type and
//              ?departmentId. Each is optional, and an empty value means "no
//              filter" — which is what "All statuses", "All types" and "All
//              departments" write.
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

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

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

    const { page, limit, q, status, type, departmentId } = parsed.data;

    // WHY THE TERM IS SPLIT ON WHITESPACE
    //   Employee has no name column — the name lives on the related User as
    //   firstName and lastName, and Prisma cannot concatenate two columns inside
    //   a `where`. A plain OR matches "Asha" and matches "Rao" but never "Asha
    //   Rao" typed in full, which is the most natural thing to type into a box
    //   labelled "Search by name". The students and faculty routes record the
    //   same trap and solve it the same way.
    //
    //   So every whitespace-separated term must match SOMEWHERE, in any order.
    //   A single term behaves exactly as a plain OR would.
    //
    // The fields are the ones the placeholder promises — name, ID and
    // designation — plus the address, which is the other thing an administrator
    // has to hand when looking someone up.
    //
    // `mode: "insensitive"` makes "ASHA", "Asha" and "asha" one search;
    // `contains` makes "as" match "Asha" rather than only an exact name.
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];

    // THE TENANT PREDICATE IS NEVER OPTIONAL AND NEVER OVERRIDABLE. It comes
    // from requireTenant, and every filter is composed INSIDE it, so no value of
    // ?q, ?status, ?type or ?departmentId can reach another institution's rows —
    // and a ?tenantId in the query string is not read at all.
    //
    // Employee.departmentId is a plain nullable scalar with NO Prisma relation
    // (see the note on the POST handler below), so the department filter is a
    // direct equality rather than a nested relation filter. There is also no
    // department scoping on this endpoint, so unlike the faculty listing there
    // is no restriction for this filter to intersect with.
    //
    // The conditions are ANDed, not ORed: the toolbar reads as a narrowing —
    // this text, with this status, of this type, in this department — and an OR
    // would widen the result the moment a second control was touched.
    const where: Prisma.EmployeeWhereInput = {
      tenantId: tenant.id,
      ...(terms.length > 0
        ? {
            AND: terms.map((term) => ({
              OR: [
                { employeeId: { contains: term, mode: "insensitive" as const } },
                { designation: { contains: term, mode: "insensitive" as const } },
                { user: { firstName: { contains: term, mode: "insensitive" as const } } },
                { user: { lastName: { contains: term, mode: "insensitive" as const } } },
                { user: { email: { contains: term, mode: "insensitive" as const } } },
              ],
            })),
          }
        : {}),
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(departmentId ? { departmentId } : {}),
    };

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

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

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
      // Nothing to pre-check when the engine will issue it: a generated value
      // is unique by construction, and the unique index remains the real guard
      // either way.
      input.employeeId === undefined
        ? Promise.resolve(null)
        : prisma.employee.findUnique({
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
        // PRD §9 — the identifier engine issues employeeId when the caller omits it.
    //
    // The field stays OPTIONAL rather than becoming generated-only: an
    // institution that has not configured a sequence must keep working exactly
    // as before, and a migration importing legacy records must be able to carry
    // their existing numbers across. A supplied value always wins, so this is a
    // widening of the contract and breaks no existing client.
    //
    // Generation happens INSIDE the transaction that creates the row, so a
    // failed create rolls the counter back with it and leaves no gap.
    // One actor for every entry this request writes, so the identifier issue
    // and the record creation are findable together.
    const actor = {
      userId: guard.session.sub,
      ...readRequestOrigin(request.headers),
    };

    const employee = await prisma.$transaction(async (tx) => {
      const employeeId =
        input.employeeId ??
        (await generateIdentifier(
          { tenantId: tenant.id, entityType: "EMPLOYEE", actor },
          tx
        ));

      const created = await tx.employee.create({
        data: {
          ...input,
          employeeId,
          tenantId: tenant.id,
        },
        select: EMPLOYEE_SELECT,
      });

      // PRD §47 "Data change logs". Same transaction as the row it describes,
      // so evidence and record commit or roll back together.
      await recordAudit(
        {
          tenantId: tenant.id,
          actor,
          action: AUDIT_ACTIONS.EMPLOYEE_CREATED,
          resource: AUDIT_RESOURCES.EMPLOYEE,
          resourceId: created.id,
          // The identifier and the linked user, not the whole record. A
          // creation snapshot of every column would copy personal data into a
          // second table for no investigative gain.
          after: { employeeId, userId: created.userId },
        },
        tx
      );

      return created;
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
