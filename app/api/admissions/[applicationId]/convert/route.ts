// ============================================================================
// MODULE : Admissions — tenant-scoped §8.5 Student Conversion (TD-W3-6)
// ACCESS : UNIVERSITY_ADMIN of the resolved tenant.
//
// The same convertToStudent service the platform surface calls. The transaction,
// the identifier engine, the STUDENT role grant, the W1.6 credential policy and
// the @unique studentId that makes a second conversion impossible are all
// unchanged and defined once.
//
// The temporary password is returned ONCE in this response and is never logged
// or audited — identical to the platform surface.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { applicationIdParamSchema, convertApplicationSchema } from "@/lib/validations/admission";
import { convertToStudent } from "@/lib/services/admission.service";
import { recordAudit } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { ok, fail } from "@/types";

type Params = Promise<{ applicationId: string }>;

/** Same mapping the platform surface uses. */
const STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  ALREADY_CONVERTED: 409,
  NOT_READY_TO_CONVERT: 409,
  PROGRAMME_NOT_FOUND: 400,
  BATCH_NOT_FOUND: 400,
  STUDENT_EMAIL_TAKEN: 409,
  NO_SEQUENCE: 400,
};

// POST — convert an admitted application into a Student.
// STATUS: 201 · 400 · 401 · 403 · 404 · 409 · 500
export async function POST(request: NextRequest, { params }: { params: Params }) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParams = applicationIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = convertApplicationSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const tenantId = tenantGuard.tenant.id;
    const applicationId = parsedParams.data.applicationId;

    const result = await convertToStudent(tenantId, applicationId, parsedBody.data);

    if (!result.ok) {
      const status = STATUS[result.error] ?? 400;
      return NextResponse.json(
        fail(
          result.detail ?? "Conversion failed",
          result.error === "NOT_FOUND" ? "NOT_FOUND" : status === 409 ? "CONFLICT" : "VALIDATION_ERROR"
        ),
        { status }
      );
    }

    // The student and the enrolment number — never the password.
    await recordAudit({
      tenantId,
      actor: { userId: guard.session.sub, ...readRequestOrigin(request.headers) },
      action: AUDIT_ACTIONS.APPLICATION_CONVERTED,
      resource: AUDIT_RESOURCES.APPLICATION,
      resourceId: applicationId,
      after: {
        studentId: result.value.studentId,
        enrollmentNo: result.value.enrollmentNo,
        programmeId: parsedBody.data.programmeId,
        batchId: parsedBody.data.batchId,
      },
    });

    return NextResponse.json(ok(result.value, "Applicant converted to student"), { status: 201 });
  } catch (err) {
    console.error("[POST /api/admissions/[applicationId]/convert]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
