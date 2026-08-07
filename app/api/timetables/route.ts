// ============================================================================
// OWNER  : Gauransh
// MODULE : Timetable — Timetable Collection
// FLOW   : Guard → tenant → query/body → parallel ownership checks on all four
//          references → list/create → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: List the authenticated tenant's schedule and create timetable slots.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { createTimetableSchema } from "@/lib/validations/timetable";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";
// PHASE 27 event "Timetable Updated". Emitted after commit.
import {
  findFacultyUserIdsForUnit,
  findStudentUserIdsForCourse,
  notificationEmitter,
} from "@/lib/controllers/notificationEmitter.controller";

/**
 * Columns returned for a timetable entry. Declared once so both handlers answer
 * with the same shape.
 *
 * No relation is expanded. Timetable does carry four real relations — semester,
 * section, course and faculty — so unlike Course these joins are possible; they
 * are simply not taken here, matching every other collection route in the
 * project. The response carries the four ids and the client resolves names
 * through their own endpoints.
 *
 * Timetable has no updatedAt column, so createdAt is the only timestamp there is
 * to report.
 */
const TIMETABLE_SELECT = {
  id: true,
  tenantId: true,
  semesterId: true,
  sectionId: true,
  courseId: true,
  facultyId: true,
  day: true,
  startTime: true,
  endTime: true,
  roomNo: true,
  sessionType: true,
  isActive: true,
  createdAt: true,
} as const;

// Timetable holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here. startTime and endTime are plain strings and
// createdAt is a DateTime carrying its own toJSON.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : paginationQuerySchema — ?page (default 1) and ?limit (default 20,
//              max 100). The shared contract is consumed directly rather than
//              through a module-local alias: lib/validations/timetable.ts
//              declares no query schema, and this phase generates only this
//              route, so aliasing it there is not available. The contract is
//              identical either way — courseQuerySchema and its siblings are
//              plain re-exports of this same object, not extensions of it.
//
//              No search or filter parameter is defined: the project implements
//              none on any existing collection endpoint, and the README names
//              filter parameters for /api/attendance but not for
//              /api/timetables. In particular there is no ?day, ?sectionId or
//              ?isActive filter here — the section and faculty views are their
//              own routes, and inactive entries list alongside active ones with
//              the client reading the flag.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              entries alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable.
//
//              Ordering is by day, then start time, then id. It is required for
//              correctness rather than presentation: offset pagination over an
//              unordered result can repeat or skip rows across pages. day is a
//              Postgres enum, so ascending order follows the order the values are
//              declared in the schema — MONDAY first through SUNDAY — rather than
//              alphabetically. startTime sorts correctly as text precisely because
//              the validation layer requires zero-padded 24-hour HH:mm; a
//              variable-width format would place "9:00" after "10:00". The id
//              tiebreaker is what makes the page boundaries deterministic, and it
//              matters more here than elsewhere: Timetable declares no unique
//              constraint at all, so two slots may agree on every ordered column.
//              createdAt is not used as the sort key, unlike the other
//              collections — a schedule is read in schedule order, and the id
//              tiebreaker supplies the determinism createdAt would otherwise
//              provide.
// RESPONSE   : { success: true, data: { timetables, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = paginationQuerySchema.safeParse(
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
    const [timetables, total] = await prisma.$transaction([
      prisma.timetable.findMany({
        where,
        orderBy: [{ day: "asc" }, { startTime: "asc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: TIMETABLE_SELECT,
      }),
      prisma.timetable.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        timetables,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/timetables]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createTimetableSchema — semesterId, sectionId, courseId,
//              facultyId, day, startTime and endTime required; roomNo,
//              sessionType and isActive optional. Times must be strict 24-hour
//              HH:mm and endTime must be strictly greater than startTime.
//              tenantId, id and createdAt are absent from the schema and so are
//              stripped from any body that supplies them.
// FLOW       : Authorise → resolve tenant → parse body → run all four reference
//              lookups together → apply them in a fixed precedence → create.
//
//              Every reference is verified against this tenant, not merely for
//              existence. All four carry real foreign keys with ON DELETE
//              RESTRICT, but a foreign key proves existence rather than
//              ownership, so a semester, section, course or faculty member
//              belonging to another tenant would satisfy the database while
//              breaking isolation. Timetable.tenantId carries no foreign key at
//              all, so nothing in the schema ties an entry to the rows it points
//              at — these four lookups are the only thing that does. An unknown
//              id and one owned by another tenant return the identical 404 for
//              each reference, so no id is ever confirmed to exist elsewhere.
//
//              No collision check of any kind is performed, per the approved
//              Phase 9 decisions. Timetable declares no unique constraint in the
//              schema, so the same section may be booked for two courses at one
//              time, the same faculty member may appear in two places at once,
//              the same roomNo may be used twice, and byte-identical duplicate
//              rows are permitted. Rejecting any of those would mean inventing a
//              scheduling rule the schema does not express.
// RESPONSE   : { success: true, data: <Timetable>,
//                message: "Timetable entry created" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              No 409 is reachable and none is handled. Timetable has no unique
//              constraint on any column or combination, so a unique violation
//              cannot occur here — this is the only create endpoint in the
//              project with no conflict path. A foreign-key branch is reachable
//              and is handled: any of the four referenced rows disappearing
//              between its check and the insert makes the write fail, and which
//              one it was is not recoverable from the error, so they are reported
//              together.
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

    const parsed = createTimetableSchema.safeParse(body);
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
    // sequence. Each is scoped to this tenant.
    const [semester, section, course, faculty] = await Promise.all([
      prisma.semester.findFirst({
        where: { id: input.semesterId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.section.findFirst({
        where: { id: input.sectionId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.course.findFirst({
        where: { id: input.courseId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.facultyMember.findFirst({
        where: { id: input.facultyId, tenantId: tenant.id },
        select: { id: true },
      }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first. The order follows the schema's column order, so a body with
    // several bad references always reports the same one.
    if (!semester) {
      return NextResponse.json(fail("Semester not found", "NOT_FOUND"), { status: 404 });
    }

    if (!section) {
      return NextResponse.json(fail("Section not found", "NOT_FOUND"), { status: 404 });
    }

    if (!course) {
      return NextResponse.json(fail("Course not found", "NOT_FOUND"), { status: 404 });
    }

    if (!faculty) {
      return NextResponse.json(fail("Faculty member not found", "NOT_FOUND"), { status: 404 });
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context, never from the request body.
    const timetable = await prisma.timetable.create({
      data: {
        ...input,
        tenantId: tenant.id,
      },
      select: TIMETABLE_SELECT,
    });

        // PHASE 27 event "Timetable Updated" — listed under BOTH the student and
    // faculty audiences, so both are notified from one call.
    //
    // After the slot exists, throwing nothing.
    {
      const students = await findStudentUserIdsForCourse(
        tenant.id,
        timetable.courseId,
        timetable.sectionId
      );
      const faculty = await findFacultyUserIdsForUnit(
        tenant.id,
        timetable.courseId,
        timetable.sectionId
      );

      await notificationEmitter.timetableUpdated({
        tenantId: tenant.id,
        recipientUserIds: [...new Set([...students, ...faculty])],
        courseLabel: timetable.courseId,
        sectionLabel: timetable.sectionId,
      });
    }

    return NextResponse.json(ok(timetable, "Timetable entry created"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // One of the four referenced rows was deleted between its check and the
      // insert, so the foreign key rejected the reference. Which of the four it
      // was is not recoverable from the error, so they are reported together.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced semester, section, course or faculty member not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[POST /api/timetables]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
