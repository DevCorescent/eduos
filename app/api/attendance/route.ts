// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance — Attendance Collection
// FLOW   : Guard → tenant → query/body → tenant-scoped reference checks on every
//          distinct id in the batch → duplicate check → atomic bulk insert →
//          response.
// ACCESS : FACULTY · UNIVERSITY_ADMIN
//          A student reading their own attendance is a different endpoint and is
//          not reachable here; PARENT is not implemented anywhere yet.
// BACKEND: Prisma
// PURPOSE: List the authenticated tenant's attendance and mark attendance in
//          bulk.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { createAttendanceSchema } from "@/lib/validations/attendance";
import { ok, fail } from "@/types";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for an attendance record. Declared once so both handlers
 * answer with the same shape.
 *
 * No relation is expanded, matching every other collection route in the project.
 * Attendance carries three real relations — student, section and faculty — so
 * those joins are possible and are simply not taken. courseId has no relation to
 * expand even if one were wanted: Attendance declares no course relation at all,
 * so the column is a bare string here, the same situation as
 * Course.departmentId.
 *
 * Attendance has no createdAt or updatedAt column — the only model in the project
 * so far with neither — so markedAt is the only timestamp there is to report.
 */
const ATTENDANCE_SELECT = {
  id: true,
  tenantId: true,
  studentId: true,
  facultyId: true,
  sectionId: true,
  courseId: true,
  date: true,
  status: true,
  sessionType: true,
  remarks: true,
  markedAt: true,
  markedBy: true,
} as const;

// Attendance holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here. date and markedAt are DateTime values carrying
// their own toJSON.

/**
 * Reduce a date to the UTC day it names.
 *
 * Attendance.date is @db.Date, so PostgreSQL stores the day and discards any
 * time component. Normalising here makes the application's view of the value
 * match what is actually stored, which the duplicate check below depends on: a
 * record submitted as 09:30 and one submitted as 14:00 on the same day are the
 * same row to the database, and a comparison that kept the time would miss that.
 * The value written is unchanged in effect — the column truncates it either way.
 */
function toDateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

