// ============================================================================
// MODULE : Timetable — Student Timetable
// FLOW   : Guard → resolve THIS student from the session → read their section's
//          active slots → response.
// ACCESS : STUDENT (their own timetable) · UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Give a student the weekly schedule of the section they sit in.
//
// WHY THIS ROUTE HAD TO EXIST
//   It did not, and that was the whole gap. The only endpoint returning a
//   section's schedule is GET /api/timetables/section/[sectionId], which is
//   requireRole("UNIVERSITY_ADMIN") — so a signed-in student was answered 403
//   for their own timetable. app/(portals)/student/timetable/page.tsx rendered
//   an "unavailable" state saying exactly that, in as many words. This is the
//   endpoint that state was waiting for.
//
// SECURITY: no [studentId] segment and no studentId in any query parameter. The
//           caller is resolved from session.sub, so this route cannot be asked
//           about anybody else — the same shape as /api/student/dashboard and
//           /api/student/profile, and the reason no IDOR is reachable here.
//
// WHY IT REUSES requireStudentProfileAccess
//   Its role set is [STUDENT, UNIVERSITY_ADMIN] and it resolves the tenant
//   alongside the subject, which is exactly this route's authority. A second
//   guard saying the same thing would be a second guard to keep in step. An
//   administrator reaching it sees their own timetable, which is to say none —
//   they hold no Student row, and the institution-wide view is /api/timetables.
// ============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireStudentProfileAccess } from "@/lib/middleware/requireStudentProfileAccess";
import { ok, fail } from "@/types";

/**
 * Columns a student's own timetable carries.
 *
 * Narrower than the administrative projection on purpose. tenantId, createdAt
 * and the four raw reference ids are absent: a student has no endpoint that
 * would resolve them and no screen that displays them, so returning them would
 * widen the payload for nothing. What is here is what the grid renders.
 *
 * isActive is absent too, because the filter below is not negotiable and every
 * row is therefore true.
 */
const STUDENT_TIMETABLE_SELECT = {
  id: true,
  day: true,
  startTime: true,
  endTime: true,
  roomNo: true,
  sessionType: true,
  course: { select: { code: true, name: true } },
  faculty: { select: { user: { select: { firstName: true, lastName: true } } } },
} as const;

// GET
// ACCESS     : requireStudentProfileAccess — STUDENT or UNIVERSITY_ADMIN.
// VALIDATION : none. There is nothing for a client to supply: the student comes
//              from the session and the section comes from the student.
// FLOW       : Authorise → resolve the caller's Student row within the resolved
//              tenant → read that section's ACTIVE slots.
//
//              CANCELLED SLOTS ARE FILTERED OUT, unlike every administrative
//              timetable read in this project, which lists inactive rows
//              alongside active ones and lets the client read the flag. That is
//              right for an administrator, who needs to see and restore what was
//              cancelled, and wrong for a student: a cancelled class shown on a
//              personal timetable is an instruction to attend a class that is
//              not happening. Exactly the rule childTimetable already applies
//              for a parent viewing the same data.
//
//              A STUDENT WITH NO SECTION HAS AN EMPTY TIMETABLE, not the whole
//              university's. Also the rule childTimetable states.
//
//              Unpaginated. A week grid is read whole, and paging it would hand
//              back half a week — the same reasoning services/academics.ts gives
//              for reading the curriculum unpaginated. The result is bounded by
//              the periods in a teaching week.
// RESPONSE   : { success: true, data: { timetables } }
// STATUS     : 200 OK · 401 UNAUTHORIZED · 403 FORBIDDEN · 500 SERVER_ERROR
//
//              No 404. A student with no section is an empty list rather than a
//              miss: their timetable exists and has nothing on it.
export async function GET() {
  try {
    const guard = await requireStudentProfileAccess();
    if (!guard.granted) return guard.response;

    const { tenantId, userId } = guard.access;

    // findFirst with the tenant in the predicate, so another tenant's student
    // can never be resolved. Student is unique on userId, so this matches at
    // most one row.
    const student = await prisma.student.findFirst({
      where: { userId, tenantId },
      select: { sectionId: true },
    });

    if (!student?.sectionId) {
      return NextResponse.json(ok({ timetables: [] }));
    }

    const timetables = await prisma.timetable.findMany({
      where: { tenantId, sectionId: student.sectionId, isActive: true },
      orderBy: [{ day: "asc" }, { startTime: "asc" }, { id: "asc" }],
      select: STUDENT_TIMETABLE_SELECT,
    });

    return NextResponse.json(ok({ timetables }));
  } catch (err) {
    console.error("[GET /api/student/timetable]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
