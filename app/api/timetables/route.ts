// ============================================================================
// OWNER  : Gauransh
// MODULE : Timetable — Timetable Collection
// FLOW   : Guard → tenant → query/body → tenant-scoped reference checks →
//          faculty ownership (non-elevated callers) → conflict check → write →
//          notify affected students → response.
// ACCESS : GET  — UNIVERSITY_ADMIN
//          POST — UNIVERSITY_ADMIN (anywhere in the tenant)
//                 FACULTY          (only classes they are assigned to teach)
// BACKEND: Prisma
// PURPOSE: List the authenticated tenant's schedule and schedule classes on it.
//
// WHAT CHANGED FOR CLASS SCHEDULING
//   1. GET accepts filters. It parsed paginationQuerySchema and nothing else,
//      so Zod dropped ?semesterId, ?sectionId, ?courseId, ?facultyId, ?day and
//      ?sessionType before the handler saw them and the route always answered
//      with the entire tenant's schedule.
//   2. POST admits FACULTY, confined to their own teaching assignments.
//   3. POST refuses a double-booking. The original explicitly did not — see
//      lib/services/timetableScheduling.ts for why that was right then and is
//      not right now.
//   4. The notification names the class. It previously interpolated raw cuids
//      into the message a student reads.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireFacultyTimetableAccess } from "@/lib/middleware/requireFacultyTimetableAccess";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { timetableQuerySchema, createTimetableSchema } from "@/lib/validations/timetable";
import {
  FACULTY_SCHEDULE_REFUSALS,
  facultyMayScheduleClass,
} from "@/lib/services/facultyTeaching";
import {
  describeSlot,
  findScheduleConflicts,
  resolveReferences,
} from "@/lib/services/timetableScheduling";
import { notifyClassScheduled } from "@/lib/controllers/classScheduling.controller";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns returned for a timetable entry. Declared once so both handlers answer
 * with the same shape.
 *
 * The course and the lecturer ARE expanded, unlike the original projection.
 * That was not an oversight then and it is not a reversal now: the reason given
 * was that a client resolves the ids through their own endpoints, which is true
 * for an administrator and false for everybody else — /api/courses is
 * COURSE_READ_ROLES and /api/faculty is closed to FACULTY entirely. The faculty
 * schedule route already joins the course for exactly this reason. Without the
 * join here, services/academics.ts filled the gap with a literal "—" on every
 * row, so the Timetable screen displayed a grid of dashes.
 *
 * Two scalar columns off each relation, no new authorization surface: a caller
 * who may read the slot may read which class the slot is.
 *
 * Timetable has no updatedAt column, so createdAt is the only timestamp there
 * is to report.
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
  course: { select: { code: true, name: true } },
  faculty: { select: { user: { select: { firstName: true, lastName: true } } } },
  section: { select: { name: true } },
} as const;

// Timetable holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here. startTime and endTime are plain strings and
// createdAt is a DateTime carrying its own toJSON.

