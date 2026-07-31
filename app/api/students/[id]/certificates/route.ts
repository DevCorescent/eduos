// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Student Certificate List
// FLOW   : Guard → tenant → param → query → prove the student belongs to this
//          tenant → student-scoped paginated read → response.
// ACCESS : UNIVERSITY_ADMIN only. FACULTY, STUDENT and PARENT have no access —
//          notably a STUDENT cannot read even their own certificates here, which
//          is the access rule as given and is not widened.
// BACKEND: Prisma
// PURPOSE: List one student's issued certificates within the authenticated
//          tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { certificateIdParamSchema } from "@/lib/validations/certificate";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns returned for a certificate. Identical to CERTIFICATE_SELECT in
 * POST /api/certificates/issue and GET /api/certificates/verify/[certNo], so a
 * certificate looks the same wherever it is read.
 *
 * No relation is expanded, following the project's collection-route convention.
 * Certificate declares template and student relations and neither is taken: the
 * template is not read at all, so no markup enters this request, and the student
 * is not embedded even though the endpoint is keyed on them — the caller already
 * holds the studentId from the URL and every row carries the same one.
 *
 * The revocation columns are reported because they are columns of the row. They
 * are not acted on: a revoked certificate appears in the list exactly like any
 * other, and the caller reads isRevoked to decide what that means.
 */
const CERTIFICATE_SELECT = {
  id: true,
  tenantId: true,
  templateId: true,
  studentId: true,
  certificateNo: true,
  type: true,
  data: true,
  issuedAt: true,
  expiresAt: true,
  pdfUrl: true,
  qrCode: true,
  isRevoked: true,
  revokedAt: true,
  revokedBy: true,
  createdAt: true,
} as const;

// Certificate holds no BigInt and no Decimal column, so the shared serialize()
// helper is not applied here. data is Json and serialises as itself; the DateTime
// columns carry their own toJSON.

// GET
// ACCESS     : UNIVERSITY_ADMIN only. A single requireRole call decides access,
//              matching every other Phase 12 route. No elevated-first two-tier
//              logic appears here, unlike GET /api/students/[id]/fee-demands: no
//              second role is permitted, so there is no second scope to define
//              and no self-access branch to build. A caller holding FACULTY,
//              STUDENT or PARENT receives the guard's 403 — including a student
//              asking for their own certificates.
// VALIDATION : certificateIdParamSchema for the [id] segment, which must be
//              non-empty once trimmed. The segment is a Student id rather than a
//              Certificate id; the schema is reused because it is the shape this
//              file was specified to use and because it is the identical
//              contract — a trimmed, non-empty, opaque key with no format
//              asserted. Asserting a shape would turn an
//              unrecognised-but-well-formed id into a 400 where 404 is accurate.
//
//              paginationQuerySchema — ?page (default 1) and ?limit (default 20,
//              max 100). The shared contract is consumed directly rather than
//              through a module-local alias, exactly as in the timetable,
//              attendance, assignment, examination, finance and
//              certificate-template routes.
//
//              No filter parameter is read, because the README documents none for
//              any Phase 12 endpoint. A supplied ?type, ?isRevoked or ?expired is
//              ignored rather than honoured or rejected, which is what a plain
//              z.object() does with an unknown key.
// FLOW       : Authorise → resolve tenant → validate param → validate query →
//              prove the student belongs to this tenant → read one page of that
//              student's certificates alongside the total in one transaction.
//
//              The student is resolved tenant-scoped by the requested id, so an
//              unknown id and one owned by another tenant return the identical
//              404 and no id is ever confirmed to exist elsewhere. That lookup is
//              the only unrelated model this route touches, and it reads nothing
//              but the id — it exists to answer "is this student mine?", not to
//              enrich the response.
//
//              The certificate query filters on tenantId AND studentId together,
//              not on studentId alone. The tenant predicate is not redundant with
//              the ownership check above: Certificate.tenantId carries a foreign
//              key to Tenant but nothing in the schema ties a certificate's
//              tenantId to the tenant of the student it points at, so a row whose
//              two columns disagreed would otherwise be served to the wrong
//              tenant. Both predicates back the count as well as the page, so the
//              total can never describe a wider set than the caller may read.
//
//              A student with no certificates is a valid, owned student who has
//              simply not been issued one — an empty page with total 0, never a
//              404. The 404 belongs to the student lookup alone.
//
//              Ordering is by createdAt then id, both descending — newest first,
//              the project's standard collection ordering. It is required for
//              correctness rather than presentation: offset pagination over an
//              unordered result can repeat or skip rows across pages, and
//              certificates written in one batch can share a createdAt timestamp,
//              leaving createdAt alone non-deterministic. issuedAt is not used as
//              the sort key: it is a separate column that happens to agree with
//              createdAt today, and the standard ordering is the one specified.
// REPORTS    : Every certificate the student holds, exactly as stored. Nothing is
//              filtered and nothing is derived. Revoked certificates are included
//              and reported with isRevoked true; expired certificates are
//              included and reported with their past expiresAt. No expiry is
//              compared to now, no validity is computed, and no valid, isValid,
//              status or isExpired field is invented — the schema defines no such
//              concept and the README states none. No aggregate, count by type or
//              latest-per-type is produced.
//
//              Nothing is rendered. No template is read, no PDF is produced and no
//              QR code is generated; pdfUrl and qrCode are reported exactly as
//              stored, NULL included.
// RESPONSE   : { success: true, data: { certificates, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              This handler performs no writes of any kind.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsedParam = certificateIdParamSchema.safeParse(await params);
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

    // findFirst rather than findUnique: the tenant filter is part of the lookup,
    // so another tenant's student can never be resolved or even acknowledged.
    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!student) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    // Both predicates together — the student's own id and the authenticated
    // tenant — so a row whose two columns disagreed is unreachable.
    const where = { tenantId: tenant.id, studentId };

    // Paired in one transaction so the total cannot shift between the two reads.
    const [certificates, total] = await prisma.$transaction([
      prisma.certificate.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: CERTIFICATE_SELECT,
      }),
      prisma.certificate.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        certificates,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/students/[id]/certificates]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
