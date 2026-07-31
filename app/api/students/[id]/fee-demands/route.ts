// ============================================================================
// OWNER  : Gauransh
// MODULE : Finance — Student Fee Ledger
// FLOW   : Guard → tenant → param → query → resolve scope from the caller's own
//          roles → prove student ownership → student-scoped paginated read →
//          response.
// ACCESS : UNIVERSITY_ADMIN · FACULTY — any student in the tenant.
//          STUDENT — their own ledger only. PARENT is not implemented.
// BACKEND: Prisma
// PURPOSE: Return one student's fee demands within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { studentIdParamSchema } from "@/lib/validations/student";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns returned for a fee demand in a student's ledger.
 *
 * Scalars only — no relation is expanded, following the project's
 * collection-route convention. FeeDemand declares student, semester,
 * feeStructure and payments relations; none is taken. The student is not
 * embedded even though this endpoint is keyed on them: the caller already holds
 * the studentId from the URL, and every row carries the same one.
 *
 * payments in particular is left alone. A demand accumulates one row per
 * payment, so nesting it would make a page unbounded — and summing it would be
 * the balance calculation this endpoint does not perform.
 *
 * totalAmount, paidAmount and waivedAmount are reported exactly as stored.
 * Nothing is derived from them: no outstanding balance, no payable amount, no
 * overdue figure and no total across rows. No source defines whether a balance is
 * total minus paid, total minus paid minus waived, or something else, so the
 * three columns are returned and the client applies whatever rule it holds.
 *
 * All three are Decimal columns. Prisma's Decimal defines its own toJSON and
 * serialises to a string, so the shared serialize() helper is not needed — it
 * exists for BigInt, which this model does not carry.
 */
const STUDENT_FEE_DEMAND_SELECT = {
  id: true,
  tenantId: true,
  studentId: true,
  semesterId: true,
  feeStructureId: true,
  dueDate: true,
  totalAmount: true,
  paidAmount: true,
  waivedAmount: true,
  status: true,
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
//              through to the STUDENT branch and is confined to their own ledger.
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
//              sibling transcript and results routes use for the same segment.
//              Non-empty once trimmed; Student.id is a cuid and therefore an
//              opaque key, so an unrecognised-but-well-formed id is a 404 rather
//              than a 400.
//
//              paginationQuerySchema for ?page and ?limit, consumed directly as
//              in every other collection route. No filter parameter is read: the
//              README names filters for GET /api/fee-demands — "filter by
//              student/semester" — and names none for this endpoint, which is
//              already scoped to one student by its path. A supplied ?semesterId
//              or ?status is stripped and ignored rather than honoured or
//              rejected.
// FLOW       : Authorise → resolve tenant → validate → establish which student
//              the caller may read → read one page of that student's demands.
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
//              the endpoint discloses no student's existence to a student. The
//              404 path is therefore unreachable for a student by design; 403
//              strictly precedes it. A caller holding STUDENT with no Student row
//              in this tenant is forbidden rather than served an empty ledger.
//
//              The demand query filters on tenantId AND studentId together, not
//              on studentId alone. The tenant predicate is not redundant with the
//              ownership check above: FeeDemand.tenantId carries no foreign key,
//              so nothing in the schema ties a demand to the student it points
//              at, and a row whose two columns disagreed would otherwise be
//              served to the wrong tenant. Both predicates are applied to the
//              count as well as the page, so the total can never describe a wider
//              set than the caller can read.
//
//              A student with no demands is a valid, owned student who has simply
//              not been billed — an empty page with total 0, never a 404.
//
//              Ordering is by dueDate then id, both descending, matching
//              GET /api/fee-demands. The id tiebreaker is required rather than
//              cosmetic: a generation run writes every demand of a batch with one
//              identical dueDate, so dueDate alone is not deterministic and
//              offset pagination over it could repeat or skip rows.
//
//              Nothing is computed. No balance, no payable amount, no overdue
//              figure, no aggregate across rows, no waiver applied, no payment
//              processed and no status transition — the endpoint reports stored
//              columns and nothing else.
// RESPONSE   : { success: true, data: { feeDemands, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
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
      // ledger. An anonymous caller fails this too and receives requireAuth's
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

    // The tenant predicate is asserted alongside the student's because
    // FeeDemand.tenantId carries no foreign key and nothing constrains the two
    // columns to agree. Both apply to the count as well as the page.
    const where = { tenantId: tenant.id, studentId };

    // Paired in one transaction so the total cannot shift between the two reads.
    const [feeDemands, total] = await prisma.$transaction([
      prisma.feeDemand.findMany({
        where,
        orderBy: [{ dueDate: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: STUDENT_FEE_DEMAND_SELECT,
      }),
      prisma.feeDemand.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        feeDemands,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/students/[id]/fee-demands]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
