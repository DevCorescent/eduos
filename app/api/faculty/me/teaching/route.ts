// ============================================================================
// MODULE : Faculty — My Teaching Assignments
// FLOW   : Guard → resolve THIS lecturer from the session → read the pairs they
//          teach, from both models that express it → response.
// ACCESS : FACULTY (their own) · UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Tell a lecturer which classes they may schedule, in the exact terms
//          the scheduling API will accept.
//
// WHY THIS ROUTE HAD TO EXIST
//   The Schedule Class dialog on the faculty portal must offer only authorized
//   choices, and there was no endpoint a lecturer could read them from:
//   GET /api/faculty/[id]/assignments is requireRole("UNIVERSITY_ADMIN"),
//   GET /api/courses is COURSE_READ_ROLES, and GET /api/sections is closed to
//   FACULTY as well. Without this, the only options the form could offer were
//   none.
//
// WHY IT MIRRORS teachesPair RATHER THAN JUST READING ASSIGNMENTS
//   lib/services/facultyTeaching.ts accepts EITHER an active
//   FacultyCourseAssignment OR an existing Timetable slot as proof that a
//   lecturer teaches a (section, course) pair, and POST /api/timetables applies
//   exactly that rule. If this route offered only assignments, a lecturer with a
//   timetabled class but no assignment row — an ordinary state, documented in
//   that module — would be shown an empty form for classes the API would have
//   accepted. The options a form presents and the rule the API enforces have to
//   be the same statement.
//
//   This route is a CONVENIENCE, never the authorization. Every write re-runs
//   facultyMayScheduleClass server-side against the pair actually submitted, so
//   a hand-crafted request naming a pair absent from this response is refused
//   regardless of what the form did or did not display.
//
// SECURITY: no [facultyId] segment and no id in any query parameter. The
//           lecturer is resolved from session.sub, so this cannot be asked
//           about a colleague — the same shape as GET /api/faculty/me.
// ============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { findFacultyIdForUser } from "@/lib/services/facultyTeaching";
import { ROLES } from "@/constants/roles";
import { ok, fail } from "@/types";

/**
 * How many pairs one lecturer can be offered.
 *
 * A teaching load is a handful of classes; this is a ceiling against a
 * misconfigured account rather than a page size, and the response is
 * deliberately unpaginated because a select's option list is read whole.
 */
const MAX_PAIRS = 200;

/** One (semester, section, course) the caller may schedule a class for. */
interface TeachingOption {
  semesterId: string | null;
  semesterName: string | null;
  sectionId: string;
  sectionName: string;
  courseId: string;
  courseCode: string;
  courseName: string;
}

