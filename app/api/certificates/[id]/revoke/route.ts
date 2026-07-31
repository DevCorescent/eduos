// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Certificate Revocation
// FLOW   : Guard → tenant → param → tenant-scoped lookup → one guarded update →
//          response. No request body is read.
// ACCESS : UNIVERSITY_ADMIN only. FACULTY, STUDENT and PARENT cannot revoke a
//          certificate.
// BACKEND: Prisma
// PURPOSE: Mark one certificate of the authenticated tenant as revoked, stamping
//          who revoked it and when.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isRecordNotFound } from "@/lib/utils/prisma-errors";
import { certificateIdParamSchema } from "@/lib/validations/certificate";
import { ok, fail } from "@/types";

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

/** Built on the not-found path — existing NOT_FOUND code and 404 status. */
function certificateNotFound(): NextResponse {
  return NextResponse.json(fail("Certificate not found", "NOT_FOUND"), { status: 404 });
}

/**
 * Built when the certificate is already revoked.
 *
 * The code is ILLEGAL_STATE_TRANSITION rather than the CONFLICT used elsewhere,
 * matching POST /api/assignments/[id]/publish — the project's other one-way
 * transition. Revocation is not idempotent: re-revoking returns 409 rather than
 * 200, because revokedAt and revokedBy are audit facts and answering 200 on a
 * retry would either rewrite them or imply a change that did not happen.
 */
function alreadyRevoked(): NextResponse {
  return NextResponse.json(
    fail("Certificate is already revoked", "ILLEGAL_STATE_TRANSITION"),
    { status: 409 }
  );
}

// POST
// ACCESS     : UNIVERSITY_ADMIN only.
// VALIDATION : certificateIdParamSchema for the [id] segment. No request body is
//              read and no body schema exists: the transition is fully determined
//              by the endpoint, and all three revocation columns are derived
//              server-side, so a body schema would be dead code. Any body sent is
//              ignored rather than rejected — the same treatment
//              POST /api/assignments/[id]/publish gives one.
// FLOW       : Authorise → resolve tenant → validate param → confirm the
//              certificate belongs to this tenant (404 otherwise) → apply one
//              update scoped by id, tenantId and isRevoked: false.
//
//              An unknown id and a cross-tenant id return the identical 404, so
//              neither existence nor ownership is disclosed.
//
//              Exactly three columns are written. isRevoked becomes true;
//              revokedAt is the server clock, never accepted from a client; and
//              revokedBy is the authenticated user id taken from the session,
//              following Attendance.markedBy and Assignment.createdBy. No other
//              column is mentioned, so tenantId, issuedAt, certificateNo,
//              templateId, studentId, type, data, expiresAt, pdfUrl, qrCode and
//              createdAt all keep their stored values. Certificate declares no
//              updatedAt, so nothing else moves either.
//
//              isRevoked: false in the filter is both the un-revoke guard and the
//              concurrency guard. There is no path that sets isRevoked back to
//              false — the value is hard-coded true and no body can override it —
//              and if a concurrent request revoked the row between the lookup and
//              this write, no row matches, Prisma raises P2025, and the catch
//              reports the same 409. Exactly one caller can ever stamp a
//              certificate's revocation.
//
//              Nothing is created and nothing is deleted. No certificate is
//              issued, no PDF or QR code is produced, no template is read or
//              rendered, and no Student row is touched.
// RESPONSE   : { success: true, data: <Certificate>,
//                message: "Certificate revoked" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 403 FORBIDDEN
//              404 NOT_FOUND · 409 ILLEGAL_STATE_TRANSITION · 500 SERVER_ERROR
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { session } = guard;
    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsed = certificateIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const certificateId = parsed.data.id;

    // findFirst rather than findUnique: the tenant filter is part of the lookup,
    // so another tenant's certificate can never be resolved or even acknowledged.
    const existing = await prisma.certificate.findFirst({
      where: { id: certificateId, tenantId: tenant.id },
      select: { isRevoked: true },
    });

    if (!existing) {
      return certificateNotFound();
    }

    if (existing.isRevoked) {
      return alreadyRevoked();
    }

    // One statement, so all three columns move together and the transition is
    // atomic on its own — no transaction is warranted. isRevoked: false in the
    // filter is the concurrency guard: if another request revoked this
    // certificate between the lookup above and this write, no row matches and
    // Prisma raises P2025, which the catch below reports as the same 409.
    const certificate = await prisma.certificate.update({
      where: { id: certificateId, tenantId: tenant.id, isRevoked: false },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
        revokedBy: session.sub,
      },
      select: CERTIFICATE_SELECT,
    });

    return NextResponse.json(ok(certificate, "Certificate revoked"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // The guarded update matched nothing. The lookup already proved the row
      // existed, belonged to this tenant and was un-revoked, so the only thing
      // that can have changed in that window is isRevoked — a concurrent revoke
      // won the race. No delete endpoint exists for certificates, so the row
      // cannot have disappeared.
      if (isRecordNotFound(err)) {
        return alreadyRevoked();
      }
    }

    console.error("[POST /api/certificates/[id]/revoke]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
