// ============================================================================
// OWNER  : Gauransh
// MODULE : Students — Student Transcript
// FLOW   : Guard → tenant → params → load student (tenant-scoped) → read
//          published exam results → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Return a student's academic record as published examination results,
//          within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { studentIdParamSchema } from "@/lib/validations/student";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * The student record heading the transcript.
 *
 * Student scalars only — the linked User is not joined, so the response carries
 * userId rather than the student's name. Neither the README nor the schema
 * specifies a transcript header, so no relation is expanded beyond what the
 * Student row itself holds.
 */
const STUDENT_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  enrollmentNo: true,
  programmeId: true,
  batchId: true,
  sectionId: true,
  specialisationId: true,
  currentSemester: true,
  status: true,
  admissionDate: true,
  graduationDate: true,
} as const;

/**
 * Columns read for each transcript line.
 *
 * Course.credits is included deliberately. The transcript reports no aggregate
 * of its own, so a client computing a weighted average needs the credit value
 * alongside each gradePoint. Note that this is the flat per-course figure:
 * CurriculumSubject.credits cannot be reached, because nothing in the schema
 * records which Curriculum version applies to a given student.
 *
 * marksObtained and gradePoint are Decimal columns. Prisma's Decimal defines its
 * own toJSON and serialises to a string, so the shared serialize() helper is not
 * needed — it exists for BigInt, which none of these models carry. As elsewhere,
 * the string form is normalised, so a stored 8.50 is returned as "8.5".
 */
const RESULT_SELECT = {
  id: true,
  marksObtained: true,
  grade: true,
  gradePoint: true,
  isPassed: true,
  isAbsent: true,
  remarks: true,
  publishedAt: true,
  examination: {
    select: {
      id: true,
      title: true,
      type: true,
      date: true,
      maxMarks: true,
      passMark: true,
      course: {
        select: { id: true, code: true, name: true, type: true, credits: true },
      },
      semester: {
        select: { id: true, name: true, semesterNumber: true, academicYearId: true },
      },
    },
  },
} as const;

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : studentIdParamSchema — the [id] segment must be non-empty once
//              trimmed. No body and no query parameters are read.
// FLOW       : Authorise → resolve tenant → confirm the student belongs to this
//              tenant (404 otherwise) → read that student's published results.
//
//              The contract implemented here is the one confirmed for this
//              endpoint, because neither the README nor the schema defines it:
//                - No aggregate is computed. No GPA or CGPA field is returned;
//                  the raw gradePoint and Course.credits are supplied so a
//                  client may derive one. No weighting formula exists in any
//                  source, and the missing Student-to-Curriculum link means a
//                  credit-weighted figure could not be derived deterministically
//                  even if a formula did.
//                - Only published results appear: publishedAt must be set, so
//                  provisional marks are excluded from the record.
//                - Every ExaminationType appears, each row carrying its own type
//                  so the reader can tell an END_TERM from a SUPPLEMENTARY.
//                - Every attempt appears and none is marked authoritative. A
//                  course examined twice yields two rows; no latest-supersedes
//                  or best-counts rule is applied, because none is stated
//                  anywhere.
//
//              Tenant isolation runs through two independent filters. ExamResult
//              has no tenantId, so resolving the student establishes ownership of
//              the results. The examination is filtered on tenantId as well:
//              Examination.tenantId carries no foreign key, and nothing
//              constrains an ExamResult to join a student and an examination
//              belonging to the same tenant, so without that filter a
//              mis-tenanted examination row could surface course and semester
//              detail from another university inside this transcript.
//
//              The response is not paginated. The README describes a full
//              academic transcript, and a partial one would not be that; the row
//              count is bounded by the examinations a single student has sat.
//
//              Ordering is the one element no source defines, and a response
//              needs a deterministic one or pagination-free output would still
//              vary between calls. Results are ordered by semester number, then
//              examination date, then result id — chronological academic order,
//              with the id ensuring two examinations sharing a date cannot swap
//              positions between requests.
// RESPONSE   : { success: true, data: { student, results } }
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
    const parsed = studentIdParamSchema.safeParse(await params);
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

    const studentId = parsed.data.id;

    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId: tenant.id },
      select: STUDENT_SELECT,
    });

    if (!student) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    const rows = await prisma.examResult.findMany({
      where: {
        studentId,
        publishedAt: { not: null },
        examination: { tenantId: tenant.id },
      },
      orderBy: [
        { examination: { semester: { semesterNumber: "asc" } } },
        { examination: { date: "asc" } },
        { id: "asc" },
      ],
      select: RESULT_SELECT,
    });

    // The examination wrapper is unwrapped so each line reads as one assessment:
    // its own marks and grade alongside the course and semester it belongs to.
    // Nothing is computed here — every value is a stored column.
    const results = rows.map((row) => ({
      id: row.id,
      marksObtained: row.marksObtained,
      maxMarks: row.examination.maxMarks,
      passMark: row.examination.passMark,
      grade: row.grade,
      gradePoint: row.gradePoint,
      isPassed: row.isPassed,
      isAbsent: row.isAbsent,
      remarks: row.remarks,
      publishedAt: row.publishedAt,
      examination: {
        id: row.examination.id,
        title: row.examination.title,
        type: row.examination.type,
        date: row.examination.date,
      },
      course: row.examination.course,
      semester: row.examination.semester,
    }));

    return NextResponse.json(ok({ student, results }));
  } catch (err) {
    console.error("[GET /api/students/[id]/transcript]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
