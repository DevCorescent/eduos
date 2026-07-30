// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessments — Examination Collection
// FLOW   : Guard → tenant → query/body → tenant-scoped reference checks →
//          list/create → response.
// ACCESS : GET  — UNIVERSITY_ADMIN · FACULTY · STUDENT
//          POST — UNIVERSITY_ADMIN · FACULTY
//          PARENT is not implemented anywhere yet.
// BACKEND: Prisma
// PURPOSE: List the authenticated tenant's examinations and schedule new ones.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { createExaminationSchema } from "@/lib/validations/examination";
import { ok, fail } from "@/types";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for an examination. Declared once so both handlers answer
 * with the same shape.
 *
 * No relation is expanded, matching every other collection route in the project.
 * Examination carries real semester and course relations, so those joins are
 * possible and are simply not taken; the response carries the two ids and the
 * client resolves names through their own endpoints.
 *
 * status is reported but never written from a request body — it is server-managed
 * and left to the schema default on create.
 */
const EXAMINATION_SELECT = {
  id: true,
  tenantId: true,
  semesterId: true,
  courseId: true,
  title: true,
  type: true,
  status: true,
  date: true,
  startTime: true,
  endTime: true,
  venue: true,
  maxMarks: true,
  passMark: true,
  duration: true,
  instructions: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Examination holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here. startTime and endTime are plain strings and the
// DateTime columns carry their own toJSON.

// GET
// ACCESS     : UNIVERSITY_ADMIN · FACULTY · STUDENT, all with the same scope.
//
//              No two-tier logic exists here, unlike the assignment routes. An
//              examination has no publication concept — the model carries no
//              publishedAt column and nothing in the schema or the approved
//              decisions hides a scheduled examination from the students sitting
//              it — so all three roles read the tenant's examinations in full and
//              a single requireRole call decides access. ExamStatus is not used
//              as a visibility predicate either: it is descriptive and gates
//              nothing.
// VALIDATION : paginationQuerySchema — ?page (default 1) and ?limit (default 20,
//              max 100). The shared contract is consumed directly rather than
//              through a module-local alias, exactly as in the timetable,
//              attendance and assignment routes; lib/validations/examination.ts
//              declares no query alias. No filter parameter is defined for this
//              phase, so a supplied ?semesterId or ?courseId is ignored rather
//              than honoured or rejected.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              examinations alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable. Examination.tenantId carries no foreign key, so that
//              predicate is the only record of ownership the read has.
//
//              Ordering is by date then id, both descending — most recent first,
//              matching the descending direction every other collection route
//              uses. It is required for correctness rather than presentation:
//              offset pagination over an unordered result can repeat or skip rows
//              across pages.
//
//              Examination.date is nullable, and PostgreSQL sorts NULLs first
//              under DESC, so an examination whose date is not yet fixed appears
//              ahead of the scheduled ones. That is deterministic rather than
//              arbitrary, and no nulls-last override is applied because none is
//              specified anywhere. The id tiebreaker is what makes the page
//              boundaries fully deterministic: Examination declares no unique
//              constraint at all, so two examinations can agree on every other
//              column including date.
// RESPONSE   : { success: true, data: { examinations, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN", "FACULTY", "STUDENT");
    if (!guard.authorized) return guard.response;

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
    const where = { tenantId: tenant.id };

    // Paired in one transaction so the total cannot shift between the two reads.
    const [examinations, total] = await prisma.$transaction([
      prisma.examination.findMany({
        where,
        orderBy: [{ date: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: EXAMINATION_SELECT,
      }),
      prisma.examination.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        examinations,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/examinations]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN · FACULTY. A caller holding only STUDENT is
//              rejected by the guard with 403 — students read the examination
//              schedule but do not set it.
// VALIDATION : createExaminationSchema — semesterId, courseId, title and
//              maxMarks required; type, date, startTime, endTime, venue,
//              passMark, duration and instructions optional. Times are strict
//              24-hour HH:mm with endTime greater than startTime when both are
//              given, and passMark may not exceed maxMarks. id, tenantId, status,
//              createdAt and updatedAt are absent from the schema and so are
//              stripped from any body that supplies them.
// FLOW       : Authorise → resolve tenant → parse body → run both reference
//              lookups together → apply them in a fixed precedence → create.
//
//              Both references are verified against this tenant, not merely for
//              existence. semesterId and courseId carry real foreign keys with
//              ON DELETE RESTRICT, but a foreign key proves existence rather than
//              ownership, so a semester or course belonging to another tenant
//              would satisfy the database while breaking isolation.
//              Examination.tenantId carries no foreign key at all, so nothing in
//              the schema ties an examination to the rows it points at — these
//              two lookups are the only thing that does. An unknown id and one
//              owned by another tenant return the identical 404 for each
//              reference, so no id is ever confirmed to exist elsewhere.
//
//              No duplicate check and no clash detection of any kind is
//              performed. Examination declares no unique constraint in the schema
//              — not one — so two identical examinations for the same course and
//              semester are permitted, the same venue may be booked twice, and a
//              student may be scheduled for two examinations at one time.
//              Rejecting any of those would mean inventing a scheduling rule the
//              schema does not express, exactly as the approved Timetable
//              decisions declined to do.
//
//              status is left absent from the data so the schema default
//              SCHEDULED applies. It is server-managed: no request body can set
//              or advance it.
// RESPONSE   : { success: true, data: <Examination>,
//                message: "Examination scheduled" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              The 409 branch is present but currently unreachable: Examination
//              has no unique constraint on any column or combination, so Prisma
//              cannot raise P2002 here. It is handled rather than omitted so that
//              a genuine constraint violation would surface as a conflict rather
//              than a 500 if the schema ever gains one — and it is mapped only
//              from a real Prisma conflict, never from an application rule.
//
//              A foreign-key branch is reachable and is handled: either
//              referenced row disappearing between its check and the insert makes
//              the write fail, and which one it was is not recoverable from the
//              error, so they are reported together.
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN", "FACULTY");
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

    const parsed = createExaminationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const input = parsed.data;

    // Two independent reads, so they are issued together rather than in
    // sequence. Each is scoped to this tenant.
    const [semester, course] = await Promise.all([
      prisma.semester.findFirst({
        where: { id: input.semesterId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.course.findFirst({
        where: { id: input.courseId, tenantId: tenant.id },
        select: { id: true },
      }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first. The order follows the schema's column order, so a body with
    // both references bad always reports the same one.
    if (!semester) {
      return NextResponse.json(fail("Semester not found", "NOT_FOUND"), { status: 404 });
    }

    if (!course) {
      return NextResponse.json(fail("Course not found", "NOT_FOUND"), { status: 404 });
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context, never from the request body, and
    // status is left absent so the schema default SCHEDULED applies.
    const examination = await prisma.examination.create({
      data: {
        ...input,
        tenantId: tenant.id,
      },
      select: EXAMINATION_SELECT,
    });

    return NextResponse.json(ok(examination, "Examination scheduled"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Currently unreachable — Examination declares no unique constraint — but
      // mapped so a real constraint violation would never surface as a 500.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(fail("Examination already exists", "CONFLICT"), { status: 409 });
      }

      // The referenced semester or course was deleted between its check and the
      // insert, so the foreign key rejected the reference. Which of the two it
      // was is not recoverable from the error, so they are reported together.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced semester or course not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[POST /api/examinations]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
