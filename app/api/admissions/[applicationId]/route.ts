// ============================================================================
// MODULE : Admissions — tenant-scoped read / update (TD-W3-6, PRD §8.2)
// ACCESS : UNIVERSITY_ADMIN of the resolved tenant.
//
// Same service as the platform surface. Every lookup passes the tenant the
// guard resolved, so an application belonging to another university is absent
// rather than refused — the convention the rest of this codebase follows.
//
// IMMUTABLE HERE: stage, applicantNo, applicationNo, studentId, tenantId. None
// is a field in updateApplicationSchema and the schema is strict.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { applicationIdParamSchema, updateApplicationSchema } from "@/lib/validations/admission";
import { getApplication, updateApplication } from "@/lib/services/admission.service";
import { recordAudit } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

type Params = Promise<{ applicationId: string }>;

// GET — one application belonging to this university.
// STATUS: 200 · 400 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest, { params }: { params: Params }) {
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

    const parsed = applicationIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const application = await getApplication(tenantGuard.tenant.id, parsed.data.applicationId);
    if (!application) {
      return NextResponse.json(fail("Application not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(application));
  } catch (err) {
    console.error("[GET /api/admissions/[applicationId]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH — edit application data. STATUS: 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function PATCH(request: NextRequest, { params }: { params: Params }) {
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

    const parsedBody = updateApplicationSchema.safeParse(body);
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

    const tenantId = tenantGuard.tenant.id;
    const applicationId = parsedParams.data.applicationId;

    const result = await updateApplication(tenantId, applicationId, parsedBody.data);

    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return NextResponse.json(fail("Application not found", "NOT_FOUND"), { status: 404 });
      }
      if (result.error === "EMAIL_TAKEN") {
        return NextResponse.json(
          fail("An application with that email already exists", "CONFLICT"),
          { status: 409 }
        );
      }
      return NextResponse.json(
        fail("One or more programme preferences do not exist", "VALIDATION_ERROR"),
        { status: 400 }
      );
    }

    const application = await getApplication(tenantId, applicationId);

    // The KEYS that changed, not their values — an application carries an
    // applicant's personal data.
    await recordAudit({
      tenantId,
      actor: { userId: guard.session.sub, ...readRequestOrigin(request.headers) },
      action: AUDIT_ACTIONS.APPLICATION_UPDATED,
      resource: AUDIT_RESOURCES.APPLICATION,
      resourceId: applicationId,
      after: {
        fieldsChanged: Object.keys(parsedBody.data),
        applicationNo: application?.applicationNo,
      },
    });

    return NextResponse.json(ok(application, "Application updated"));
  } catch (err) {
    console.error("[PATCH /api/admissions/[applicationId]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
