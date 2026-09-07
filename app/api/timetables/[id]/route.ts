// ============================================================================
// OWNER  : Gauransh
// MODULE : Timetable — Timetable Detail
// FLOW   : Guard → tenant → param → tenant-scoped lookup → read / update /
//          hard delete → response.
// ACCESS : GET    — UNIVERSITY_ADMIN
//          PATCH  — UNIVERSITY_ADMIN (any slot in the tenant)
//                   FACULTY          (only their own authorized classes)
//          DELETE — UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: View, reschedule, cancel and permanently remove a single timetable
//          slot within the authenticated tenant.
//
// PATCH IS THE SCHEDULING EDIT PATH; DELETE IS NOT
//   Rescheduling a class must not destroy and recreate the row. Attendance
//   references Timetable, so a new id would orphan every register already taken
//   against that slot — the class would keep its name and lose its history.
//   Cancelling is `isActive: false` for the same reason, which is the soft-delete
//   convention this schema already carries and the one Certificate revocation
//   and Notification deletion both follow.
//
//   DELETE is left exactly as it was: an administrative hard removal, unchanged
//   in behaviour and access. The scheduling UI never calls it.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireFacultyTimetableAccess } from "@/lib/middleware/requireFacultyTimetableAccess";
import { isForeignKeyViolation, isRecordNotFound } from "@/lib/utils/prisma-errors";
import {
  isBefore,
  timetableIdParamSchema,
  updateTimetableSchema,
} from "@/lib/validations/timetable";
import {
  FACULTY_SCHEDULE_REFUSALS,
  facultyMayScheduleClass,
} from "@/lib/services/facultyTeaching";
import {
  describeSlot,
  findScheduleConflicts,
  resolveReferences,
} from "@/lib/services/timetableScheduling";
import {
  notifyClassCancelled,
  notifyClassRescheduled,
  notifyClassScheduled,
} from "@/lib/controllers/classScheduling.controller";
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
 * Three relations ARE expanded, matching the collection route. That reverses the
 * original projection, which carried the four ids alone on the reasoning that a
 * client resolves them through their own endpoints — true for an administrator
 * and false for everybody else, since /api/courses is COURSE_READ_ROLES and
 * /api/faculty is closed to FACULTY entirely. Without the joins the client had
 * nowhere to get a course name from, and services/academics.ts filled the gap
 * with a literal "—" on every row.
 *
 * The semester is deliberately NOT expanded: nothing on the scheduling screens
 * displays a semester name per row, and the id is what the filters send.
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
  // Expanded for the same reason the collection route expands them: a slot is
  // meaningless as four opaque cuids, and the roles that read this endpoint
  // cannot resolve them — /api/courses is COURSE_READ_ROLES and /api/faculty is
  // closed to FACULTY. See the collection route for the full note.
  course: { select: { code: true, name: true } },
  faculty: { select: { user: { select: { firstName: true, lastName: true } } } },
  section: { select: { name: true } },
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

