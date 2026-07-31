// ============================================================================
// OWNER  : Gauransh
// MODULE : Timetable — Section Schedule
// FLOW   : Guard → tenant → param → query → prove section ownership →
//          section-scoped page → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Read one section's timetable within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { timetableSectionParamSchema } from "@/lib/validations/timetable";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns returned for a timetable entry.
 *
 * The collection and detail routes declare the same shape. It is restated here
 * rather than imported because a Next.js route module may only export route
 * handlers and segment config, so this constant cannot be shared from either —
 * the same reason COURSE_SELECT and FACULTY_SELECT are restated in their own
 * detail routes.
 *
 * No relation is expanded. Timetable carries four real relations — semester,
 * section, course and faculty — so the joins are possible; they are simply not
 * taken. In particular the section is NOT embedded even though this endpoint is
 * keyed on it: the caller already holds the sectionId, and every row in the
 * response carries the same one, so expanding it would repeat a known value on
 * every row.
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
// VALIDATION : timetableSectionParamSchema for the [sectionId] segment — keyed on
//              sectionId rather than id because that is the segment name and so
//              the key Next.js supplies; sectionIdParamSchema in the section
//              module is keyed on id and would strip this value. Must be
//              non-empty once trimmed, so a whitespace-only segment is the same
//              400 VALIDATION_ERROR every other detail route answers with. Section
//              ids are cuids, so no UUID assertion is applied — an
//              unrecognised-but-well-formed id is a 404, not a 400.
//
//              paginationQuerySchema — ?page (default 1) and ?limit (default 20,
//              max 100). The shared contract is consumed directly rather than
//              through a module-local alias, exactly as in the collection route:
//              lib/validations/timetable.ts declares no query alias, and the
//              aliases other modules define (courseQuerySchema and siblings) are
//              plain re-exports of this same object, never extensions of it.
//
//              No filter parameter is defined. The README names filters for
//              /api/attendance but none here, and this endpoint is already
//              filtered by the section in its path. Inactive entries therefore
//              list alongside active ones with the client reading isActive.
// FLOW       : Authorise → resolve tenant → validate param and query → prove the
//              section belongs to this tenant → read one page of that section's
//              entries alongside the total in a single transaction.
//
//              The section is resolved first and the timetable is never read
//              without it. Section.tenantId is checked in the lookup itself
//              rather than after the fact, so a section owned by another tenant
//              is never loaded and never acknowledged. A foreign key would not
//              serve here: Section carries real foreign keys to Batch and
//              Semester, but a foreign key proves existence rather than
//              ownership. An unknown sectionId and one owned by another tenant
//              return the identical 404, so no id is ever confirmed to exist
//              elsewhere.
//
//              The timetable query then filters on tenantId AND sectionId
//              together, not on sectionId alone. The tenant predicate is not
//              redundant with the ownership check above: Timetable.tenantId
//              carries no foreign key at all, so nothing in the schema ties an
//              entry to the section it points at, and a row whose two columns
//              disagreed would otherwise be served to the wrong tenant. Both
//              predicates are applied to the count as well, so the total can
//              never describe a wider set than the page.
//
//              A section with no entries is a valid, owned section that happens
//              to be unscheduled — an empty page with total 0, never a 404. Only
//              the section itself being unknown or foreign is not-found.
//
//              Ordering is by day, then start time, then id, identical to the
//              collection route. It is required for correctness rather than
//              presentation: offset pagination over an unordered result can
//              repeat or skip rows across pages. day is a Postgres enum, so
//              ascending order follows the order the values are declared in the
//              schema — MONDAY first through SUNDAY — rather than alphabetically.
//              startTime sorts correctly as text precisely because the validation
//              layer requires zero-padded 24-hour HH:mm; a variable-width format
//              would place "9:00" after "10:00". The id tiebreaker is what makes
//              the page boundaries deterministic, and it matters here as much as
//              on the collection: Timetable declares no unique constraint at all,
//              and two slots for one section can agree on every ordered column.
//              createdAt is not used as a sort key.
//
//              The rows are returned raw. No overlap detection, no duplicate
//              filtering, no aggregation, no grouping by day and no reshaping
//              into a grid — per the approved decisions, and because every one of
//              those would be a scheduling rule the schema does not express.
// RESPONSE   : { success: true, data: { timetables, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              No conflict status is reachable and none is handled: this endpoint
//              performs no write.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsedParam = timetableSectionParamSchema.safeParse(await params);
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

    const parsedQuery = paginationQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedQuery.error),
        },
        { status: 400 }
      );
    }

    const { sectionId } = parsedParam.data;
    const { page, limit } = parsedQuery.data;

    // Ownership is proven before any timetable row is read. findFirst rather
    // than findUnique: the tenant filter is part of the lookup, so another
    // tenant's section can never be resolved or even acknowledged.
    const section = await prisma.section.findFirst({
      where: { id: sectionId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!section) {
      return NextResponse.json(fail("Section not found", "NOT_FOUND"), { status: 404 });
    }

    const where = { tenantId: tenant.id, sectionId };

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
    console.error("[GET /api/timetables/section/[sectionId]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
