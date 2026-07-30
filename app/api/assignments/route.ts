// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessments — Assignment Collection
// FLOW   : Guard → tenant → query/body → tenant-scoped reference checks →
//          list/create → response.
// ACCESS : GET  — UNIVERSITY_ADMIN · FACULTY · STUDENT
//          POST — UNIVERSITY_ADMIN · FACULTY
//          PARENT is not implemented anywhere yet.
// BACKEND: Prisma
// PURPOSE: List the authenticated tenant's assignments and create new ones.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { createAssignmentSchema } from "@/lib/validations/assignment";
import { ok, fail } from "@/types";

/**
 * Columns returned for an assignment. Declared once so both handlers answer with
 * the same shape.
 *
 * No relation is expanded, matching every other collection route in the project.
 * Assignment carries a real course relation, so that join is possible and is
 * simply not taken; sectionId has no relation to expand even if one were wanted,
 * because Assignment declares no section relation at all — the same situation as
 * Course.departmentId and Attendance.courseId.
 *
 * createdBy is reported but not resolved. It carries no foreign key and its
 * target model is not declared in the schema, so there is nothing to join
 * against; the value written is the authenticated User id.
 *
 * attachments is a Json column and is returned exactly as stored.
 */
const ASSIGNMENT_SELECT = {
  id: true,
  tenantId: true,
  courseId: true,
  sectionId: true,
  createdBy: true,
  title: true,
  description: true,
  type: true,
  status: true,
  maxMarks: true,
  dueDate: true,
  publishedAt: true,
  attachments: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Assignment holds no BigInt or Decimal column, so the shared serialize() helper
// is not applied here. attachments is Json and serialises as itself; the
// DateTime columns carry their own toJSON.

// GET
// ACCESS     : UNIVERSITY_ADMIN · FACULTY · STUDENT, with different scope.
//
//              Role precedence is UNIVERSITY_ADMIN > FACULTY > STUDENT, so the
//              elevated pair is tested first and a caller holding either reads
//              the tenant's assignments in full, DRAFT included. Only a caller
//              who holds neither falls through to the STUDENT branch.
//
//              A STUDENT sees published assignments only — those whose
//              publishedAt is set. publishedAt IS NOT NULL is the approved
//              visibility predicate for this phase, the same one the shipped
//              transcript applies to ExamResult, and a DRAFT assignment is by
//              definition not yet visible to the people it will be set for.
//              No narrower scoping than that is applied: an assignment is
//              reachable from a student through courseId and a nullable
//              sectionId, and the schema models no enrolment link from a Student
//              to a Course, so "this student's assignments" is not derivable
//              without inventing one.
//
//              Scope is decided by asking requireRole twice rather than by
//              reading session.roles. The roles embedded in the token are a
//              snapshot from sign-in; requireRole resolves them live against
//              UserRole on every request precisely so a revoked role takes effect
//              immediately. The elevated check runs first, so the common path
//              costs one guard call and only a student pays for a second. An
//              anonymous caller fails both and receives requireAuth's 401 from
//              the second, so the fallback cannot turn a 401 into a 403.
// VALIDATION : paginationQuerySchema — ?page (default 1) and ?limit (default 20,
//              max 100). The shared contract is consumed directly rather than
//              through a module-local alias, exactly as in the timetable and
//              attendance routes; lib/validations/assignment.ts declares no query
//              alias. No filter parameter is defined for this phase, so a
//              supplied ?courseId or ?status is ignored rather than honoured.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              assignments alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable. The student branch adds the publishedAt predicate to
//              both, so the total can never describe a wider set than the page.
//
//              Ordering is by createdAt then id, both descending — newest first,
//              matching every other collection route in the project. It is
//              required for correctness rather than presentation: offset
//              pagination over an unordered result can repeat or skip rows across
//              pages. The id tiebreaker matters because assignments created in
//              the same batch can share a createdAt timestamp, leaving createdAt
//              alone non-deterministic.
// RESPONSE   : { success: true, data: { assignments, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    // Precedence: the elevated pair is tested first, so a caller holding either
    // never reaches the student branch.
    const elevatedGuard = await requireRole("UNIVERSITY_ADMIN", "FACULTY");

    let isElevated: boolean;

    if (elevatedGuard.authorized) {
      isElevated = true;
    } else {
      // Not elevated — the caller may still be a student. An anonymous caller
      // fails this too and receives requireAuth's 401, so the fallback cannot
      // downgrade a 401 into a 403.
      const studentGuard = await requireRole("STUDENT");
      if (!studentGuard.authorized) return studentGuard.response;

      isElevated = false;
    }

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = paginationQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const { page, limit } = parsed.data;

    // The published predicate is applied to the count as well as the page, so a
    // student is never told a wider total than they can read.
    const where = isElevated
      ? { tenantId: tenant.id }
      : { tenantId: tenant.id, publishedAt: { not: null } };

    // Paired in one transaction so the total cannot shift between the two reads.
    const [assignments, total] = await prisma.$transaction([
      prisma.assignment.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: ASSIGNMENT_SELECT,
      }),
      prisma.assignment.count({ where }),
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
    console.error("[GET /api/assignments]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN · FACULTY. A caller holding only STUDENT is
//              rejected by the guard with 403 — students read assignments but do
//              not create them.
// VALIDATION : createAssignmentSchema — courseId and title required; sectionId,
//              description, type, maxMarks, dueDate and attachments optional.
//              maxMarks must be a positive integer. id, tenantId, createdBy,
//              status, publishedAt, createdAt and updatedAt are absent from the
//              schema and so are stripped from any body that supplies them.
// FLOW       : Authorise → resolve tenant → parse body → run both reference
//              lookups together → apply them in a fixed precedence → create.
//
//              Both references are verified against this tenant, not merely for
//              existence. courseId carries a real foreign key with ON DELETE
//              RESTRICT, but a foreign key proves existence rather than
//              ownership, so a course belonging to another tenant would satisfy
//              the database while breaking isolation. sectionId is weaker still:
//              Assignment declares no section relation and the migration emits no
//              foreign key for it, so the column would otherwise accept any
//              string — its tenant-scoped lookup is the only protection it has
//              anywhere. Assignment.tenantId carries no foreign key either. An
//              unknown id and one owned by another tenant return the identical
//              404 for each reference, so no id is ever confirmed to exist
//              elsewhere.
//
//              The section lookup is skipped entirely when no sectionId was
//              supplied, since the column is nullable.
//
//              No duplicate check of any kind is performed. Assignment declares
//              no unique constraint in the schema — not one — so two
//              byte-identical assignments on the same course are permitted, and
//              rejecting them would mean inventing a rule the schema does not
//              express. This mirrors Timetable, the project's other model with no
//              unique constraint.
// RESPONSE   : { success: true, data: <Assignment>,
//                message: "Assignment created" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              No 409 is reachable and none is handled: Assignment has no unique
//              constraint on any column or combination, so a unique violation
//              cannot occur here. A foreign-key branch is reachable and is
//              handled: the referenced course disappearing between its check and
//              the insert makes the write fail. sectionId cannot reach that
//              branch — it carries no foreign key, so a section deleted in the
//              same window leaves a dangling id rather than raising anything.
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN", "FACULTY");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { session, tenant } = tenantGuard;

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = createAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const { attachments, ...scalars } = parsed.data;

    // Two independent reads, so they are issued together rather than in
    // sequence. The section lookup is skipped entirely when no sectionId was
    // supplied, since the column is nullable.
    const [course, section] = await Promise.all([
      prisma.course.findFirst({
        where: { id: scalars.courseId, tenantId: tenant.id },
        select: { id: true },
      }),
      scalars.sectionId === undefined
        ? Promise.resolve(null)
        : prisma.section.findFirst({
            where: { id: scalars.sectionId, tenantId: tenant.id },
            select: { id: true },
          }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first. The order follows the schema's column order, so a body with
    // both references bad always reports the same one.
    if (!course) {
      return NextResponse.json(fail("Course not found", "NOT_FOUND"), { status: 404 });
    }

    if (scalars.sectionId !== undefined && !section) {
      return NextResponse.json(fail("Section not found", "NOT_FOUND"), { status: 404 });
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context and createdBy from the
    // authenticated session, never from the request body. status and publishedAt
    // are left absent so the schema defaults apply: a new assignment is always
    // DRAFT with a null publishedAt, and the only transition into PUBLISHED is
    // POST /api/assignments/[id]/publish.
    //
    // The Json column is cast at this boundary because Zod infers an
    // unknown-valued record, which Prisma's InputJsonValue does not accept
    // directly — the same cast Campus.address requires.
    const assignment = await prisma.assignment.create({
      data: {
        ...scalars,
        attachments: attachments as Prisma.InputJsonValue | undefined,
        tenantId: tenant.id,
        createdBy: session.sub,
      },
      select: ASSIGNMENT_SELECT,
    });

    return NextResponse.json(ok(assignment, "Assignment created"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // The referenced course was deleted between its check and the insert, so
      // the foreign key rejected the reference.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(fail("Course not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[POST /api/assignments]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
