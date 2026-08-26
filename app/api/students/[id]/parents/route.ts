// ============================================================================
// OWNER  : Gauransh
// MODULE : Students — Student Parent Links
// FLOW   : Guard → tenant → params → body → parallel ownership and duplicate
//          checks → link → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: List the parents linked to a student and link an existing parent to
//          that student, within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { linkParentSchema, listStudentParentsQuerySchema } from "@/lib/validations/parent";
import { studentIdParamSchema } from "@/lib/validations/student";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a parent.
 *
 * The parent collection route declares the same shape. It is restated here
 * rather than imported because a Next.js route module may only export route
 * handlers and segment config.
 *
 * annualIncome is a Decimal(12, 2). Prisma's Decimal defines its own toJSON and
 * serialises to a string, so the shared serialize() helper is not needed — it
 * exists for BigInt, which throws on JSON.stringify, and neither Parent nor
 * StudentParent has a BigInt column. Note that the string form is normalised:
 * a stored 50000.00 is returned as "50000", so a consumer must format currency
 * itself rather than relying on the wire value to carry two decimal places.
 */
const PARENT_SELECT = {
  id: true,
  tenantId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  occupation: true,
  annualIncome: true,
  relation: true,
  createdAt: true,
} as const;

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : studentIdParamSchema for the [id] segment,
//              listStudentParentsQuerySchema for ?page and ?limit.
// FLOW       : Authorise → resolve tenant → confirm the student belongs to this
//              tenant (404 otherwise) → read one page of that student's parent
//              links alongside the total in a single transaction.
//              The parent check comes first: without it an unknown student id
//              would return an empty list rather than 404, silently implying the
//              student exists with no parents on record.
//              StudentParent carries no tenantId; it is reachable only through
//              its student, so resolving the student is what establishes tenant
//              ownership of the links.
//              StudentParent has no timestamp column of any kind, so the
//              listing cannot order by its own createdAt. It orders by the
//              parent's createdAt to match every other collection in the
//              project, with parentId as a tiebreaker: without one, parents
//              created in the same instant would leave offset pagination free to
//              repeat or skip rows.
//              Each row carries the parent's columns plus isPrimary, which lives
//              on the join rather than on Parent — the same flattening applied
//              to a user's roles in /api/users/[id].
// RESPONSE   : { success: true, data: { parents, pagination } }
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

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsedParams = studentIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParams.error),
        },
        { status: 400 }
      );
    }

    const parsedQuery = listStudentParentsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedQuery.error),
        },
        { status: 400 }
      );
    }

    const studentId = parsedParams.data.id;

    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!student) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    const { page, limit } = parsedQuery.data;
    const where = { studentId };

    // Paired in one transaction so the total cannot shift between the two reads.
    const [links, total] = await prisma.$transaction([
      prisma.studentParent.findMany({
        where,
        orderBy: [{ parent: { createdAt: "desc" } }, { parentId: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          isPrimary: true,
          parent: { select: PARENT_SELECT },
        },
      }),
      prisma.studentParent.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        parents: links.map((link) => ({ ...link.parent, isPrimary: link.isPrimary })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/students/[id]/parents]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : studentIdParamSchema for the [id] segment, linkParentSchema for
//              the body. parentId is required and isPrimary optional.
//              studentId is absent from the body schema, so a request supplying
//              one has it stripped: the route parameter alone decides which
//              student is linked. Without that, a body-supplied studentId could
//              attach a parent to a different student — and no foreign key would
//              object, because the referenced student genuinely exists.
// FLOW       : Authorise → resolve tenant → parse body → verify student
//              ownership, parent ownership and the absence of an existing link
//              as three independent reads issued together → apply the results in
//              a fixed precedence → create the link.
//              Both ownership checks are scoped by tenantId, so a student or
//              parent owned by another tenant is reported as NOT_FOUND exactly
//              like a nonexistent one.
//              The parent check is not optional and is not defence in depth.
//              Parent has no foreign key in the schema at all — not even on
//              tenantId — so nothing in the database associates a parent with a
//              university. This lookup is the only thing preventing a caller
//              from linking another tenant's parent to their own student.
//              StudentParent's identity is the composite primary key
//              @@id([studentId, parentId]), which is what makes the duplicate
//              case a real database constraint rather than a check that can be
//              raced past.
// RESPONSE   : { success: true, data: <StudentParent & { parent }>,
//                message: "Parent linked" }
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

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const { tenant } = tenantGuard;

    const parsedParams = studentIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParams.error),
        },
        { status: 400 }
      );
    }

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = linkParentSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedBody.error),
        },
        { status: 400 }
      );
    }

    const studentId = parsedParams.data.id;
    const { parentId, isPrimary } = parsedBody.data;

    // Three independent reads, so they are issued together rather than in
    // sequence.
    const [student, parent, existing] = await Promise.all([
      prisma.student.findFirst({
        where: { id: studentId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.parent.findFirst({
        where: { id: parentId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.studentParent.findUnique({
        where: { studentId_parentId: { studentId, parentId } },
        select: { studentId: true },
      }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: invalid references before the duplicate, and the student
    // before the parent since the student is the one addressed by the URL.
    if (!student) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    if (!parent) {
      return NextResponse.json(fail("Parent not found", "NOT_FOUND"), { status: 404 });
    }

    if (existing) {
      return NextResponse.json(
        fail("Parent is already linked to this student", "CONFLICT"),
        { status: 409 }
      );
    }

    // Single write — already atomic, so no transaction is warranted. studentId
    // comes from the route, never from the request body.
    const link = await prisma.studentParent.create({
      data: {
        studentId,
        parentId,
        isPrimary,
      },
      select: {
        studentId: true,
        parentId: true,
        isPrimary: true,
        parent: { select: PARENT_SELECT },
      },
    });

    return NextResponse.json(ok(link, "Parent linked"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request created the same link between the check and the
      // insert. The composite primary key makes this race-safe: the database
      // refuses the duplicate itself rather than relying on the pre-check.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Parent is already linked to this student", "CONFLICT"),
          { status: 409 }
        );
      }
      // The student or parent was deleted between its check and the insert, so
      // the foreign key rejected the reference. Which of the two it was is not
      // reliably recoverable from the error, so both are reported together.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced student or parent not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[POST /api/students/[id]/parents]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
