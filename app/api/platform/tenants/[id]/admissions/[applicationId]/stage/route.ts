// ============================================================================
// MODULE : Admissions — §49.2 stage transition (W3)
// ACCESS : PLATFORM_ADMIN.
//
// A SEPARATE ENDPOINT, NOT A FIELD ON PATCH
//   Moving through the workflow validates the CURRENT stage, is refused when it
//   is not exactly one step forward, and writes its own audit entry. Allowing
//   `stage` on the update route would let a client set any stage directly,
//   which is precisely what §4 of this work package forbids.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { tenantIdParamSchema } from "@/lib/validations/platform";
import { advanceStageSchema, applicationIdParamSchema } from "@/lib/validations/admission";
import { advanceStage, getApplication } from "@/lib/services/admission.service";
import { recordAudit, recordAuditFailure } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

type Params = Promise<{ id: string; applicationId: string }>;

// POST — advance exactly one §49.2 stage.
// STATUS: 200 · 400 · 401 · 403 · 404 · 409 · 500
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

    const parsedBody = advanceStageSchema.safeParse(body);
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

    const result = await advanceStage(tenantId, applicationId, parsedBody.data.toStage);

    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return NextResponse.json(fail("Application not found", "NOT_FOUND"), { status: 404 });
      }

      // §47 "Failed action logs". A refused workflow move is exactly the kind of
      // event an investigator looks for, and it leaves no other trace.
      await recordAuditFailure({
        tenantId,
        actor: { userId: null, ...readRequestOrigin(request.headers) },
        action: AUDIT_ACTIONS.APPLICATION_STAGE_CHANGED,
        resource: AUDIT_RESOURCES.APPLICATION,
        resourceId: applicationId,
        after: {
          attempted: parsedBody.data.toStage,
          reason: result.detail,
          platformActor: guard.platformUserId,
        },
      });

      return NextResponse.json(fail(result.detail ?? "Invalid stage transition", "CONFLICT"), {
        status: 409,
      });
    }

    await recordAudit({
      tenantId,
      actor: { userId: null, ...readRequestOrigin(request.headers) },
      action: AUDIT_ACTIONS.APPLICATION_STAGE_CHANGED,
      resource: AUDIT_RESOURCES.APPLICATION,
      resourceId: applicationId,
      after: {
        from: result.value.from,
        to: result.value.to,
        note: parsedBody.data.note ?? null,
        platformActor: guard.platformUserId,
      },
    });

    return NextResponse.json(
      ok(await getApplication(tenantId, applicationId), `Moved to ${result.value.to}`)
    );
  } catch (err) {
    console.error("[POST admissions/[applicationId]/stage]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
