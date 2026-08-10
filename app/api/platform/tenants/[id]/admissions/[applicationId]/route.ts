// ============================================================================
// MODULE : Admissions — read / update one application (W3, PRD §8.2)
// ACCESS : PLATFORM_ADMIN. Tenant from the route segment, never the body.
//
// IMMUTABLE THROUGH THIS ROUTE: stage, applicantNo, applicationNo, studentId,
// tenantId. None is a field in updateApplicationSchema and the schema is
// strict, so supplying one is a 400. Stage moves through its own endpoint.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { tenantIdParamSchema } from "@/lib/validations/platform";
import { applicationIdParamSchema, updateApplicationSchema } from "@/lib/validations/admission";
import { getApplication, updateApplication } from "@/lib/services/admission.service";
import { recordAudit } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

type Params = Promise<{ id: string; applicationId: string }>;

const invalid = (details: unknown) =>
  NextResponse.json(
    { success: false as const, error: "Invalid input", code: "VALIDATION_ERROR", details },
    { status: 400 }
  );

/** Both segments, validated together. */
async function parseParams(params: Params) {
  const raw = await params;
  const tenant = tenantIdParamSchema.safeParse({ id: raw.id });
  const application = applicationIdParamSchema.safeParse({ applicationId: raw.applicationId });
  if (!tenant.success) return { ok: false as const, details: validationDetails(tenant.error) };
  if (!application.success) {
    return { ok: false as const, details: validationDetails(application.error) };
  }
  return { ok: true as const, tenantId: tenant.data.id, applicationId: application.data.applicationId };
}

// GET — one application. Scoped by tenant, so another university's is absent
// rather than confirmed. STATUS: 200 · 400 · 401 · 403 · 404 · 500
export async function GET(_request: NextRequest, { params }: { params: Params }) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsed = await parseParams(params);
    if (!parsed.ok) return invalid(parsed.details);

    const application = await getApplication(parsed.tenantId, parsed.applicationId);
    if (!application) {
      return NextResponse.json(fail("Application not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(application));
  } catch (err) {
    console.error("[GET admissions/[applicationId]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH — edit application data. STATUS: 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsed = await parseParams(params);
    if (!parsed.ok) return invalid(parsed.details);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = updateApplicationSchema.safeParse(body);
    if (!parsedBody.success) return invalid(validationDetails(parsedBody.error));

    const result = await updateApplication(parsed.tenantId, parsed.applicationId, parsedBody.data);

    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return NextResponse.json(fail("Application not found", "NOT_FOUND"), { status: 404 });
      }
      if (result.error === "EMAIL_TAKEN") {
        return NextResponse.json(
          fail("An application with that email already exists for this university", "CONFLICT"),
          { status: 409 }
        );
      }
      return NextResponse.json(
        fail("One or more programme preferences do not exist in this university", "VALIDATION_ERROR"),
        { status: 400 }
      );
    }

    const application = await getApplication(parsed.tenantId, parsed.applicationId);

    // The KEYS that changed, not their values: an application carries an
    // applicant's personal data, and an audit trail is read by more people than
    // the record itself.
    await recordAudit({
      tenantId: parsed.tenantId,
      actor: { userId: null, ...readRequestOrigin(request.headers) },
      action: AUDIT_ACTIONS.APPLICATION_UPDATED,
      resource: AUDIT_RESOURCES.APPLICATION,
      resourceId: parsed.applicationId,
      after: {
        fieldsChanged: Object.keys(parsedBody.data),
        applicationNo: application?.applicationNo,
        platformActor: guard.platformUserId,
      },
    });

    return NextResponse.json(ok(application, "Application updated"));
  } catch (err) {
    console.error("[PATCH admissions/[applicationId]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
