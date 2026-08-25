// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance — Section Roster
// FLOW   : Guard (role → tenant → section → ownership) → validate param and
//          query → read the section's ACTIVE students → response.
// ACCESS : UNIVERSITY_ADMIN (any section) · FACULTY (sections they teach)
// BACKEND: Prisma
// PURPOSE: Supply the register for ONE class — the students a lecturer is about
//          to mark attendance for.
//
// WHY THIS EXISTS ALONGSIDE GET /api/students
//   /api/students is the institution-wide roster and is UNIVERSITY_ADMIN-only.
//   The attendance-marking screen needs one section's register, and a lecturer
//   could not read it, so the register rendered empty. This endpoint answers
//   that one question and nothing more; /api/students is untouched.
//
//   It is deliberately NARROWER than /api/students in three ways at once:
//
//     SCOPE   one section, never the institution. sectionId is a path segment,
//             not an optional filter, so there is no "omit it and get
//             everything" shape to reach for.
//     COLUMNS five fields — see ROSTER_STUDENT_SELECT. No programme, batch,
//             specialisation, semester, admission or graduation dates.
//     ROWS    ACTIVE students only. A withdrawn or graduated student is not on
//             a register, and marking them present would be a false record.
//
// courseId IS REQUIRED, AND THAT IS AUTHORISATION RATHER THAN FILTERING
//   It does not narrow the rows — every student in the section is on the
//   register regardless of course. It is required because a lecturer's right to
//   this roster comes from teaching a COURSE to this SECTION, and the pair is
//   what the guard proves. Making it optional would leave a faculty caller with
//   nothing to prove and the check with nothing to check.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireSectionRosterAccess } from "@/lib/middleware/requireSectionRosterAccess";
import { sectionIdParamSchema } from "@/lib/validations/section";
import { sectionRosterQuerySchema } from "@/lib/validations/sectionRoster";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns a register needs, and not one more.
 *
 * The name is reached through the User relation because Student carries no name
 * of its own — which is also why GET /api/students cannot serve this screen: it
 * selects Student columns only, so every row it returns is nameless and the
 * client fills firstName/lastName with empty placeholders. A register keyed on
 * enrollment number alone is not something a lecturer can take.
 *
 * status is reported so the caller can see WHY a roster is shorter than
 * expected; it is always ACTIVE given the filter below, and is carried anyway
 * rather than assumed, so a future widening of the filter cannot silently
 * change what the field means.
 */
const ROSTER_STUDENT_SELECT = {
  id: true,
  enrollmentNo: true,
  status: true,
  user: { select: { firstName: true, lastName: true } },
} as const;

// GET
// ACCESS     : UNIVERSITY_ADMIN reaches any section in their tenant. FACULTY
//              reaches ONLY a section they teach the named course to, proven by
//              requireSectionRosterAccess against Timetable or
//              FacultyCourseAssignment. No facultyId is accepted from the
//              client at any point — the caller's FacultyMember row is resolved
//              from the authenticated subject. Every other role is refused 403.
// VALIDATION : sectionIdParamSchema for the [id] segment — cuids, so non-empty
//              once trimmed is the only assertion; an unrecognised but
//              well-formed id is a 404, not a 400.
//              sectionRosterQuerySchema for ?courseId, which is REQUIRED. A
//              missing one is 400 VALIDATION_ERROR rather than a silent
//              institution-wide read.
// FLOW       : Guard → validate → read → respond.
//
//              The guard runs BEFORE the query is validated, deliberately.
//              Validation reports which field is malformed, and that is a
//              detail about the request that a caller with no right to this
//              section should not receive: a STUDENT probing this endpoint gets
//              403 whether or not their query was well-formed. The param is
//              parsed before the guard only because the guard needs the two ids
//              to do its work at all.
// RESPONSE   : { success: true, data: { roster } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              No pagination. A section's register is bounded by the size of a
//              class, which is the unit a human takes in one sitting; paging it
//              would let a lecturer submit a partial register believing it was
//              whole.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Route params resolve asynchronously in this Next.js version.
    const parsedParam = sectionIdParamSchema.safeParse(await params);
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

    const parsedQuery = sectionRosterQuerySchema.safeParse(
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

    const { id: sectionId } = parsedParam.data;
    const { courseId } = parsedQuery.data;

    // Role, tenant, section existence and — for a lecturer — proof that they
    // teach this exact pair. Everything below this line is reading, not
    // deciding.
    const guard = await requireSectionRosterAccess(sectionId, courseId);
    if (!guard.granted) return guard.response;

    const { tenantId } = guard.access;

    // tenantId is applied alongside sectionId rather than trusted from the
    // section lookup the guard performed: Student.sectionId carries a foreign
    // key but Student.tenantId is a plain column, so a row whose two columns
    // disagreed would otherwise be served to the wrong tenant.
    const students = await prisma.student.findMany({
      where: { tenantId, sectionId, status: "ACTIVE" },
      orderBy: [{ enrollmentNo: "asc" }, { id: "asc" }],
      select: ROSTER_STUDENT_SELECT,
    });

    // Flattened here rather than returned as a nested user object, so the shape
    // is exactly the five fields this endpoint promises and a caller cannot
    // reach a field that was never meant to be on a register.
    const roster = students.map((student) => ({
      studentId: student.id,
      enrollmentNo: student.enrollmentNo,
      firstName: student.user.firstName,
      lastName: student.user.lastName,
      status: student.status,
    }));

    return NextResponse.json(ok({ roster }));
  } catch (err) {
    console.error("[GET /api/sections/[id]/roster]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
