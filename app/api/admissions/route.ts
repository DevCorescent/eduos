// ============================================================================
// OWNER  : Gauransh
// MODULE : Admissions — tenant-scoped list / create (TD-W3-6, PRD §8.2, §57)
// FLOW   : requireRole("UNIVERSITY_ADMIN") → requireTenant() → Zod →
//          lib/services/admission.service.
// ACCESS : UNIVERSITY_ADMIN of the resolved tenant.
//
// WHY THIS EXISTS ALONGSIDE /api/platform/tenants/[id]/admissions
//   PRD §57 lists "Admissions" under University Administration, so a
//   university's own staff must be able to run it. The platform routes are
//   guarded by requirePlatformAdmin and serve the platform console; a tenant
//   session can never satisfy that guard, and widening it would weaken it for
//   every other platform route.
//
//   This is the SAME SERVICE behind a different guard — the shape W1.5
//   established for campuses, academic years and branding. No second
//   Application model, no second workflow, no second identifier scheme, no
//   second conversion path. The platform routes are untouched.
//
// THE TENANT IS THE SESSION'S, NOT A SEGMENT AND NOT A BODY FIELD
//   requireTenant resolves it from the request host and refuses a token issued
//   for another university. No admissions schema defines tenantId, and all are
//   strict, so there is nothing here through which a client could name one.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import {
  createApplicationSchema,
  listApplicationsQuerySchema,
} from "@/lib/validations/admission";
import { createApplication, getApplication, listApplications } from "@/lib/services/admission.service";
import { recordAudit } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

const invalid = (details: unknown) =>
  NextResponse.json(
    { success: false as const, error: "Invalid input", code: "VALIDATION_ERROR", details },
    { status: 400 }
  );

// GET — one page of this university's applications.
// STATUS: 200 · 400 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsed = listApplicationsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) return invalid(validationDetails(parsed.error));

    const { page, limit } = parsed.data;
    // Scoped by the tenant the guard resolved — never by anything the caller
    // supplied.
    const { applications, total } = await listApplications(tenantGuard.tenant.id, parsed.data);

    return NextResponse.json(
      ok({
        applications,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      })
    );
  } catch (err) {
    console.error("[GET /api/admissions]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST — create an application in this university.
// Identifiers are issued by the existing engine inside the service; neither is
// accepted from the body. STATUS: 201 · 400 · 401 · 403 · 404 · 409 · 500
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = createApplicationSchema.safeParse(body);
    if (!parsed.success) return invalid(validationDetails(parsed.error));

    const tenantId = tenantGuard.tenant.id;
    const result = await createApplication(tenantId, parsed.data);

    if (!result.ok) {
      if (result.error === "EMAIL_TAKEN") {
        return NextResponse.json(
          fail("An application with that email already exists", "CONFLICT"),
          { status: 409 }
        );
      }
      if (result.error === "PROGRAMME_NOT_FOUND") {
        return NextResponse.json(
          fail("One or more programme preferences do not exist", "VALIDATION_ERROR"),
          { status: 400 }
        );
      }
      return NextResponse.json(
        fail(
          result.detail ?? "No identifier sequence is configured for applications.",
          "VALIDATION_ERROR"
        ),
        { status: 400 }
      );
    }

    const application = await getApplication(tenantId, result.value.id);

    // PRD §47. The actor is a real tenant user here, unlike the platform route
    // where AuditLog.userId cannot reference a PlatformUser.
    await recordAudit({
      tenantId,
      actor: { userId: guard.session.sub, ...readRequestOrigin(request.headers) },
      action: AUDIT_ACTIONS.APPLICATION_CREATED,
      resource: AUDIT_RESOURCES.APPLICATION,
      resourceId: result.value.id,
      after: {
        applicationNo: application?.applicationNo,
        applicantNo: application?.applicantNo,
        stage: application?.stage,
      },
    });

    return NextResponse.json(ok(application, "Application created"), { status: 201 });
  } catch (err) {
    console.error("[POST /api/admissions]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
