// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessments — Student Results
// FLOW   : Guard → tenant → param → resolve scope from the caller's own roles →
//          prove student ownership → published-only read → response.
// ACCESS : UNIVERSITY_ADMIN · FACULTY — any student in the tenant.
//          STUDENT — their own results only. PARENT is not implemented.
// BACKEND: Prisma
// PURPOSE: Return one student's published examination results within the
//          authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { studentIdParamSchema } from "@/lib/validations/student";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns returned for an examination result.
 *
 * The examination results route declares the same shape. It is restated here
 * rather than imported because a Next.js route module may only export route
 * handlers and segment config, so this constant cannot be shared from there.
 *
 * No relation is expanded. ExamResult carries real examination and student
 * relations, so those joins are possible and are simply not taken — the caller
 * already holds the studentId from the URL, and each row carries its
 * examinationId for the client to resolve through its own endpoint. This is a
 * flat operational list; the enriched, course-and-semester-expanded view of a
 * student's record is GET /api/students/[id]/transcript, which is a different
 * contract and is left untouched.
 *
 * There is no tenantId to report. ExamResult is one of only two models in the
 * schema that store tenant-owned data with no tenant column.
 *
 * marksObtained and gradePoint are Decimal columns. Prisma's Decimal defines its
 * own toJSON and serialises to a string, so the shared serialize() helper is not
 * needed — it exists for BigInt, which this model does not carry.
 */
const EXAM_RESULT_SELECT = {
  id: true,
  examinationId: true,
  studentId: true,
  marksObtained: true,
  grade: true,
  gradePoint: true,
  isPassed: true,
  isAbsent: true,
  remarks: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Built on the rejection path — existing FORBIDDEN code and 403 status. */
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
//
//              Scope is decided by asking requireRole twice rather than by
//              reading session.roles. The roles embedded in the token are a
//              snapshot from sign-in; requireRole resolves them live against
//              UserRole on every request precisely so a revoked role takes effect
//              immediately rather than at token expiry. The elevated check runs
//              first, so the common path costs one guard call and only a student
//              pays for a second. An anonymous caller fails both and receives
//              requireAuth's 401 from the second, so the fallback cannot turn a
//              401 into a 403.
// VALIDATION : studentIdParamSchema for the [id] segment — the same schema the
//              sibling transcript route uses for the same segment. Non-empty once
//              trimmed; Student.id is a cuid and therefore an opaque key, so an
//              unrecognised-but-well-formed id is a 404 rather than a 400.
//              paginationQuerySchema for ?page and ?limit, consumed directly as in
//              every other collection route. No filter parameter is defined.
// FLOW       : Authorise → resolve tenant → validate → establish which student the
//              caller may read → read one page of that student's published
//              results.
//
//              For an elevated caller the student is resolved tenant-scoped by the
//              requested id, and an unknown id and one owned by another tenant
//              return the identical 404, so no id is ever confirmed to exist
//              elsewhere.
//
//              For a STUDENT the direction is reversed: their own Student row is
//              resolved from session.sub through Student.userId, scoped to this
//              tenant, and the requested id is compared against it. The path
//              parameter is never trusted on its own and is never used to look
//              anything up for a student — it is only ever compared. A student
//              asking for any id but their own receives 403 whether that id
//              exists, belongs to another tenant, or exists nowhere at all, so the
//              endpoint discloses no student's existence to a student. The 404
//              path is therefore unreachable for a student by design; 403 strictly
//              precedes it. A caller holding STUDENT with no Student row in this
//              tenant is forbidden rather than served an empty list.
//
//              Tenant isolation runs through two independent filters. ExamResult
//              has no tenantId, so resolving the student establishes ownership of
//              the results. The examination is filtered on tenantId as well:
//              Examination.tenantId carries no foreign key, and nothing constrains
//              an ExamResult to join a student and an examination belonging to the
//              same tenant, so without that filter a mis-tenanted examination row
//              could surface another university's result inside this list. This is
//              the same defensive pairing the shipped transcript route applies.
//
//              Ordering is by id descending. ExamResult has no natural sort key —
//              no date of its own, and a bulk upload writes every row in one
//              transaction so createdAt is not discriminating — and id is unique,
//              so it supplies the total order offset pagination requires without
//              implying a meaning the data does not carry. Both predicates are
//              applied to the count as well as the page, so the total can never
//              describe a wider set than the caller can read.
// VISIBILITY : Only results whose publishedAt is set are returned, for every role
//              including UNIVERSITY_ADMIN. This is the approved visibility
//              predicate for the phase and the same rule the shipped transcript
//              applies to the same model. It is a filter on the query itself
//              rather than a check applied afterwards, so an unpublished result is
//              never read.
//
//              Note that no endpoint in the project currently sets publishedAt:
//              POST /api/examinations/[id]/results leaves it absent from both its
//              create and update payloads. Until a publication mechanism exists,
//              this endpoint returns an empty page for every student — which is
//              the correct behaviour of the specified filter, not a fault in it.
//              An unpublished-but-existing result set is therefore indistinguishable
//              here from no results at all, and deliberately so: nothing about an
//              unpublished mark leaks, not even its existence. Staff who need to
//              see unpublished results use GET /api/examinations/[id]/results,
//              which is the marking workspace.
// RESPONSE   : { success: true, data: { results, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              A student with no published results is a 200 with an empty array
//              and a total of zero, never a 404 — the student exists and is
//              readable; they simply have nothing published yet.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
      // results. An anonymous caller fails this too and receives requireAuth's
      // 401, so the fallback cannot downgrade a 401 into a 403.
      const studentGuard = await requireRole("STUDENT");
      if (!studentGuard.authorized) return studentGuard.response;

      session = studentGuard.session;
      isElevated = false;
    }

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsedParam = studentIdParamSchema.safeParse(await params);
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

    const studentId = parsedParam.data.id;
    const { page, limit } = parsedQuery.data;

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

    // publishedAt gates visibility for every role. The examination's tenant is
    // asserted alongside the student's because ExamResult carries no tenantId and
    // nothing constrains its two references to agree.
    const where = {
      studentId,
      publishedAt: { not: null },
      examination: { tenantId: tenant.id },
    };

    // Paired in one transaction so the total cannot shift between the two reads.
    const [results, total] = await prisma.$transaction([
      prisma.examResult.findMany({
        where,
        orderBy: [{ id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: EXAM_RESULT_SELECT,
      }),
      prisma.examResult.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        results,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/students/[id]/results]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