// PATCH
// ACCESS     : UNIVERSITY_ADMIN — any slot within their own tenant.
//              FACULTY          — only a class they are assigned to teach, and
//                                 they may not hand it to a colleague.
//
//              Guarded by requireFacultyTimetableAccess, the same guard the
//              collection route's POST uses, so the create and edit paths cannot
//              disagree about who may schedule what.
//
// VALIDATION : updateTimetableSchema — every writable column optional, at least
//              one required, and endTime after startTime whenever both arrive.
//              A body changing only one of the two is checked against the
//              STORED value of the other, below, where that value is known.
//
// FLOW       : Authorise → tenant-scoped lookup → merge body onto stored row →
//              re-validate the merged time range → re-resolve references →
//              re-run faculty ownership on the MERGED pair → re-run conflict
//              detection excluding this row → update → notify.
//
//              EVERY CHECK RE-RUNS. An edit is not a smaller write than a
//              create: moving a class into an occupied period is the same
//              double-booking as scheduling it there, and a lecturer editing a
//              class they own into a section they do not teach is exactly the
//              escalation the create path refuses. The one difference is that
//              this row is excluded from its own conflict scan, or a slot would
//              always collide with itself and nothing could ever be edited.
//
//              THE OWNERSHIP TEST USES THE MERGED PAIR, not the stored one. A
//              lecturer who owns (section A, course X) must not be able to
//              rewrite that slot into (section B, course Y) that they do not
//              own — checking the row as it stands would authorise exactly that.
//
// RESPONSE   : { success: true, data: <Timetable>, message: … }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireFacultyTimetableAccess();
    if (!guard.granted) return guard.response;

    const { tenantId, userId, scope } = guard.access;

    const parsedParam = timetableIdParamSchema.safeParse(await params);
    if (!parsedParam.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParam.error),
        },
        { status: 400 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = updateTimetableSchema.safeParse(body);
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
    const timetableId = parsedParam.data.id;

    // Ownership of the ROW is proven before anything else. A foreign or unknown
    // id stops here with the same 404 an administrator would receive, so a
    // faculty caller probing ids learns nothing about which ones exist.
    const existing = await prisma.timetable.findFirst({
      where: { id: timetableId, tenantId },
      select: TIMETABLE_SELECT,
    });

    if (!existing) {
      return timetableNotFound();
    }

    // The slot as it WOULD be. Every subsequent check reads this, never the
    // stored row, because the question is whether the RESULT is legal.
    const merged = {
      semesterId: input.semesterId ?? existing.semesterId,
      sectionId: input.sectionId ?? existing.sectionId,
      courseId: input.courseId ?? existing.courseId,
      facultyId: input.facultyId ?? existing.facultyId,
      day: input.day ?? existing.day,
      startTime: input.startTime ?? existing.startTime,
      endTime: input.endTime ?? existing.endTime,
      roomNo: input.roomNo === undefined ? existing.roomNo : input.roomNo,
      sessionType: input.sessionType ?? existing.sessionType,
      isActive: input.isActive ?? existing.isActive,
    };

    // The half of the time rule the schema cannot apply: a body supplying only
    // startTime is legal on its own and illegal against the stored endTime.
    if (!isBefore(merged.startTime, merged.endTime)) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: { endTime: ["End time must be after start time"] },
        },
        { status: 400 }
      );
    }

    // Re-resolved rather than trusted, because an edit may point the slot at a
    // different semester, section, course or faculty member — and each of those
    // has to belong to this tenant just as it did on create.
    const references = await resolveReferences(tenantId, merged);
    if (!references.ok) {
      const label = references.missing === "faculty" ? "Faculty member" : references.missing;
      return NextResponse.json(
        fail(`${label.charAt(0).toUpperCase()}${label.slice(1)} not found`, "NOT_FOUND"),
        { status: 404 }
      );
    }

    let facultyId = merged.facultyId;

    if (scope === "OWN") {
      // The MERGED pair. See the flow note above for why the stored pair would
      // be the wrong thing to authorise against.
      //
      // The requested facultyId is the merged value, which for a body that does
      // not mention it is the STORED one — so a lecturer cannot edit a class
      // timetabled under a colleague's name, even one they co-teach.
      const decision = await facultyMayScheduleClass(
        tenantId,
        userId,
        { sectionId: merged.sectionId, courseId: merged.courseId },
        merged.facultyId
      );

      if (!decision.allowed) {
        return NextResponse.json(
          fail(FACULTY_SCHEDULE_REFUSALS[decision.reason], "FORBIDDEN"),
          { status: 403 }
        );
      }

      facultyId = decision.facultyId;
    }

    // Skipped when the class is being cancelled: a slot going inactive occupies
    // nothing, so refusing it for clashing with a live class would make an
    // already double-booked timetable impossible to clean up.
    if (merged.isActive) {
      const conflicts = await findScheduleConflicts(
        tenantId,
        { ...merged, facultyId },
        timetableId
      );

      if (conflicts.length > 0) {
        return NextResponse.json(
          fail(conflicts.map((conflict) => conflict.message).join(" "), "CONFLICT"),
          { status: 409 }
        );
      }
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed.
    const updated = await prisma.timetable.update({
      where: { id: timetableId, tenantId },
      data: { ...input, facultyId },
      select: TIMETABLE_SELECT,
    });

    // --- Notification -------------------------------------------------------
    //
    // WHICH EVENT, exactly once. The three cases are mutually exclusive and are
    // decided from the isActive transition, so a cancellation is never also
    // announced as a reschedule and a no-op edit announces nothing at all.
    const facultyName =
      `${updated.faculty.user.firstName} ${updated.faculty.user.lastName}`.trim();

    const notice = {
      tenantId,
      slotId: updated.id,
      courseId: updated.courseId,
      sectionId: updated.sectionId,
      facultyUserId: references.references.facultyUserId,
      courseLabel: `${references.references.courseCode} — ${references.references.courseName}`,
      description: describeSlot(updated, { ...references.references, facultyName }),
    };

    const previousDescription = describeSlot(existing, {
      courseCode: existing.course.code,
      courseName: existing.course.name,
      sectionName: existing.section.name,
      facultyName:
        `${existing.faculty.user.firstName} ${existing.faculty.user.lastName}`.trim(),
    });

    const notifyScope = "PATCH /api/timetables/[id]";

    if (existing.isActive && !updated.isActive) {
      await notifyClassCancelled(notifyScope, notice);
    } else if (!existing.isActive && updated.isActive) {
      // Restoring a cancelled class is a new class from a student's side: it is
      // back on the timetable and they need to know it is happening again.
      await notifyClassScheduled(notifyScope, notice);
    } else if (previousDescription !== notice.description) {
      // Only when something a student can SEE has moved. An edit that changes
      // nothing visible does not interrupt a whole section for nothing.
      await notifyClassRescheduled(notifyScope, { ...notice, previousDescription });
    }

    const message = !updated.isActive
      ? "Class cancelled"
      : existing.isActive
        ? "Class updated"
        : "Class restored";

    return NextResponse.json(ok(updated, message));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // The row was removed between the lookup and the update. Reported as the
      // same 404 the lookup would have produced.
      if (isRecordNotFound(err)) {
        return timetableNotFound();
      }

      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced semester, section, course or faculty member not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[PATCH /api/timetables/[id]]", err);
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