// GET
// ACCESS     : FACULTY, UNIVERSITY_ADMIN, HOD — the same set GET /api/faculty/me
//              admits, because this answers the same question about the same
//              self-resolved person. An administrator reaching it sees their own
//              teaching, which is to say none; the institution-wide pickers are
//              on /api/courses and /api/sections, which they may already read.
// VALIDATION : none. There is nothing for a client to supply.
// FLOW       : Authorise → resolve tenant → resolve the caller's FacultyMember
//              row → read active assignments and existing slots together →
//              merge into one deduplicated list.
//
//              AN ASSIGNMENT WITH NO SECTION IS SKIPPED. A course-wide
//              assignment does not by itself prove this lecturer teaches any
//              PARTICULAR section, which is precisely what teachesPair says by
//              matching sectionId exactly including the null case. Offering it
//              as an option would show a choice the API then refuses.
//
//              INACTIVE SLOTS STILL COUNT. A cancelled class is proof the
//              lecturer teaches the pair — it is how they would restore or
//              re-schedule it — and teachesPair does not filter on isActive
//              either.
// RESPONSE   : { success: true, data: { teaching } }
// STATUS     : 200 OK · 401 UNAUTHORIZED · 403 FORBIDDEN · 500 SERVER_ERROR
//
//              No 404. A caller holding no FacultyMember row gets an empty list
//              rather than a miss: the question "what do you teach" has the
//              answer "nothing", and an administrator legitimately reaches this
//              state.
export async function GET() {
  try {
    const guard = await requireRole(ROLES.FACULTY, ROLES.UNIVERSITY_ADMIN, ROLES.HOD);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const tenantId = tenantGuard.tenant.id;

    // Resolved from the authenticated subject through the same helper every
    // other faculty-confined path uses, never from anything client-supplied.
    const facultyId = await findFacultyIdForUser(tenantId, guard.session.sub);

    if (facultyId === null) {
      return NextResponse.json(ok({ teaching: [] as TeachingOption[] }));
    }

    // Two independent reads, issued together. Either alone is sufficient proof
    // of teaching, so waiting on the first before starting the second would
    // cost a round trip for nothing — the same reasoning as teachesPair.
    const [assignments, slots] = await Promise.all([
      prisma.facultyCourseAssignment.findMany({
        where: { tenantId, facultyId, isActive: true, sectionId: { not: null } },
        select: {
          semesterId: true,
          sectionId: true,
          courseId: true,
          course: { select: { code: true, name: true } },
        },
        take: MAX_PAIRS,
      }),
      prisma.timetable.findMany({
        where: { tenantId, facultyId },
        select: {
          semesterId: true,
          sectionId: true,
          courseId: true,
          course: { select: { code: true, name: true } },
          section: { select: { name: true } },
          semester: { select: { name: true } },
        },
        distinct: ["semesterId", "sectionId", "courseId"],
        take: MAX_PAIRS,
      }),
    ]);

    // The section and semester NAMES an assignment does not carry. Its
    // sectionId and semesterId are bare unconstrained columns on
    // FacultyCourseAssignment — the model declares no relation to either — so
    // they cannot be joined and are resolved here instead, tenant-scoped.
    const sectionIds = [
      ...new Set(assignments.map((row) => row.sectionId).filter((id): id is string => !!id)),
    ];
    const semesterIds = [
      ...new Set(assignments.map((row) => row.semesterId).filter((id): id is string => !!id)),
    ];

    const [sections, semesters] = await Promise.all([
      sectionIds.length
        ? prisma.section.findMany({
            where: { tenantId, id: { in: sectionIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      semesterIds.length
        ? prisma.semester.findMany({
            where: { tenantId, id: { in: semesterIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const sectionNameById = new Map(sections.map((row) => [row.id, row.name]));
    const semesterNameById = new Map(semesters.map((row) => [row.id, row.name]));

    // Keyed on the triple, so a pair proven by BOTH an assignment and a slot
    // appears once. Slots are merged second and therefore win, because their
    // labels come from real joins rather than the lookups above.
    const byKey = new Map<string, TeachingOption>();

    for (const row of assignments) {
      // Narrowed by the query, restated for the type checker: sectionId is
      // nullable on the model even though `not: null` excludes it here.
      if (!row.sectionId) continue;

      // A section that is not in this tenant resolves to no name and is
      // dropped rather than shown as "—": the assignment column carries no
      // foreign key, so a stale id is possible and offering it would produce
      // an option the scheduling API answers 404 for.
      const sectionName = sectionNameById.get(row.sectionId);
      if (!sectionName) continue;

      byKey.set(`${row.semesterId ?? ""}|${row.sectionId}|${row.courseId}`, {
        semesterId: row.semesterId,
        semesterName: row.semesterId ? (semesterNameById.get(row.semesterId) ?? null) : null,
        sectionId: row.sectionId,
        sectionName,
        courseId: row.courseId,
        courseCode: row.course.code,
        courseName: row.course.name,
      });
    }

    for (const row of slots) {
      byKey.set(`${row.semesterId}|${row.sectionId}|${row.courseId}`, {
        semesterId: row.semesterId,
        semesterName: row.semester.name,
        sectionId: row.sectionId,
        sectionName: row.section.name,
        courseId: row.courseId,
        courseCode: row.course.code,
        courseName: row.course.name,
      });
    }

    const teaching = [...byKey.values()].sort(
      (a, b) =>
        a.courseCode.localeCompare(b.courseCode) || a.sectionName.localeCompare(b.sectionName)
    );

    return NextResponse.json(ok({ teaching }));
  } catch (err) {
    console.error("[GET /api/faculty/me/teaching]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
