// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Certificate Collection
// FLOW   : Guard → tenant → query → tenant-scoped page → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: List every certificate this university has issued.
//
// WHY THIS ROUTE EXISTS
//   Phase 12 shipped four certificate endpoints — issue, revoke, verify and the
//   per-student collection — but no tenant-wide one. The Certificates screen
//   needs exactly that ("every certificate this university has issued"), so it
//   called /api/certificates anyway and received Next.js's 404. The service
//   then converted that failure into an empty success, and the screen reported
//   "None issued yet" to universities that had issued certificates. The read
//   the screen was already making is the read this route answers.
//
// ACCESS MATCHES THE REST OF THE MODULE, AND IS NOT WIDER
//   UNIVERSITY_ADMIN alone, exactly as GET /api/students/[id]/certificates and
//   GET /api/certificate-templates are guarded. No role gains anything here
//   that it could not already obtain by walking the per-student route, and a
//   collection that spans every student is if anything the more sensitive of
//   the two. The public verification endpoint is unaffected: it is keyed on a
//   certificate number and stays unauthenticated.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { listCertificatesQuerySchema } from "@/lib/validations/certificate";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns returned for a certificate.
 *
 * Identical to CERTIFICATE_SELECT in POST /api/certificates/issue, GET
 * /api/certificates/verify/[certNo] and GET /api/students/[id]/certificates, so
 * a certificate looks the same wherever it is read. Restated rather than shared
 * because a Next.js route module may only export route handlers and segment
 * config — the same reason the other three restate it.
 *
 * No relation is expanded, following the project's collection-route convention.
 * The student is NOT embedded here even though this collection spans many
 * students and their names would be useful on screen: taking that join would
 * make this one route answer in a shape no other certificate route does, and
 * the screen's own "Issued to" column already renders an em dash for the same
 * reason on the per-student route. That gap is pre-existing and is left as it
 * is rather than resolved differently in one place.
 *
 * The revocation columns are reported because they are columns of the row. A
 * revoked certificate is listed exactly like any other and the caller reads
 * isRevoked to decide what that means.
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
// helper is not applied. data is Json and serialises as itself; the DateTime
// columns carry their own toJSON.

// GET
// ACCESS     : UNIVERSITY_ADMIN. Every other role receives requireRole's 403 and
//              an anonymous caller requireAuth's 401, unchanged from the rest of
//              the module.
// VALIDATION : listCertificatesQuerySchema — ?page, ?limit on the shared
//              contract, plus an optional ?q. An unknown parameter is dropped by
//              Zod exactly as it is on every other collection; a malformed page
//              or limit is the same 400 VALIDATION_ERROR.
// FLOW       : Authorise → resolve tenant → validate query → read one page and
//              the total in a single transaction.
//
//              tenantId is taken from requireTenant and never from the request.
//              It is applied to the page AND to the count, so the total can
//              never describe a wider set than the rows — and no certificate
//              belonging to another university is reachable through this route
//              under any query.
//
//              Ordering is createdAt desc then id desc, matching the per-student
//              collection. The id tiebreaker is required for correctness rather
//              than presentation: certificates issued in one batch share a
//              createdAt, and offset pagination over a non-deterministic order
//              repeats or skips rows between pages.
// RESPONSE   : { success: true, data: { certificates, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              A university that has issued nothing is an empty page with total
//              0 — a true statement, and the one this route now lets the screen
//              distinguish from "the request failed".
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const { tenant } = tenantGuard;

    const parsedQuery = listCertificatesQuerySchema.safeParse(
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

    const { page, limit, q } = parsedQuery.data;

    // The tenant predicate is never optional and never overridable. The search
    // narrows within it and can only ever remove rows from an already
    // tenant-scoped set.
    const where = {
      tenantId: tenant.id,
      ...(q ? { certificateNo: { contains: q, mode: "insensitive" as const } } : {}),
    };

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
    console.error("[GET /api/certificates]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
