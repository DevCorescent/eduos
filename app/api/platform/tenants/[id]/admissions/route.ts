// ============================================================================
// OWNER  : Gauransh
// MODULE : Admissions — list / create applications (W3, PRD §8.2, §9.1)
// FLOW   : requirePlatformAdmin() → Zod → lib/services/admission.service.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2).
//
// WHY THIS GUARD
//   The approved page paths are /platform/tenants/[id]/admissions, which live
//   inside the platform portal — a surface no tenant session can reach. The
//   tenant is the route segment, exactly as every other W1.4/W1.5 tenant-scoped
//   platform route works.
//
//   NOTE, recorded rather than resolved silently: PRD §57 lists "Admissions"
//   under University Administration, which suggests it eventually belongs to a
//   tenant-side surface too. Building both now would be duplicate architecture;
//   the tension is recorded in TECHNICAL_DEBT.md.
//
// THE TENANT IS NEVER A BODY FIELD
//   No schema in lib/validations/admission.ts defines tenantId, and all are
//   strict, so there is no key through which a client could name another
//   university.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { tenantIdParamSchema } from "@/lib/validations/platform";
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

// GET — one page of applications. ?stage filters, ?q searches names, email and
// both identifiers. STATUS: 200 · 400 · 401 · 403 · 500
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsedParams = tenantIdParamSchema.safeParse(await params);
    if (!parsedParams.success) return invalid(validationDetails(parsedParams.error));

    const parsedQuery = listApplicationsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return invalid(validationDetails(parsedQuery.error));

    const { page, limit } = parsedQuery.data;
    const { applications, total } = await listApplications(parsedParams.data.id, parsedQuery.data);

    return NextResponse.json(
      ok({
        applications,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      })
    );
  } catch (err) {
    console.error("[GET /api/platform/tenants/[id]/admissions]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST — create an application. Both identifiers are issued by the existing
// engine inside the service's transaction; neither is accepted from the body.
// STATUS: 201 · 400 · 401 · 403 · 404 · 409 · 500
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsedParams = tenantIdParamSchema.safeParse(await params);
    if (!parsedParams.success) return invalid(validationDetails(parsedParams.error));

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = createApplicationSchema.safeParse(body);
    if (!parsedBody.success) return invalid(validationDetails(parsedBody.error));

    const tenantId = parsedParams.data.id;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });

    const result = await createApplication(tenantId, parsedBody.data);

    if (!result.ok) {
      if (result.error === "EMAIL_TAKEN") {
        return NextResponse.json(
          fail("An application with that email already exists for this university", "CONFLICT"),
          { status: 409 }
        );
      }
      if (result.error === "PROGRAMME_NOT_FOUND") {
        return NextResponse.json(
          fail("One or more programme preferences do not exist in this university", "VALIDATION_ERROR"),
          { status: 400 }
        );
      }
      // No configured sequence. Reported honestly — no default format is
      // invented, and no application is stored without a number.
      return NextResponse.json(
        fail(
          result.detail ??
            "No identifier sequence is configured for applications in this university.",
          "VALIDATION_ERROR"
        ),
        { status: 400 }
      );
    }

    const application = await getApplication(tenantId, result.value.id);

    // PRD §47 "Data change logs". Ids and the identifiers, never a credential.
    await recordAudit({
      tenantId,
      actor: { userId: null, ...readRequestOrigin(request.headers) },
      action: AUDIT_ACTIONS.APPLICATION_CREATED,
      resource: AUDIT_RESOURCES.APPLICATION,
      resourceId: result.value.id,
      after: {
        applicationNo: application?.applicationNo,
        applicantNo: application?.applicantNo,
        stage: application?.stage,
        platformActor: guard.platformUserId,
      },
    });

    return NextResponse.json(ok(application, "Application created"), { status: 201 });
  } catch (err) {
    console.error("[POST /api/platform/tenants/[id]/admissions]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
