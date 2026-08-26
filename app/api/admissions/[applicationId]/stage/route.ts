// ============================================================================
// MODULE : Admissions — tenant-scoped §49.2 stage transition (TD-W3-6)
// ACCESS : UNIVERSITY_ADMIN of the resolved tenant.
//
// The same advanceStage service the platform surface calls: the twelve stages,
// their order and the one-step-only rule are unchanged and defined in exactly
// one place. A refused transition is audited as a FAILURE, per §47.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { advanceStageSchema, applicationIdParamSchema } from "@/lib/validations/admission";
import { advanceStage, getApplication } from "@/lib/services/admission.service";
import { recordAudit, recordAuditFailure } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { ok, fail } from "@/types";

type Params = Promise<{ applicationId: string }>;

// POST — advance exactly one stage.
// STATUS: 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function POST(request: NextRequest, { params }: { params: Params }) {
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

    const parsedBody = advanceStageSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const tenantId = tenantGuard.tenant.id;
    const applicationId = parsedParams.data.applicationId;

    const result = await advanceStage(tenantId, applicationId, parsedBody.data.toStage);

    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return NextResponse.json(fail("Application not found", "NOT_FOUND"), { status: 404 });
      }

      await recordAuditFailure({
        tenantId,
        actor: { userId: guard.session.sub, ...readRequestOrigin(request.headers) },
        action: AUDIT_ACTIONS.APPLICATION_STAGE_CHANGED,
        resource: AUDIT_RESOURCES.APPLICATION,
        resourceId: applicationId,
        after: { attempted: parsedBody.data.toStage, reason: result.detail },
      });

      return NextResponse.json(fail(result.detail ?? "Invalid stage transition", "CONFLICT"), {
        status: 409,
      });
    }

    await recordAudit({
      tenantId,
      actor: { userId: guard.session.sub, ...readRequestOrigin(request.headers) },
      action: AUDIT_ACTIONS.APPLICATION_STAGE_CHANGED,
      resource: AUDIT_RESOURCES.APPLICATION,
      resourceId: applicationId,
      after: { from: result.value.from, to: result.value.to, note: parsedBody.data.note ?? null },
    });

    return NextResponse.json(
      ok(await getApplication(tenantId, applicationId), `Moved to ${result.value.to}`)
    );
  } catch (err) {
    console.error("[POST /api/admissions/[applicationId]/stage]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
