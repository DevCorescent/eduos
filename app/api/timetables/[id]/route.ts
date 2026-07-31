// ============================================================================
// OWNER  : Gauransh
// MODULE : Timetable — Timetable Detail
// FLOW   : Guard → tenant → param → tenant-scoped lookup → read / hard delete →
//          response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: View and permanently remove a single timetable slot within the
//          authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isRecordNotFound } from "@/lib/utils/prisma-errors";
import { timetableIdParamSchema } from "@/lib/validations/timetable";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns returned for a timetable entry.
 *
 * The collection route declares the same shape. It is restated here rather than
 * imported because a Next.js route module may only export route handlers and
 * segment config, so this constant cannot be shared from there — the same reason
 * COURSE_SELECT and FACULTY_SELECT are restated in their own detail routes.
 *
 * No relation is expanded. Timetable does carry four real relations — semester,
 * section, course and faculty — so unlike Course these joins are possible; they
 * are simply not taken here, matching the collection route and every other detail
 * route in the project. The response carries the four ids and the client resolves
 * names through their own endpoints.
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

/**
 * The single 404 both handlers answer with.
 *
 * Built here rather than inline so an unknown id, an id owned by another tenant
 * and an already-deleted id cannot drift apart: every miss produces the identical
 * status, code and message, byte for byte. That identity is the whole point — a
 * distinguishable response would confirm that a given id exists somewhere.
 */
function timetableNotFound(): NextResponse {
  return NextResponse.json(fail("Timetable entry not found", "NOT_FOUND"), { status: 404 });
}

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : timetableIdParamSchema — the [id] segment must be non-empty once
//              trimmed. Timetable.id is a cuid, not a UUID, so no UUID assertion
//              is applied; the value is an opaque key and an
//              unrecognised-but-well-formed one is a 404 rather than a 400.
//              No query parameters are read: this addresses a single resource, so
//              there is no collection to page through and no pagination contract
//              to validate. Any query string supplied is ignored rather than
//              rejected, matching every other detail route in the project.
// FLOW       : Authorise → resolve tenant → read the entry filtered by BOTH id
//              and tenantId.
//
//              findFirst, never findUnique(id). The tenant filter is part of the
//              lookup itself rather than a check applied to a row already
//              fetched, so another tenant's entry is never loaded, never
//              acknowledged and cannot leak through a mistake in a later branch.
//              This matters more for Timetable than for most models: tenantId
//              carries no foreign key at all here, so the column is the only
//              record of ownership and the query is the only thing enforcing it.
//
//              An unknown id and an id owned by another tenant return the
//              identical 404, so no id is ever confirmed to exist elsewhere.
// RESPONSE   : { success: true, data: <Timetable> }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsed = timetableIdParamSchema.safeParse(await params);
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

    // findFirst rather than findUnique: the tenant filter is part of the lookup,
    // so another tenant's row can never be returned or even acknowledged.
    const timetable = await prisma.timetable.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
      select: TIMETABLE_SELECT,
    });

    if (!timetable) {
      return timetableNotFound();
    }

    return NextResponse.json(ok(timetable));
  } catch (err) {
    console.error("[GET /api/timetables/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// DELETE
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : timetableIdParamSchema — the [id] segment must be non-empty once
//              trimmed. No body is read: a delete carries no payload, and any body
//              sent is ignored rather than rejected.
// FLOW       : Authorise → resolve tenant → prove the entry belongs to this
//              tenant (404 otherwise) → delete it scoped by id AND tenantId.
//
//              The lookup comes first and the delete never runs without it. The
//              write is then scoped by tenantId as well as id, so ownership is
//              asserted twice: once to decide the response, and again in the
//              statement that actually removes the row. Deleting by id alone would
//              reach any tenant's entry, and Timetable.tenantId carries no foreign
//              key, so nothing outside this query would catch that.
//
//              An unknown id, an id owned by another tenant and an id already
//              deleted all return the identical 404 through timetableNotFound(),
//              so a repeated delete is a 404 rather than a 200 and no id is ever
//              confirmed to exist elsewhere.
//
//              The removal is permanent, per the approved decisions. The schema
//              has no deletedAt column and no archive model for this data, so
//              there is nothing to soft-delete into and no restore path; the row
//              is gone. No cascade is performed in application code — the database
//              owns that entirely, and nothing in the schema is affected here:
//              Timetable is a leaf, holding foreign keys to Semester, Section,
//              Course and FacultyMember while nothing holds one to it. Removing a
//              slot therefore touches no other row.
// RESPONSE   : { success: true, data: null, message: "Timetable entry deleted" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              No conflict status is reachable and none is handled. Nothing in the
//              schema holds a foreign key to Timetable and it has no child
//              relations, so no dependent RESTRICT can refuse the delete — unlike
//              Campus, whose departments can. P2025 remains the race backstop: if
//              the row is removed between the lookup and the delete, that is
//              reported as the same 404 the lookup would have produced.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = timetableIdParamSchema.safeParse(await params);
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

    const timetableId = parsed.data.id;

    // Ownership is proven before anything is removed. A foreign or unknown id
    // stops here and no write is issued at all.
    const existing = await prisma.timetable.findFirst({
      where: { id: timetableId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!existing) {
      return timetableNotFound();
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed. Single statement, so the delete
    // is atomic on its own.
    await prisma.timetable.delete({
      where: { id: timetableId, tenantId: tenant.id },
    });

    return NextResponse.json(ok(null, "Timetable entry deleted"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // The entry was deleted between the lookup and the delete. Reported as the
      // same 404 the lookup would have produced, so a losing racer and an unknown
      // id are indistinguishable.
      if (isRecordNotFound(err)) {
        return timetableNotFound();
      }
    }

    console.error("[DELETE /api/timetables/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
