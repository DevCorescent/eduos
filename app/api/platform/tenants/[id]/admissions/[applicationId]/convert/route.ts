// ============================================================================
// MODULE : Admissions — §8.5 Student Conversion (W3)
// ACCESS : PLATFORM_ADMIN.
//
// WHAT §8.5 DEFINES AND THIS IMPLEMENTS
//   Creates student profile · Generates student ID · Generates enrolment number
//   · Assigns programme and batch · Creates portal credentials.
//
// WHAT §8.5 NAMES AND THIS DOES NOT DO
//   Assign courses, generate a fee plan, assign a mentor, assign hostel and
//   transport, generate a digital ID card, create a university email, send
//   onboarding communication. Each names a capability whose rule, model or
//   transport does not exist. Recorded in TECHNICAL_DEBT.md rather than guessed.
//
// THE CREDENTIAL IS RETURNED ONCE
//   W1.6's approved policy, reused unchanged: generated password, bcrypt hash
//   only, mustChangePassword = true, plaintext in this response and nowhere
//   else. It is never written to the audit entry or to any log.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { tenantIdParamSchema } from "@/lib/validations/platform";
import { applicationIdParamSchema, convertApplicationSchema } from "@/lib/validations/admission";
import { convertToStudent } from "@/lib/services/admission.service";
import { recordAudit } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

type Params = Promise<{ id: string; applicationId: string }>;

/** Maps a service refusal to the status the caller should see. */
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
// RESPONSE : { success: true, data: { studentId, enrollmentNo, email, temporaryPassword } }
// STATUS   : 201 · 400 · 401 · 403 · 404 · 409 · 500
export async function POST(request: NextRequest, { params }: { params: Params }) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const raw = await params;
    const tenant = tenantIdParamSchema.safeParse({ id: raw.id });
    const application = applicationIdParamSchema.safeParse({ applicationId: raw.applicationId });
    if (!tenant.success || !application.success) {
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
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedBody.error),
        },
        { status: 400 }
      );
    }

    const tenantId = tenant.data.id;
    const applicationId = application.data.applicationId;

    const result = await convertToStudent(tenantId, applicationId, parsedBody.data);

    if (!result.ok) {
      return NextResponse.json(
        fail(result.detail ?? messageFor(result.error), codeFor(result.error)),
        { status: STATUS[result.error] ?? 400 }
      );
    }

    // §47 "Data change logs". The student and the enrolment number — never the
    // password, which exists only in the response body above.
    await recordAudit({
      tenantId,
      actor: { userId: null, ...readRequestOrigin(request.headers) },
      action: AUDIT_ACTIONS.APPLICATION_CONVERTED,
      resource: AUDIT_RESOURCES.APPLICATION,
      resourceId: applicationId,
      after: {
        studentId: result.value.studentId,
        enrollmentNo: result.value.enrollmentNo,
        programmeId: parsedBody.data.programmeId,
        batchId: parsedBody.data.batchId,
        platformActor: guard.platformUserId,
      },
    });

    return NextResponse.json(ok(result.value, "Applicant converted to student"), { status: 201 });
  } catch (err) {
    console.error("[POST admissions/[applicationId]/convert]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

function messageFor(error: string): string {
  switch (error) {
    case "NOT_FOUND":
      return "Application not found";
    case "ALREADY_CONVERTED":
      return "This application has already been converted to a student";
    case "PROGRAMME_NOT_FOUND":
      return "That programme does not exist in this university";
    case "BATCH_NOT_FOUND":
      return "That batch does not exist in this university";
    case "STUDENT_EMAIL_TAKEN":
      return "A user with that email already exists in this university";
    default:
      return "Conversion failed";
  }
}

function codeFor(error: string): string {
  return error === "NOT_FOUND"
    ? "NOT_FOUND"
    : STATUS[error] === 409
      ? "CONFLICT"
      : "VALIDATION_ERROR";
}
