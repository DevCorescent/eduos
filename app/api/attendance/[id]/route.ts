// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance — Attendance Detail
// FLOW   : Guard → tenant → param → tenant-scoped lookup → read / hard delete →
//          response.
// ACCESS : FACULTY · UNIVERSITY_ADMIN
//          A student reading their own attendance is a different endpoint and is
//          not reachable here; PARENT is not implemented anywhere yet.
// BACKEND: Prisma
// PURPOSE: View and permanently remove a single attendance record within the
//          authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isRecordNotFound } from "@/lib/utils/prisma-errors";
import { attendanceIdParamSchema } from "@/lib/validations/attendance";
import { ok, fail } from "@/types";

/**
 * Columns returned for an attendance record.
 *
 * The collection route declares the same shape. It is restated here rather than
 * imported because a Next.js route module may only export route handlers and
 * segment config, so this constant cannot be shared from there — the same reason
 * TIMETABLE_SELECT, COURSE_SELECT and FACULTY_SELECT are restated in their own
 * detail routes.
 *
 * No relation is expanded. Attendance carries three real relations — student,
 * section and faculty — so those joins are possible and are simply not taken.
 * courseId has no relation to expand even if one were wanted: Attendance declares
 * no course relation at all, so the column is a bare string here.
 *
 * Attendance has no createdAt or updatedAt column, so markedAt is the only
 * timestamp there is to report.
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
 * The single 404 both handlers answer with.
 *
 * Built here rather than inline so an unknown id, an id owned by another tenant
 * and an already-deleted id cannot drift apart: every miss produces the identical
 * status, code and message, byte for byte. That identity is the whole point — a
 * distinguishable response would confirm that a given id exists somewhere.
 */
function attendanceNotFound(): NextResponse {
  return NextResponse.json(fail("Attendance record not found", "NOT_FOUND"), { status: 404 });
}

// GET
// ACCESS     : FACULTY · UNIVERSITY_ADMIN
// VALIDATION : attendanceIdParamSchema — the [id] segment must be non-empty once
//              trimmed. Attendance.id is a cuid, not a UUID, so no UUID assertion
//              is applied; the value is an opaque key and an
//              unrecognised-but-well-formed one is a 404 rather than a 400.
//              No query parameters are read: this addresses a single resource, so
//              there is no collection to page through and no pagination contract
//              to validate. Any query string supplied is ignored rather than
//              rejected, matching every other detail route in the project.
// FLOW       : Authorise → resolve tenant → read the record filtered by BOTH id
//              and tenantId.
//
//              findFirst, never findUnique(id). The tenant filter is part of the
//              lookup itself rather than a check applied to a row already
//              fetched, so another tenant's record is never loaded, never
//              acknowledged and cannot leak through a mistake in a later branch.
//              This matters more for Attendance than for most models:
//              tenantId carries no foreign key here, so the column is the only
//              record of ownership and the query is the only thing enforcing it.
//
//              No narrowing by faculty is applied. The approved decisions grant
//              FACULTY and UNIVERSITY_ADMIN the same read scope, so a faculty
//              member may read any record in their tenant rather than only the
//              ones they marked — markedBy is reported, not enforced against.
//
//              An unknown id and an id owned by another tenant return the
//              identical 404, so no id is ever confirmed to exist elsewhere.
// RESPONSE   : { success: true, data: <Attendance> }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("FACULTY", "UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsed = attendanceIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    // findFirst rather than findUnique: the tenant filter is part of the lookup,
    // so another tenant's row can never be returned or even acknowledged.
    const attendance = await prisma.attendance.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
      select: ATTENDANCE_SELECT,
    });

    if (!attendance) {
      return attendanceNotFound();
    }

    return NextResponse.json(ok(attendance));
  } catch (err) {
    console.error("[GET /api/attendance/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// DELETE
// ACCESS     : FACULTY · UNIVERSITY_ADMIN
// VALIDATION : attendanceIdParamSchema — the [id] segment must be non-empty once
//              trimmed. No body is read: a delete carries no payload, and any body
//              sent is ignored rather than rejected.
// FLOW       : Authorise → resolve tenant → prove the record belongs to this
//              tenant (404 otherwise) → delete it scoped by id AND tenantId.
//
//              The lookup comes first and the delete never runs without it. The
//              write is then scoped by tenantId as well as id, so ownership is
//              asserted twice: once to decide the response, and again in the
//              statement that actually removes the row. Deleting by id alone would
//              reach any tenant's record, and Attendance.tenantId carries no
//              foreign key, so nothing outside this query would catch that.
//
//              An unknown id, an id owned by another tenant and an id already
//              deleted all return the identical 404 through attendanceNotFound(),
//              so a repeated delete is a 404 rather than a 200 and no id is ever
//              confirmed to exist elsewhere.
//
//              The removal is permanent, per the approved decisions. The schema
//              has no deletedAt column and no archive model for this data, so
//              there is nothing to soft-delete into and no restore path; the row
//              is gone, and with it the only record that the mark was ever made.
//              No cascade is performed in application code — the database owns
//              that entirely, and nothing in the schema is affected here:
//              Attendance is a leaf, holding foreign keys to Student, Section and
//              FacultyMember while nothing holds one to it. Removing a record
//              therefore touches no other row.
//
//              Deleting is the only write this endpoint offers. Correcting a
//              record is not implemented and no update semantics exist anywhere
//              for this model — see the note after this handler.
// RESPONSE   : { success: true, data: null, message: "Attendance record deleted" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              No conflict status is reachable and none is handled. Nothing in the
//              schema holds a foreign key to Attendance and it has no child
//              relations, so no dependent RESTRICT can refuse the delete — unlike
//              Campus, whose departments can. P2025 remains the race backstop: if
//              the row is removed between the lookup and the delete, that is
//              reported as the same 404 the lookup would have produced.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("FACULTY", "UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = attendanceIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const attendanceId = parsed.data.id;

    // Ownership is proven before anything is removed. A foreign or unknown id
    // stops here and no write is issued at all.
    const existing = await prisma.attendance.findFirst({
      where: { id: attendanceId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!existing) {
      return attendanceNotFound();
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed. Single statement, so the delete
    // is atomic on its own.
    await prisma.attendance.delete({
      where: { id: attendanceId, tenantId: tenant.id },
    });

    return NextResponse.json(ok(null, "Attendance record deleted"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // The record was deleted between the lookup and the delete. Reported as the
      // same 404 the lookup would have produced, so a losing racer and an unknown
      // id are indistinguishable.
      if (isRecordNotFound(err)) {
        return attendanceNotFound();
      }
    }

    console.error("[DELETE /api/attendance/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// No PATCH handler is exported, so a correction request receives 405. The README
// plans PATCH /api/attendance/[id] to correct a record, but what a correction may
// touch, and whether it is recorded rather than applied in place, are undecided —
// Attendance has no updatedAt column to record one, and markedAt and markedBy
// describe the original mark rather than any later edit. lib/validations/attendance.ts
// declares no update schema for the same reason. Note the README plans no DELETE
// for this resource at all; hard delete here is the approved decision, and it is
// currently the only way to undo a mark.
