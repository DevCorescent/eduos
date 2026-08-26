// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty — Faculty Collection
// FLOW   : Guard → tenant → query/body → parallel ownership and existence
//          checks → duplicate checks → create → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: List and create faculty members within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { createFacultySchema, facultyQuerySchema } from "@/lib/validations/faculty";
import { generateIdentifier } from "@/lib/services/identifier.service";
import { recordAudit } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a faculty member. Declared once so both handlers answer
 * with the same shape.
 *
 * FacultyMember carries no credential or otherwise sensitive column of its own,
 * but the select is explicit for the same reason it is everywhere else here: it
 * fixes the response contract rather than letting it track whatever the model
 * happens to contain. No relation is expanded — the linked User, and therefore
 * the member's name and email, is reached through GET /api/faculty/[id] rather
 * than being joined into every list row.
 */
const FACULTY_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  employeeId: true,
  departmentId: true,
  designation: true,
  qualification: true,
  specialization: true,
  experience: true,
  status: true,
  joinDate: true,
  createdAt: true,
  updatedAt: true,
} as const;

// FacultyMember holds no BigInt, Decimal or Json column, so the shared
// serialize() helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : facultyQuerySchema — ?page (default 1) and ?limit (default 20,
//              max 100), from the shared pagination contract. No search
//              parameter is defined: the project implements none on any existing
//              collection endpoint.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              faculty alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable.
// RESPONSE   : { success: true, data: { faculty, pagination } }
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

    const parsed = facultyQuerySchema.safeParse(
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
    // tiebreaker matters because members onboarded in the same batch can share a
    // createdAt timestamp, leaving createdAt alone non-deterministic.
    const [faculty, total] = await prisma.$transaction([
      prisma.facultyMember.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: FACULTY_SELECT,
      }),
      prisma.facultyMember.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        faculty,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/faculty]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createFacultySchema — userId, employeeId and joinDate required;
//              the rest optional. experience must be zero or more. tenantId, id,
//              createdAt and updatedAt are absent from the schema and so are
//              stripped from any body that supplies them.
// FLOW       : Authorise → resolve tenant → parse body → run four independent
//              lookups together → apply them in a fixed precedence → create.
//
//              Every reference is verified against this tenant, not merely for
//              existence. FacultyMember.departmentId does carry a foreign key,
//              so the database would confirm the department exists — but a
//              foreign key says nothing about who owns the row, so without this
//              check a caller could attach a faculty member to another
//              university's department and the insert would succeed.
//
//              Two uniqueness rules apply. FacultyMember.userId is @unique
//              globally, so a user may hold at most one faculty record;
//              @@unique([tenantId, employeeId]) makes an employee id unique
//              within the tenant while allowing the same id under a different
//              tenant.
// RESPONSE   : { success: true, data: <FacultyMember>,
//                message: "Faculty member created" }
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

    const parsed = createFacultySchema.safeParse(body);
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
    const [user, facultyForUser, duplicateEmployeeId, department] = await Promise.all([
      prisma.user.findFirst({
        where: { id: input.userId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.facultyMember.findUnique({
        where: { userId: input.userId },
        select: { id: true },
      }),
      // Nothing to pre-check when the engine will issue it: a generated value
      // is unique by construction, and the unique index remains the real guard
      // either way.
      input.employeeId === undefined
        ? Promise.resolve(null)
        : prisma.facultyMember.findUnique({
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
    // before the department since it is the member's identity.
    if (!user) {
      return NextResponse.json(fail("User not found", "NOT_FOUND"), { status: 404 });
    }

    if (input.departmentId !== undefined && !department) {
      return NextResponse.json(fail("Department not found", "NOT_FOUND"), { status: 404 });
    }

    if (facultyForUser) {
      return NextResponse.json(
        fail("User is already linked to a faculty member", "CONFLICT"),
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

    const faculty = await prisma.$transaction(async (tx) => {
      const employeeId =
        input.employeeId ??
        (await generateIdentifier(
          { tenantId: tenant.id, entityType: "FACULTY", actor },
          tx
        ));

      const created = await tx.facultyMember.create({
        data: {
          ...input,
          employeeId,
          tenantId: tenant.id,
        },
        select: FACULTY_SELECT,
      });

      // PRD §47 "Data change logs". Same transaction as the row it describes,
      // so evidence and record commit or roll back together.
      await recordAudit(
        {
          tenantId: tenant.id,
          actor,
          action: AUDIT_ACTIONS.FACULTY_CREATED,
          resource: AUDIT_RESOURCES.FACULTY,
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

    return NextResponse.json(ok(faculty, "Faculty member created"), { status: 201 });
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
      // The user or department was deleted between its check and the insert, so
      // the foreign key rejected the reference.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced user or department not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[POST /api/faculty]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
