// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Public Certificate Verification
// FLOW   : Params → one lookup by certificate number → response. No guard, no
//          session, no tenant resolution.
// ACCESS : Public. No authentication, no role check and no tenant context. This
//          is the only unauthenticated read in the project, and it is public by
//          the README, which describes the endpoint as "Public verification by
//          cert number".
// BACKEND: Prisma
// PURPOSE: Answer whether a certificate number corresponds to an issued
//          certificate, and report that certificate as stored.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { certificateNumberParamSchema } from "@/lib/validations/certificate";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns returned for a certificate. Identical to CERTIFICATE_SELECT in
 * POST /api/certificates/issue, so a certificate looks the same wherever it is
 * read.
 *
 * No relation is expanded. The template and student relations exist and are
 * deliberately not joined: no template content is read, so nothing here can
 * render or leak markup, and no Student row is read, so no name, enrollment
 * number or personal record is reached. templateId and studentId are reported as
 * the ids the row stores, exactly as every other route in the project reports a
 * foreign key.
 *
 * The shape is not narrowed for the public setting. No rule in the schema or the
 * README defines what a verification response should contain, so choosing a
 * reduced projection would be inventing one — and choosing which columns are
 * "safe" is precisely the business decision this file must not make. The
 * consequence is recorded as technical debt rather than silently resolved here:
 * this endpoint publishes tenantId, studentId, templateId and the whole data
 * column to anyone holding a certificate number.
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ certNo: string }> }
) {
  try {
    // Route params resolve asynchronously in this Next.js version.
    const parsed = certificateNumberParamSchema.safeParse(await params);
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

    // findUnique rather than findFirst: certificateNo carries a @unique
    // constraint, so at most one row can match and no tenant filter is available
    // to add. This is the project's only intentionally unscoped read.
    const certificate = await prisma.certificate.findUnique({
      where: { certificateNo: parsed.data.certNo },
      select: CERTIFICATE_SELECT,
    });

    if (!certificate) {
      return NextResponse.json(fail("Certificate not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(certificate));
  } catch (err) {
    console.error("[GET /api/certificates/verify/[certNo]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
