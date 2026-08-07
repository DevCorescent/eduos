// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Certificate Issuance
// FLOW   : Guard → tenant → body → tenant-scoped reference checks → create one
//          certificate → response.
// ACCESS : UNIVERSITY_ADMIN only. FACULTY, STUDENT and PARENT cannot issue
//          certificates.
// BACKEND: Prisma
// PURPOSE: Record one issued certificate for a student of the authenticated
//          tenant, from a template of that same tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { issueCertificateSchema } from "@/lib/validations/certificate";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";
// PHASE 27 student event "Certificate Issued". Emitted after commit.
import {
  findStudentUserId,
  notificationEmitter,
} from "@/lib/controllers/notificationEmitter.controller";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

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

export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = issueCertificateSchema.safeParse(body);
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

    const { data, ...scalars } = parsed.data;

    // Two independent reads, so they are issued together rather than in
    // sequence. Both are tenant-scoped, so another tenant's template or student
    // can never be referenced or even acknowledged.
    const [template, student] = await Promise.all([
      prisma.certificateTemplate.findFirst({
        where: { id: scalars.templateId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.student.findFirst({
        where: { id: scalars.studentId, tenantId: tenant.id },
        select: { id: true },
      }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first. The order follows the schema's column order.
    if (!template) {
      return NextResponse.json(fail("Certificate template not found", "NOT_FOUND"), { status: 404 });
    }

    if (!student) {
      return NextResponse.json(fail("Student not found", "NOT_FOUND"), { status: 404 });
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context, never from the request body. The
    // scalars spread carries only the keys the body actually supplied, so an
    // omitted expiresAt, pdfUrl or qrCode is absent rather than undefined, and
    // issuedAt, isRevoked and createdAt are never mentioned at all so their
    // database defaults stand. The JSON column is cast at this boundary because
    // Zod infers an unknown-valued record, which Prisma's InputJsonValue does not
    // accept directly.
    const certificate = await prisma.certificate.create({
      data: {
        ...scalars,
        data: data as Prisma.InputJsonValue | undefined,
        tenantId: tenant.id,
      },
      select: CERTIFICATE_SELECT,
    });

        // PHASE 27 student event "Certificate Issued".
    //
    // After the certificate row exists, throwing nothing. Addressed to the
    // student it was issued to, resolved Student -> User because a notification
    // reaches a person rather than an enrolment.
    await notificationEmitter.certificateIssued({
      tenantId: tenant.id,
      studentUserId: await findStudentUserId(tenant.id, certificate.studentId),
      certificateType: certificate.type,
      certificateNo: certificate.certificateNo,
      certificateId: certificate.id,
    });

    return NextResponse.json(ok(certificate, "Certificate issued"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // certificateNo is already in use. The constraint is global rather than
      // tenant-scoped, so the number may belong to another tenant — which is why
      // the message names the number rather than confirming who holds it.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(fail("Certificate number already in use", "CONFLICT"), {
          status: 409,
        });
      }
      // The referenced template or student was deleted between its check and the
      // insert, so the foreign key rejected the reference.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(fail("Certificate template not found", "NOT_FOUND"), {
          status: 404,
        });
      }
    }

    console.error("[POST /api/certificates/issue]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
