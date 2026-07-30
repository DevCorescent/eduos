// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty — Faculty Course Assignments
// FLOW   : Guard → tenant → param → body → parallel ownership checks →
//          duplicate check → create → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: List and create course assignments for a faculty member within the
//          authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import {
  createFacultyAssignmentSchema,
  facultyAssignmentQuerySchema,
  facultyIdParamSchema,
} from "@/lib/validations/faculty";
import { ok, fail } from "@/types";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for an assignment. Declared once so both handlers answer with
 * the same shape.
 *
 * No relation is expanded: the course, section and semester are referenced by id
 * rather than joined, so a page of assignments costs one query.
 */
const ASSIGNMENT_SELECT = {
  id: true,
  tenantId: true,
  facultyId: true,
  courseId: true,
  sectionId: true,
  semesterId: true,
  isActive: true,
  createdAt: true,
} as const;

// FacultyCourseAssignment holds no BigInt, Decimal or Json column, so the shared
// serialize() helper is not applied here. Note it carries createdAt but no
// updatedAt.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : facultyIdParamSchema for the [id] segment,
//              facultyAssignmentQuerySchema for ?page and ?limit.
// FLOW       : Authorise → resolve tenant → confirm the faculty member belongs to
//              this tenant (404 otherwise) → read one page of that member's
//              assignments alongside the total in a single transaction.
//              The parent check comes first: without it an unknown faculty id
//              would return an empty list rather than 404, silently implying the
//              member exists with nothing assigned.
//              Both queries are filtered by tenantId as well as facultyId. The
//              parent check already proves the member belongs to this tenant, so
//              the tenant filter is defence in depth rather than the primary
//              guarantee.
//              Ordering is by createdAt with an id tiebreaker: assignments
//              created in the same batch share a timestamp, and without the
//              tiebreaker offset pagination could repeat or skip rows.
// RESPONSE   : { success: true, data: { assignments, pagination } }
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
    const parsedParams = facultyIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedQuery = facultyAssignmentQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const facultyId = parsedParams.data.id;

    const faculty = await prisma.facultyMember.findFirst({
      where: { id: facultyId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!faculty) {
      return NextResponse.json(fail("Faculty member not found", "NOT_FOUND"), { status: 404 });
    }

    const { page, limit } = parsedQuery.data;
    const where = { tenantId: tenant.id, facultyId };

    // Paired in one transaction so the total cannot shift between the two reads.
    const [assignments, total] = await prisma.$transaction([
      prisma.facultyCourseAssignment.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: ASSIGNMENT_SELECT,
      }),
      prisma.facultyCourseAssignment.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        assignments,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/faculty/[id]/assignments]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : facultyIdParamSchema for the [id] segment,
//              createFacultyAssignmentSchema for the body. courseId required;
//              sectionId, semesterId and isActive optional. Neither facultyId nor
//              tenantId is accepted from the client — the first comes from the
//              route, the second from the resolved tenant.
// FLOW       : Authorise → resolve tenant → parse body → verify faculty, course,
//              section and semester ownership plus the duplicate check as five
//              independent reads issued together → apply the results in a fixed
//              precedence → create.
//
//              Every reference is verified against this tenant. facultyId and
//              courseId carry foreign keys, so the database would confirm those
//              rows exist — but a foreign key says nothing about ownership.
//              sectionId and semesterId have neither a relation nor a foreign key
//              in the schema, so for those two the lookup here is the only check
//              that exists anywhere: the column would otherwise accept any string
//              at all, including another tenant's id.
//
//              Duplicate prevention is required by the schema, not invented:
//              @@unique([facultyId, courseId, sectionId, semesterId]). The
//              pre-check matches nulls explicitly, because an omitted section or
//              semester is stored as NULL and must compare equal to an existing
//              NULL for the duplicate to be caught.
// RESPONSE   : { success: true, data: <FacultyCourseAssignment>,
//                message: "Assignment created" }
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

    const parsedParams = facultyIdParamSchema.safeParse(await params);
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

    const parsedBody = createFacultyAssignmentSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const facultyId = parsedParams.data.id;
    const input = parsedBody.data;

    // Normalised once so the duplicate lookup and the insert agree on what an
    // omitted optional reference means: NULL, not absent.
    const sectionId = input.sectionId ?? null;
    const semesterId = input.semesterId ?? null;

    // Five independent reads, so they are issued together rather than in
    // sequence. Each optional reference is skipped entirely when its id was not
    // supplied, so an omitted field costs no query.
    const [faculty, course, section, semester, duplicate] = await Promise.all([
      prisma.facultyMember.findFirst({
        where: { id: facultyId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.course.findFirst({
        where: { id: input.courseId, tenantId: tenant.id },
        select: { id: true },
      }),
      sectionId === null
        ? Promise.resolve(null)
        : prisma.section.findFirst({
            where: { id: sectionId, tenantId: tenant.id },
            select: { id: true },
          }),
      semesterId === null
        ? Promise.resolve(null)
        : prisma.semester.findFirst({
            where: { id: semesterId, tenantId: tenant.id },
            select: { id: true },
          }),
      // findFirst rather than findUnique on the composite key: two of its four
      // columns are nullable, and equality against NULL is expressed as IS NULL,
      // which findFirst handles and a unique lookup does not.
      prisma.facultyCourseAssignment.findFirst({
        where: { facultyId, courseId: input.courseId, sectionId, semesterId },
        select: { id: true },
      }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: invalid references before the constraint clash, and the
    // faculty member before the rest since it is the one addressed by the URL.
    if (!faculty) {
      return NextResponse.json(fail("Faculty member not found", "NOT_FOUND"), { status: 404 });
    }

    if (!course) {
      return NextResponse.json(fail("Course not found", "NOT_FOUND"), { status: 404 });
    }

    if (sectionId !== null && !section) {
      return NextResponse.json(fail("Section not found", "NOT_FOUND"), { status: 404 });
    }

    if (semesterId !== null && !semester) {
      return NextResponse.json(fail("Semester not found", "NOT_FOUND"), { status: 404 });
    }

    if (duplicate) {
      return NextResponse.json(
        fail("Assignment already exists for this faculty member", "CONFLICT"),
        { status: 409 }
      );
    }

    // Single write — already atomic, so no transaction is warranted. facultyId
    // comes from the route and tenantId from the resolved tenant, never from the
    // request body.
    const assignment = await prisma.facultyCourseAssignment.create({
      data: {
        courseId: input.courseId,
        isActive: input.isActive,
        sectionId,
        semesterId,
        facultyId,
        tenantId: tenant.id,
      },
      select: ASSIGNMENT_SELECT,
    });

    return NextResponse.json(ok(assignment, "Assignment created"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request created the same assignment between the check and
      // the insert. Note this backstop only engages when both sectionId and
      // semesterId are non-null: the unique index spans two nullable columns, and
      // Postgres treats NULLs as distinct, so rows with either omitted are not
      // constrained by it and the pre-check above stands alone.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Assignment already exists for this faculty member", "CONFLICT"),
          { status: 409 }
        );
      }
      // The faculty member or course was deleted between its check and the
      // insert, so the foreign key rejected the reference. sectionId and
      // semesterId cannot appear here: they have no foreign key, so a section or
      // semester deleted in that window leaves a dangling id rather than raising.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced faculty member or course not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[POST /api/faculty/[id]/assignments]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
