// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance — Student Attendance Report
// FLOW   : Guard → tenant → param → resolve scope from the caller's own roles →
//          prove student ownership → student-scoped read → response.
// ACCESS : UNIVERSITY_ADMIN · FACULTY — any student in the tenant.
//          STUDENT — their own report only. PARENT is not implemented.
// BACKEND: Prisma
// PURPOSE: Return one student's attendance record within the authenticated
//          tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { attendanceStudentParamSchema } from "@/lib/validations/attendance";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns returned for an attendance record.
 *
 * The collection and detail routes declare the same shape. It is restated here
 * rather than imported because a Next.js route module may only export route
 * handlers and segment config, so this constant cannot be shared from either.
 *
 * No relation is expanded. Attendance carries three real relations — student,
 * section and faculty — so those joins are possible and are simply not taken. The
 * student in particular is not embedded even though this endpoint is keyed on
 * them: the caller already holds the studentId, and every row carries the same
 * one, so expanding it would repeat a known value on every row.
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
 * The 403 answered when a student asks for someone else's report.
 *
 * Built with the same message and code requireRole itself uses on its rejection
 * path, so a student who is out of scope receives a response indistinguishable
 * from one produced by the role guard. Nothing in it reveals whether the id they
 * asked about exists.
 */
function forbidden(): NextResponse {
  return NextResponse.json(fail("Forbidden", "FORBIDDEN"), { status: 403 });
}

