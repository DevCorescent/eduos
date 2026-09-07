// ============================================================================
// MODULE : Results — Student selector
// FLOW   : Guard → tenant → apply the caller's result-reading scope → list the
//          students they may already read a transcript for.
// ACCESS : requireResultAccess — the SAME boundary the transcript itself uses.
// BACKEND: Prisma
// PURPOSE: Let a caller who may read transcripts choose WHOSE transcript to
//          read.
//
// WHY THIS EXISTS — tester issue #48
//   "Select a Student shows no list for the Controller of Examination, and the
//   same list loads for the head of department."
//
//   It did, and the cause was a genuine gap in the product rather than a wiring
//   fault. The Transcript screen filled its picker from GET /api/students,
//   which is STUDENT_READ_ROLES — [UNIVERSITY_ADMIN, DEPARTMENT_HOD]. The
//   examination office is deliberately absent from that set:
//   lib/api-department-scope.test.ts asserts the exclusion in as many words,
//   calling it "the boundary the locked decision draws", because the student
//   REGISTRY carries admission dates, programmes, sections and personal
//   records that examinations have no business reading.
//
//   But the COE may already read any student's TRANSCRIPT
//   (RESULT_READ_ANY_ROLES), and already sees every enrolment number in a
//   cohort through Semester Results. So the office held the permission to read
//   the document and no permitted way to name its subject.
//
// WHY NOT ADD THE COE TO STUDENT_READ_ROLES
//   That would hand the examination office the whole student registry to solve
//   a picker, and would delete a boundary a test exists to protect. This route
//   grants strictly less: three columns, gated on the permission the caller
//   already holds for the thing they are choosing.
//
// WHY THE SCOPE IS REUSED RATHER THAN RESTATED
//   requireResultAccess already answers "how much of the tenant may this caller
//   read results for", and result.service.requireStudent already applies it per
//   student. This route applies the same three cases to a LIST, so the picker
//   can never offer a student whose transcript would then be refused — the
//   selector and the document agree by construction:
//
//     ANY        — examination office and administrator: the tenant.
//     DEPARTMENT — a head: their own department's students, and no others.
//     OWN        — a student: themselves, and nobody else.
//
// SECURITY: the tenant comes from requireTenant, never from the query string,
//           and the department id comes from the authenticated subject through
//           resolveDepartmentScope. No client input reaches the predicate at
//           all — this route accepts no parameters.
// ============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireResultAccess } from "@/lib/middleware/requireResultAccess";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { programmeIdsForDepartment } from "@/lib/auth/departmentScope";
import { ok, fail } from "@/types";

/**
 * How many students a picker will offer.
 *
 * A ceiling, not a page size: the response is deliberately unpaginated because
 * a <select>'s option list is read whole, and the three columns below are small
 * enough that a large cohort is still a modest payload. A tenant that outgrows
 * this needs a searching picker, which is a different control.
 */
const MAX_OPTIONS = 500;

/**
 * The three columns a picker needs, and nothing else.
 *
 * Deliberately NARROWER than STUDENT_SELECT on /api/students, which returns the
 * programme, batch, section, specialisation, current semester, admission and
 * graduation dates. None of that is needed to choose a name from a list, and
 * returning it here would rebuild the registry response this route exists to
 * avoid.
 *
 * The name comes from the linked User — Student carries none — which is what
 * lets the picker show "Asha Rao — 2021CS001" rather than an id.
 */
const SELECTOR_SELECT = {
  id: true,
  enrollmentNo: true,
  user: { select: { firstName: true, lastName: true, displayName: true } },
} as const;

// GET
// ACCESS     : requireResultAccess. The examination office and administrators
//              see the tenant; a head sees their own department; a student sees
//              only themselves.
// VALIDATION : none, because there is nothing to validate — this route accepts
//              no query parameters and no body. That is deliberate: with no
//              client input there is no filter for a forged value to widen.
// FLOW       : Authorise → resolve tenant → build the predicate from the
//              caller's own scope → read → shape.
// RESPONSE   : { success: true, data: { students: [{ id, name, enrollmentNo }] } }
// STATUS     : 200 OK · 401 UNAUTHORIZED · 403 FORBIDDEN · 500 SERVER_ERROR
export async function GET() {
  try {
    const guard = await requireResultAccess();
    if (!guard.granted) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const tenantId = tenantGuard.tenant.id;
    const { access } = guard;

    // The tenant predicate LEADS every branch, so no scope can reach another
    // institution's students.
    let where: Prisma.StudentWhereInput = { tenantId };

    if (access.scope === "OWN") {
      // A student picks themselves or nobody. Matched on userId — the
      // authenticated subject — rather than on any id supplied by the caller.
      where = { tenantId, userId: access.userId };
    } else if (access.scope === "DEPARTMENT") {
      // The same rule result.service.requireStudent applies per student, applied
      // here to the list: a head's department owns the student's PROGRAMME.
      //
      // An empty array is applied rather than skipped, and a null programmeId is
      // excluded rather than admitted — "unowned" must not read as "permitted",
      // exactly as that service and the students listing both document.
      const programmeIds = await programmeIdsForDepartment(tenantId, access.departmentId);
      where = { tenantId, programmeId: { in: programmeIds } };
    }

    const students = await prisma.student.findMany({
      where,
      orderBy: [{ enrollmentNo: "asc" }, { id: "asc" }],
      take: MAX_OPTIONS,
      select: SELECTOR_SELECT,
    });

    return NextResponse.json(
      ok({
        students: students.map((student) => ({
          id: student.id,
          enrollmentNo: student.enrollmentNo,
          // displayName wins when a tenant sets one, matching how the rest of
          // the product names a person. Trimmed so a missing surname does not
          // leave a trailing space, and falling back to the enrolment number
          // rather than an empty label, which would render a blank option.
          name:
            student.user.displayName?.trim() ||
            `${student.user.firstName} ${student.user.lastName}`.trim() ||
            student.enrollmentNo,
        })),
      })
    );
  } catch (err) {
    console.error("[GET /api/results/students]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