// GET
// ACCESS     : UNIVERSITY_ADMIN
//
//              Deliberately NOT widened to FACULTY. This is the institution-wide
//              schedule, and a lecturer's own week is a different endpoint —
//              GET /api/timetables/faculty/[facultyId], which admits them and
//              confines them to their own record. Opening this one would hand
//              FACULTY the whole tenant's timetable through a query string,
//              which is precisely the scope the Class Scheduling authorization
//              model says they do not have.
// VALIDATION : timetableQuerySchema — pagination plus six optional filters.
//              An empty filter value means "no filter" rather than 400, because
//              that is what every ListFilter reset writes.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              entries alongside the total in a single transaction.
//
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, and the tenant predicate leads
//              the where clause, so no cross-tenant row is reachable however the
//              filters are set. A filter naming another tenant's section simply
//              matches nothing — it is ANDed with the tenant, never ORed.
//
//              Ordering is by day, then start time, then id, for correctness
//              rather than presentation: offset pagination over an unordered
//              result can repeat or skip rows across pages. `day` is a Postgres
//              enum, so ascending order follows the declaration order — MONDAY
//              through SUNDAY — rather than alphabetical. startTime sorts
//              correctly as text precisely because validation requires
//              zero-padded 24-hour HH:mm. The id tiebreaker is what makes page
//              boundaries deterministic, and it matters more here than
//              elsewhere: Timetable declares no unique constraint at all, so two
//              slots may agree on every ordered column.
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

    const parsed = timetableQuerySchema.safeParse(
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

    const { page, limit, semesterId, sectionId, courseId, facultyId, day, sessionType } =
      parsed.data;

    // The tenant predicate leads and every filter is ANDed onto it, so no
    // filter can widen the result beyond the caller's own tenant.
    const where: Prisma.TimetableWhereInput = {
      tenantId: tenant.id,
      ...(semesterId ? { semesterId } : {}),
      ...(sectionId ? { sectionId } : {}),
      ...(courseId ? { courseId } : {}),
      ...(facultyId ? { facultyId } : {}),
      ...(day ? { day } : {}),
      ...(sessionType ? { sessionType } : {}),
    };

    // Paired in one transaction so the total cannot shift between the two reads,
    // and taken over the SAME where — a count over a wider predicate would
    // report a total the filtered list can never reach.
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
// ACCESS     : UNIVERSITY_ADMIN — any class within their own tenant.
//              FACULTY          — only a (section, course) pair they are
//                                 assigned to teach, and only under their own
//                                 name.
//
//              The two are separated by requireFacultyTimetableAccess, which
//              already expresses exactly this authority for the read side and
//              is reused rather than restated: its role set is
//              [UNIVERSITY_ADMIN, FACULTY] and it resolves ANY or OWN plus the
//              tenant in one call. A second guard saying the same thing is a
//              second guard to keep in step.
//
// VALIDATION : createTimetableSchema — semesterId, sectionId, courseId,
//              facultyId, day, startTime and endTime required; roomNo,
//              sessionType and isActive optional. Times must be strict 24-hour
//              HH:mm and endTime strictly after startTime, so a zero-length
//              slot is refused as well as an inverted one. tenantId, id and
//              createdAt are absent from the schema and are stripped from any
//              body supplying them.
//
// FLOW       : Authorise → resolve tenant → parse body → resolve all four
//              references against THIS tenant → confine a faculty caller to
//              their own class → refuse a double-booking → create → notify.
//
//              Every reference is verified against this tenant, not merely for
//              existence. All four carry real foreign keys with ON DELETE
//              RESTRICT, but a foreign key proves existence rather than
//              ownership, and Timetable.tenantId carries no foreign key at all,
//              so nothing in the schema ties an entry to the rows it points at
//              — resolveReferences is the only thing that does. An unknown id
//              and one owned by another tenant produce the identical 404, so no
//              id is ever confirmed to exist elsewhere.
//
//              THE ORDER MATTERS. References are checked BEFORE the faculty
//              ownership test, so a lecturer naming a section from another
//              tenant gets the same 404 an administrator would rather than a
//              403 that would confirm the row exists. Ownership is checked
//              BEFORE the conflict scan, so a lecturer probing for a
//              colleague's free periods is refused before any timetable data
//              influences the answer.
//
// RESPONSE   : { success: true, data: <Timetable>,
//                message: "Class scheduled" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              409 is new and is the scheduling conflict — the one status the
//              original route documented as unreachable, because it was
//              reasoning about unique constraints and there are still none.
//              Overlap is a cross-row range predicate that no index can hold,
//              so it is enforced here and reported as the conflict it is.
export async function POST(request: NextRequest) {
  try {
    const guard = await requireFacultyTimetableAccess();
    if (!guard.granted) return guard.response;

    const { tenantId, userId, scope } = guard.access;

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

    const references = await resolveReferences(tenantId, input);
    if (!references.ok) {
      const label =
        references.missing === "faculty" ? "Faculty member" : references.missing;
      return NextResponse.json(
        fail(
          `${label.charAt(0).toUpperCase()}${label.slice(1)} not found`,
          "NOT_FOUND"
        ),
        { status: 404 }
      );
    }

    // THE DATA GATE for a non-elevated caller. `scope` is "OWN" only for
    // FACULTY; an administrator skips this entirely, which is correct — they
    // schedule on behalf of faculty legitimately and hold no FacultyMember row.
    //
    // facultyId is taken from the DECISION, never from the body: a lecturer who
    // names a colleague is refused above, and one who names nobody still gets
    // their own id written. Nothing a client sends reaches this column for a
    // faculty caller.
    let facultyId = input.facultyId;

    if (scope === "OWN") {
      const decision = await facultyMayScheduleClass(
        tenantId,
        userId,
        { sectionId: input.sectionId, courseId: input.courseId },
        input.facultyId
      );

      if (!decision.allowed) {
        return NextResponse.json(
          fail(FACULTY_SCHEDULE_REFUSALS[decision.reason], "FORBIDDEN"),
          { status: 403 }
        );
      }

      facultyId = decision.facultyId;
    }

    const conflicts = await findScheduleConflicts(tenantId, { ...input, facultyId });
    if (conflicts.length > 0) {
      // Every clash, joined — a caller moving a class wants all three at once
      // rather than one failed save at a time. The message is user-facing by
      // construction; see lib/services/timetableScheduling.ts.
      return NextResponse.json(
        fail(conflicts.map((conflict) => conflict.message).join(" "), "CONFLICT"),
        { status: 409 }
      );
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context and facultyId from the ownership
    // decision; neither is ever read from the request body.
    const timetable = await prisma.timetable.create({
      data: { ...input, facultyId, tenantId },
      select: TIMETABLE_SELECT,
    });

    // After the slot exists, throwing nothing. See
    // lib/controllers/classScheduling.controller.ts for the audience rule.
    await notifyClassScheduled("POST /api/timetables", {
      tenantId,
      slotId: timetable.id,
      courseId: timetable.courseId,
      sectionId: timetable.sectionId,
      facultyUserId: references.references.facultyUserId,
      courseLabel: `${references.references.courseCode} — ${references.references.courseName}`,
      description: describeSlot(timetable, {
        ...references.references,
        // The lecturer actually written to the row, which for a faculty caller
        // is themselves rather than whoever the body named.
        facultyName: `${timetable.faculty.user.firstName} ${timetable.faculty.user.lastName}`.trim(),
      }),
    });

    return NextResponse.json(ok(timetable, "Class scheduled"), { status: 201 });
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
