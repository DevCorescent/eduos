// ============================================================================
// OWNER  : Gauransh
// MODULE : Question Paper & Solution Repository (Phase 26)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate query → controller → response.
// ACCESS : EXAM_RESOURCE_STUDENT_ROLES — STUDENT only.
// BACKEND: examResourceController → ExamResourceService → exam-resources
//          visibility domain → ExamResourceRepository → Prisma.
// PURPOSE: The README's student repository — "View Question Papers", "Previous
//          Year Question Papers", "Resource Search", "Semester-wise Resources"
//          and "Subject-wise Resources".
//
// A STUDENT SEES ONLY THEIR REGISTERED COURSES
//   The caller is resolved from session.sub to their own Student row, and the
//   courses they are registered for become the confinement for every query.
//   The registration statuses that count come from Phase 16's own
//   REPORTABLE_REGISTRATION_STATUSES rather than a second list — that question
//   was answered once and is not re-answered here.
//
//   PAST SEMESTERS REMAIN VISIBLE, deliberately. "Previous Year Question
//   Papers" is a listed feature, and confining a student to their CURRENT
//   semester would make it unimplementable.
//
//   A student naming a course they are not registered for receives an empty
//   result rather than an error — an error would confirm the course exists.
//
// THE VISIBILITY PREDICATE IS APPLIED IN SQL
//   A student-facing page must not transfer rows it will then discard: a draft
//   answer key that reaches the process is one refactor away from reaching the
//   response. The predicate is built from the same rule the domain module
//   states, and every returned row is re-checked before mapping.
//
// NO fileUrl IN THIS RESPONSE
//   The download location is served only by the dedicated download endpoint, so
//   a list cannot be scraped for every paper's URL in one request.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { examResourceController } from "@/lib/controllers/examResource.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { EXAM_RESOURCE_STUDENT_ROLES } from "@/lib/constants/examResource";
import { studentExamResourceQuerySchema } from "@/lib/validations/examResource.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/students/me/exam-resources";

// GET
// ACCESS     : requireRole(STUDENT) then requireTenant, in that order — an
//              unauthenticated caller receives 401 and a wrongly-roled one 403
//              without the tenant lookup happening at all.
// VALIDATION : studentExamResourceQuerySchema, .strict(). Optional courseId,
//              semesterId, type, academicYear and `q`, plus pagination.
//
//              There is deliberately NO `status` filter: a student sees
//              published-and-due resources and nothing else, and offering the
//              parameter would imply a draft could be requested.
// FLOW       : Guard → validate → controller.
//
//              Ordering is academicYear, then createdAt, then id — all
//              descending. Newest year first is what a student browsing
//              previous papers wants, and the id tiebreaker keeps offset
//              pagination from repeating or skipping rows.
// REPORTS    : Title, type, course, semester, academic year, file name, size,
//              MIME type and whether an HOD has verified it. Verification is a
//              quality SIGNAL, not a gate — the README lists HOD verification
//              and HOD publication as separate capabilities.
// RESPONSE   : { success: true, data: { resources, pagination } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
//              This handler performs no writes of any kind.
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole(...EXAM_RESOURCE_STUDENT_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsed = studentExamResourceQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) return validationFailure(parsed.error);

    const result = await examResourceController.listForStudent(
      tenantGuard.tenant.id,
      guard.session.sub,
      parsed.data,
      new Date()
    );

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