// GET
// ACCESS     : UNIVERSITY_ADMIN · FACULTY · STUDENT, with different scope.
//
//              Role precedence is UNIVERSITY_ADMIN > FACULTY > STUDENT, so the
//              elevated pair is tested first and a caller holding either reads
//              any student in the tenant. Only a caller who holds neither falls
//              through to the STUDENT branch and is confined to their own record.
//              A caller holding STUDENT alongside an elevated role is treated as
//              elevated, which is what precedence means.
//
//              Scope is decided by asking requireRole twice rather than by
//              reading session.roles. The roles embedded in the token are a
//              snapshot from sign-in; requireRole resolves them live against
//              UserRole on every request precisely so a revoked role takes effect
//              immediately rather than at token expiry. Deciding scope from the
//              token would reintroduce exactly the staleness the guard exists to
//              prevent — a student promoted to faculty, or demoted from it, would
//              keep the old scope until their token expired. session.roles is
//              read nowhere in this project and is not read here.
//
//              The elevated check runs first so the common path costs one guard
//              call; only a caller who fails it pays for a second. An anonymous
//              caller fails both and receives requireAuth's 401 from the second,
//              which is the same 401 the first produced — the fallback cannot
//              turn a 401 into a 403.
// VALIDATION : attendanceStudentParamSchema — the [studentId] segment must be
//              non-empty once trimmed. Keyed on studentId rather than id because
//              that is the segment name and so the key Next.js supplies.
//              Student.id is a cuid, so no UUID assertion is applied — an
//              unrecognised-but-well-formed id is a 404 (or a 403 for a student),
//              not a 400.
//
//              No query parameters are read. No attendanceQuerySchema exists, and
//              none is invented here.
// FLOW       : Authorise → resolve tenant → validate param → establish which
//              student the caller may read → read that student's records.
//
//              For an elevated caller the student is resolved tenant-scoped by
//              the requested id, and an unknown id and one owned by another
//              tenant return the identical 404, so no id is ever confirmed to
//              exist elsewhere.
//
//              For a STUDENT the direction is reversed: their own Student row is
//              resolved from session.sub through Student.userId, scoped to this
//              tenant, and the requested id is compared against it. The path
//              parameter is never trusted on its own and is never used to look
//              anything up for a student — it is only ever compared. A student
//              asking for any id but their own receives 403 whether that id
//              exists, belongs to another tenant, or exists nowhere at all, so
//              the endpoint discloses no student's existence to a student. That
//              also means the 404 path is unreachable for a student by design;
//              403 strictly precedes it.
//
//              Student.userId is @unique and Student.tenantId scopes the lookup,
//              so the resolution is unambiguous. A caller holding STUDENT with no
//              Student row in this tenant is forbidden rather than served an
//              empty report.
//
//              The attendance query filters on tenantId AND studentId together,
//              not on studentId alone. The tenant predicate is not redundant with
//              the ownership check above: Attendance.tenantId carries no foreign
//              key, so nothing in the schema ties a record to the student it
//              points at, and a row whose two columns disagreed would otherwise
//              be served to the wrong tenant.
//
//              A student with no attendance is a valid, owned student who happens
//              to be unmarked — an empty array, never a 404.
//
//              Ordering is by date, then id, identical to the collection route:
//              most recent day first, with the id tiebreaker making the result
//              fully deterministic. Determinism is required rather than
//              cosmetic here — the response is not paginated, and an unordered
//              read can return the same rows in a different order between calls.
//              A single day carries many records that agree on date, so the
//              tiebreaker is load-bearing.
//
//              The response is not paginated. The README describes this endpoint
//              as a report on one student, matching the unpaginated
//              /api/students/[id]/transcript rather than the paginated
//              collections; no attendanceQuerySchema exists to define a page, and
//              inventing one here would settle a contract by accident. The row
//              count is bounded by one student's marked sessions, but it is not
//              bounded tightly — a student's record grows every teaching day and
//              is never pruned, so this response grows without limit over an
//              enrolment.
// REPORT     : Raw attendance rows only. No percentage, no denominator, no
//              counts by status, no grouping by course, no aggregation of any
//              kind. The README titles this endpoint "Attendance % per course",
//              but how that percentage is computed — specifically what its
//              denominator is — is an open decision, and the schema models no
//              scheduled-class or expected-session concept from which one could
//              be derived. Attendance rows record only what was marked, so a
//              denominator taken from them would measure marking diligence rather
//              than attendance. Only the portion whose behaviour is fully defined
//              is implemented; the raw rows are returned so a client can derive
//              whatever figure it needs, and the endpoint stays honest about what
//              the data supports.
// RESPONSE   : { success: true, data: { attendance } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              No conflict status is reachable and none is handled: this endpoint
//              performs no write.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  try {
    // Precedence: the elevated pair is tested first, so a caller holding either
    // never reaches the student branch.
    const elevatedGuard = await requireRole("UNIVERSITY_ADMIN", "FACULTY");

    let session;
    let isElevated: boolean;

    if (elevatedGuard.authorized) {
      session = elevatedGuard.session;
      isElevated = true;
    } else {
      // Not elevated — the caller may still be a student reading their own
      // report. An anonymous caller fails this too and receives requireAuth's
      // 401, so the fallback cannot downgrade a 401 into a 403.
      const studentGuard = await requireRole("STUDENT");
      if (!studentGuard.authorized) return studentGuard.response;

      session = studentGuard.session;
      isElevated = false;
    }

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsed = attendanceStudentParamSchema.safeParse(await params);
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

    const { studentId } = parsed.data;

    if (isElevated) {
      // findFirst rather than findUnique: the tenant filter is part of the
      // lookup, so another tenant's student can never be resolved or even
      // acknowledged.
      const student = await prisma.student.findFirst({
        where: { id: studentId, tenantId: tenant.id },
        select: { id: true },
      });

      if (!student) {
        return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
      }
    } else {
      // The path parameter is never used to look anything up here. The caller's
      // own Student row is resolved from their session and the requested id is
      // compared against it, so an id that is not theirs is forbidden whether or
      // not it exists.
      const self = await prisma.student.findFirst({
        where: { userId: session.sub, tenantId: tenant.id },
        select: { id: true },
      });

      if (!self || self.id !== studentId) {
        return forbidden();
      }
    }

    const attendance = await prisma.attendance.findMany({
      where: { tenantId: tenant.id, studentId },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: ATTENDANCE_SELECT,
    });

    return NextResponse.json(ok({ attendance }));
  } catch (err) {
    console.error("[GET /api/attendance/report/[studentId]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
