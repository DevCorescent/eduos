// ============================================================================
// OWNER  : Gauransh
// MODULE : Students — Student Collection
// FLOW   : Guard → tenant → query/body → parallel ownership and existence
//          checks → duplicate checks → create → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: List and enrol students within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { createStudentSchema, listStudentsQuerySchema } from "@/lib/validations/student";
import { ok, fail } from "@/types";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a student. Declared once so both handlers answer with
 * the same shape.
 *
 * Student carries no credential or otherwise sensitive column of its own, but
 * the select is explicit for the same reason it is everywhere else in this
 * project: it fixes the response contract rather than letting it track whatever
 * the model happens to contain. No relation is expanded — the linked User, and
 * therefore the student's name and email, is reached through
 * GET /api/students/[id] rather than being joined into every list row.
 */
const STUDENT_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  enrollmentNo: true,
  programmeId: true,
  batchId: true,
  sectionId: true,
  specialisationId: true,
  currentSemester: true,
  status: true,
  admissionDate: true,
  graduationDate: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Student holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : listStudentsQuerySchema — ?page (default 1) and ?limit (default
//              20, max 100), from the shared pagination contract. No search
//              parameter is defined: the project implements none on any
//              existing collection endpoint.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              students alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable.
// RESPONSE   : { success: true, data: { students, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = listStudentsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const { page, limit } = parsed.data;
    const where = { tenantId: tenant.id };

    // Paired in one transaction so the total cannot shift between the two
    // reads. The ordering is required for correctness, not presentation:
    // offset pagination over an unordered result can repeat or skip rows, and
    // the id tiebreaker matters because students admitted in the same batch can
    // share a createdAt timestamp, leaving createdAt alone non-deterministic.
    const [students, total] = await prisma.$transaction([
      prisma.student.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: STUDENT_SELECT,
      }),
      prisma.student.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        students,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/students]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createStudentSchema — userId, enrollmentNo and admissionDate
//              required; the rest optional. tenantId, id, createdAt and
//              updatedAt are absent from the schema and so are stripped from
//              any body that supplies them.
// FLOW       : Authorise → resolve tenant → parse body → run seven independent
//              lookups together → apply them in a fixed precedence → create.
//
//              Every reference is verified against this tenant, not merely for
//              existence. The database's foreign keys cannot do that: they
//              confirm only that a row exists, so without these checks a caller
//              could enrol a student against another university's batch,
//              section or specialisation.
//
//              programmeId is the case that matters most. Student.programmeId
//              carries no relation and no foreign key in the schema — it is a
//              bare String column — so the database will accept any value at
//              all, including another tenant's programme id or arbitrary text.
//              For every other reference the lookup here is defence in depth
//              over a constraint; for this one it is the only check that exists
//              anywhere, on create and on update alike.
//
//              Two uniqueness rules apply: Student.userId is @unique globally,
//              so a user may hold at most one student record, and
//              @@unique([tenantId, enrollmentNo]) makes an enrolment number
//              unique within the tenant while allowing the same number under a
//              different tenant.
// RESPONSE   : { success: true, data: <Student>, message: "Student created" }
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

    const parsed = createStudentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const input = parsed.data;

    // Seven independent reads, so they are issued together rather than in
    // sequence. Each optional reference is skipped entirely when its id was not
    // supplied, so an omitted field costs no query.
    const [
      user,
      studentForUser,
      duplicateEnrollment,
      programme,
      batch,
      section,
      specialisation,
    ] = await Promise.all([
      prisma.user.findFirst({
        where: { id: input.userId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.student.findUnique({
        where: { userId: input.userId },
        select: { id: true },
      }),
      prisma.student.findUnique({
        where: {
          tenantId_enrollmentNo: { tenantId: tenant.id, enrollmentNo: input.enrollmentNo },
        },
        select: { id: true },
      }),
      input.programmeId === undefined
        ? Promise.resolve(null)
        : prisma.programme.findFirst({
            where: { id: input.programmeId, tenantId: tenant.id },
            select: { id: true },
          }),
      input.batchId === undefined
        ? Promise.resolve(null)
        : prisma.batch.findFirst({
            where: { id: input.batchId, tenantId: tenant.id },
            select: { id: true },
          }),
      input.sectionId === undefined
        ? Promise.resolve(null)
        : prisma.section.findFirst({
            where: { id: input.sectionId, tenantId: tenant.id },
            select: { id: true },
          }),
      input.specialisationId === undefined
        ? Promise.resolve(null)
        : prisma.specialisation.findFirst({
            where: { id: input.specialisationId, tenantId: tenant.id },
            select: { id: true },
          }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: invalid references before constraint clashes, and the
    // user before the academic references since it is the student's identity.
    if (!user) {
      return NextResponse.json(fail("User not found", "NOT_FOUND"), { status: 404 });
    }

    if (input.programmeId !== undefined && !programme) {
      return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
    }

    if (input.batchId !== undefined && !batch) {
      return NextResponse.json(fail("Batch not found", "NOT_FOUND"), { status: 404 });
    }

    if (input.sectionId !== undefined && !section) {
      return NextResponse.json(fail("Section not found", "NOT_FOUND"), { status: 404 });
    }

    if (input.specialisationId !== undefined && !specialisation) {
      return NextResponse.json(fail("Specialisation not found", "NOT_FOUND"), { status: 404 });
    }

    if (studentForUser) {
      return NextResponse.json(
        fail("User is already linked to a student", "CONFLICT"),
        { status: 409 }
      );
    }

    if (duplicateEnrollment) {
      return NextResponse.json(
        fail("Enrollment number already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context, never from the request body.
    const student = await prisma.student.create({
      data: {
        ...input,
        tenantId: tenant.id,
      },
      select: STUDENT_SELECT,
    });

    return NextResponse.json(ok(student, "Student created"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the enrolment number or the user between the
      // checks and the insert. Which of the two unique constraints was violated
      // is not reliably recoverable from the error under the driver adapter, so
      // both are reported together rather than guessed at.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Enrollment number or user already in use", "CONFLICT"),
          { status: 409 }
        );
      }
      // The user, batch, section or specialisation was deleted between its
      // check and the insert, so the foreign key rejected the reference. Note
      // that programmeId cannot appear here: it has no foreign key, so a
      // programme deleted in that window leaves a dangling id rather than
      // raising anything.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced user, batch, section or specialisation not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[POST /api/students]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
