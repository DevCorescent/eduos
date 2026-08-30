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
import { requireModule } from "@/lib/middleware/requireModule";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { issueCertificateSchema } from "@/lib/validations/certificate";
import { generateIdentifier } from "@/lib/services/identifier.service";
import { recordAudit } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { AppError } from "@/lib/errors/AppError";
import { handleRouteError } from "@/lib/utils/api-response";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";
// PHASE 27 student event "Certificate Issued". Emitted after commit.
import {
  findStudentUserId,
  notificationEmitter,
  notifyAfterCommit,
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

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

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
        // htmlTemplate/cssStyles/version are read so the design can be
        // SNAPSHOT onto the certificate — see the create below.
        select: { id: true, htmlTemplate: true, cssStyles: true, version: true },
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
    // PRD §9 / §19.3 — the identifier engine issues certificateNo when the
    // caller omits it.
    //
    // certificateNo carries a GLOBAL unique constraint, not a tenant-scoped
    // one, because the number is quoted publicly at the verification endpoint
    // and must identify one certificate across the whole platform. That makes
    // the configured prefix load-bearing: two institutions whose sequences both
    // render "CERT-2026-000001" will collide on the second issue. The engine
    // cannot prevent that on its own, so the configuration screen warns, and
    // the constraint answers 409 rather than letting a duplicate through.
    //
    // Generated inside the transaction, so a failed issue leaves no gap in a
    // series an auditor may later have to account for.
    // One actor for both entries this request writes — the number issued and
    // the certificate issued — so they are findable together.
    const actor = {
      userId: guard.session.sub,
      ...readRequestOrigin(request.headers),
    };

    const certificate = await prisma.$transaction(async (tx) => {
      const certificateNo =
        scalars.certificateNo ??
        (await generateIdentifier(
          { tenantId: tenant.id, entityType: "CERTIFICATE", actor },
          tx
        ));

      const created = await tx.certificate.create({
        data: {
          ...scalars,
          certificateNo,
          data: data as Prisma.InputJsonValue | undefined,
          // The design, frozen at this instant. An official document must not
          // change afterwards, and rendering from templateId would mean a
          // redesign in 2027 silently rewrote a certificate issued today.
          // Versioning keeps the history readable; THIS is what makes the
          // document itself immutable.
          templateSnapshot: {
            version: template.version,
            html: template.htmlTemplate,
            css: template.cssStyles,
          } as Prisma.InputJsonValue,
          tenantId: tenant.id,
        },
        select: CERTIFICATE_SELECT,
      });

      // PRD §47 "Certificate generation logs" — named explicitly in the PRD's
      // audit list, and the one entry here most likely to be produced in
      // evidence: a certificate is a public claim about a person.
      await recordAudit(
        {
          tenantId: tenant.id,
          actor,
          action: AUDIT_ACTIONS.CERTIFICATE_ISSUED,
          resource: AUDIT_RESOURCES.CERTIFICATE,
          resourceId: created.id,
          after: {
            certificateNo: created.certificateNo,
            type: created.type,
            studentId: created.studentId,
          },
        },
        tx
      );

      return created;
    });

        // PHASE 27 student event "Certificate Issued".
    //
    // After the certificate row exists, throwing nothing. Addressed to the
    // student it was issued to, resolved Student -> User because a notification
    // reaches a person rather than an enrolment.
    await notifyAfterCommit("POST /api/certificates/issue", async () => {
      await notificationEmitter.certificateIssued({
        tenantId: tenant.id,
        studentUserId: await findStudentUserId(tenant.id, certificate.studentId),
        certificateType: certificate.type,
        certificateNo: certificate.certificateNo,
        certificateId: certificate.id,
      });
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

    // An AppError carries a message written for the caller and a status that
    // says what to do about it. The identifier engine raises one when the
    // institution has no CERTIFICATE sequence configured — a setting an
    // administrator can fix in a minute — and flattening that to "Internal
    // server error" sent them looking for a fault that does not exist.
    if (err instanceof AppError) {
      return handleRouteError("POST /api/certificates/issue", err);
    }

    console.error("[POST /api/certificates/issue]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