// GET
// ACCESS     : FACULTY · UNIVERSITY_ADMIN
// VALIDATION : paginationQuerySchema — ?page (default 1) and ?limit (default 20,
//              max 100). The shared contract is consumed directly rather than
//              through a module-local alias, exactly as in the timetable routes:
//              lib/validations/attendance.ts declares no query alias.
//
//              No filter parameter is read. The README names student, section and
//              date as the dimensions this endpoint answers on, but defines no
//              parameter contract for them — whether date is a single day or a
//              range, and whether any filter is required, are undecided. That
//              question is deliberately left open rather than settled by
//              implication here, so a supplied ?studentId is ignored rather than
//              honoured or rejected. Until it is settled this endpoint returns the
//              tenant's attendance unfiltered, which is a wider read than the
//              README describes.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              records alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable. No narrowing by faculty is applied: the approved
//              decisions grant FACULTY and UNIVERSITY_ADMIN the same read scope,
//              so a faculty member sees the tenant's attendance rather than only
//              the rows they marked.
//
//              Ordering is by date, then id. Most recent day first, matching the
//              descending direction every other collection route uses, with date
//              standing in for the createdAt those routes sort on — Attendance has
//              no createdAt column. markedAt is not used as the sort key: it
//              records when a mark was entered rather than which day it describes,
//              so a backfilled register would sort ahead of the day it covers. The
//              id tiebreaker is what makes the page boundaries deterministic,
//              since a single day carries many records that agree on date.
// RESPONSE   : { success: true, data: { attendance, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("FACULTY", "UNIVERSITY_ADMIN");
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
    const [attendance, total] = await prisma.$transaction([
      prisma.attendance.findMany({
        where,
        orderBy: [{ date: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: ATTENDANCE_SELECT,
      }),
      prisma.attendance.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        attendance,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/attendance]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : FACULTY · UNIVERSITY_ADMIN
// VALIDATION : createAttendanceSchema — { records: [...] } with at least one
//              record. Per record, studentId and date are required; facultyId,
//              sectionId, courseId, status, sessionType and remarks are optional.
//              id, tenantId, markedAt and markedBy are absent from the schema and
//              so are stripped from any body that supplies them.
// FLOW       : Authorise → resolve tenant → parse body → verify every distinct
//              referenced id against this tenant → reject collisions → insert the
//              whole batch in one statement.
//
//              References are resolved as sets, not per record: the distinct ids
//              of each kind are gathered across the batch and checked with one
//              query apiece, filtered by id AND tenantId. That is the same
//              predicate the project's per-row findFirst lookups apply, issued
//              once per kind instead of once per record, so a hundred-row register
//              costs four reads rather than four hundred. Ownership is still
//              proven for every id individually — a set is accepted only if every
//              member of it came back.
//
//              Every reference is verified against this tenant, not merely for
//              existence. studentId, sectionId and facultyId carry real foreign
//              keys, but a foreign key proves existence rather than ownership, so
//              a student, section or faculty member belonging to another tenant
//              would satisfy the database while breaking isolation. courseId is
//              worse: Attendance declares no course relation at all, so the column
//              has no foreign key and would otherwise accept any string,
//              including another tenant's course id — its tenant-scoped lookup is
//              the only protection it has anywhere. Attendance.tenantId carries no
//              foreign key either. An unknown id and one owned by another tenant
//              return the identical 404 for each kind, so no id is ever confirmed
//              to exist elsewhere.
//
//              No semester is validated because there is nothing to validate:
//              Attendance has no semesterId column.
//
//              markedBy is set from the authenticated session and never read from
//              the body, so a mark cannot be attributed to another user. markedAt
//              is left to the schema default, so it is the server clock.
// RESPONSE   : { success: true, data: { count }, message: "Attendance marked" }
//
//              The created rows are not echoed. createMany does not return them,
//              and they cannot be read back reliably afterwards: a record with no
//              courseId is not uniquely identifiable by any key the model
//              exposes, so a follow-up query could not distinguish this batch's
//              rows from an identical earlier one. The count is what can be
//              stated truthfully.
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("FACULTY", "UNIVERSITY_ADMIN");
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

    const parsed = createAttendanceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    // Dates are reduced to the day they name up front, so the duplicate check
    // below compares on the same granularity the @db.Date column stores.
    const records = parsed.data.records.map((record) => ({
      ...record,
      date: toDateOnly(record.date),
    }));

    const distinct = (values: Array<string | undefined>) =>
      [...new Set(values.filter((value): value is string => value !== undefined))];

    const studentIds = distinct(records.map((r) => r.studentId));
    const facultyIds = distinct(records.map((r) => r.facultyId));
    const sectionIds = distinct(records.map((r) => r.sectionId));
    const courseIds = distinct(records.map((r) => r.courseId));

    // Four independent reads, so they are issued together rather than in
    // sequence. Each is scoped to this tenant. The optional kinds are skipped
    // entirely when the batch names none of them.
    const [students, faculty, sections, courses] = await Promise.all([
      prisma.student.findMany({
        where: { id: { in: studentIds }, tenantId: tenant.id },
        select: { id: true },
      }),
      facultyIds.length === 0
        ? Promise.resolve([])
        : prisma.facultyMember.findMany({
            where: { id: { in: facultyIds }, tenantId: tenant.id },
            select: { id: true },
          }),
      sectionIds.length === 0
        ? Promise.resolve([])
        : prisma.section.findMany({
            where: { id: { in: sectionIds }, tenantId: tenant.id },
            select: { id: true },
          }),
      courseIds.length === 0
        ? Promise.resolve([])
        : prisma.course.findMany({
            where: { id: { in: courseIds }, tenantId: tenant.id },
            select: { id: true },
          }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first. The order follows the schema's column order, so a batch
    // with several bad references always reports the same one.
    if (students.length !== studentIds.length) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    if (faculty.length !== facultyIds.length) {
      return NextResponse.json(fail("Faculty member not found", "NOT_FOUND"), { status: 404 });
    }

    if (sections.length !== sectionIds.length) {
      return NextResponse.json(fail("Section not found", "NOT_FOUND"), { status: 404 });
    }

    if (courses.length !== courseIds.length) {
      return NextResponse.json(fail("Course not found", "NOT_FOUND"), { status: 404 });
    }

    // @@unique([studentId, courseId, date, sessionType]) is the constraint the
    // batch can collide with — against a row already stored, or against another
    // record in the same batch.
    //
    // Only records that name a course are checked, because only those are
    // constrained. PostgreSQL treats NULL as distinct within a unique index, so
    // a record with no courseId cannot collide with anything: the database will
    // accept two byte-identical such rows, and rejecting them here would enforce
    // a rule the schema does not have. That gap is real and is recorded rather
    // than papered over — it is the same NULL-in-a-unique-index shape already
    // documented as TD-001 for FacultyCourseAssignment.
    const constrained = records.filter((record) => record.courseId !== undefined);

    const keyOf = (record: (typeof constrained)[number]) =>
      [
        record.studentId,
        record.courseId,
        record.date.toISOString(),
        record.sessionType ?? "LECTURE",
      ].join(" ");

    const seen = new Set<string>();
    for (const record of constrained) {
      const key = keyOf(record);
      if (seen.has(key)) {
        return NextResponse.json(
          fail("Attendance already marked for one or more records", "CONFLICT"),
          { status: 409 }
        );
      }
      seen.add(key);
    }

    if (constrained.length > 0) {
      // One read for the whole batch rather than one per record. Scoped to this
      // tenant as well as the constraint columns: the index itself is not
      // tenant-scoped, so without this a collision could be reported against a
      // row the caller cannot see.
      const existing = await prisma.attendance.findMany({
        where: {
          tenantId: tenant.id,
          OR: constrained.map((record) => ({
            studentId: record.studentId,
            courseId: record.courseId,
            date: record.date,
            sessionType: record.sessionType ?? "LECTURE",
          })),
        },
        select: { id: true },
      });

      if (existing.length > 0) {
        return NextResponse.json(
          fail("Attendance already marked for one or more records", "CONFLICT"),
          { status: 409 }
        );
      }
    }

    // A single statement, so the batch is atomic on its own and no transaction is
    // warranted: either every record is written or none is. tenantId comes from
    // the resolved tenant context and markedBy from the authenticated session,
    // never from the request body. markedAt is left to the schema default.
    const created = await prisma.attendance.createMany({
      data: records.map((record) => ({
        ...record,
        tenantId: tenant.id,
        markedBy: session.sub,
      })),
    });

    return NextResponse.json(ok({ count: created.count }, "Attendance marked"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took one of the keys between the pre-check and the
      // insert. The batch is one statement, so nothing was written.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Attendance already marked for one or more records", "CONFLICT"),
          { status: 409 }
        );
      }

      // A referenced student, section or faculty member was deleted between its
      // check and the insert, so the foreign key rejected the reference. Which one
      // it was is not recoverable from the error, so they are reported together.
      // courseId cannot reach this branch — it carries no foreign key.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced student, section or faculty member not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[POST /api/attendance]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
