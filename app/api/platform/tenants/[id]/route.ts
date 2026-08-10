// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Get Tenant Details / Update Tenant
// FLOW   : Validates the tenant id, then GET returns the requested tenant and
//          PATCH applies a partial update and returns the updated record.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// BACKEND: Uses existing Prisma Tenant model. No related model is read or
//          written — no User, Role, Domain or Subscription.
// PURPOSE: View and maintain a single university tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { tenantIdParamSchema, updateTenantSchema } from "@/lib/validations/platform";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/** Prisma's "record required but not found" code, raised by update/delete. */
const RECORD_NOT_FOUND = "P2025";

// GET
// ACCESS     : PLATFORM_ADMIN (platform session — W1.2)
// VALIDATION : tenantIdParamSchema — the [id] segment must be a non-empty
//              string once trimmed.
// FLOW       : Authorise → resolve and validate the route param → read the
//              Tenant by primary key → return it, or NOT_FOUND.
//              Only the Tenant model is read: aggregate counts belong to
//              GET /api/platform/tenants/[id]/stats per README Phase 2.
//              requireTenant is deliberately NOT used — platform routes are
//              served from the root domain, which resolves to no tenant.
// RESPONSE   : { success: true, data: <Tenant> }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    // Route params resolve asynchronously in this Next.js version.
    const parsed = tenantIdParamSchema.safeParse(await params);
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

    const tenant = await prisma.tenant.findUnique({
      where: { id: parsed.data.id },
    });

    if (!tenant) {
      return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(tenant));
  } catch (err) {
    console.error("[GET /api/platform/tenants/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : PLATFORM_ADMIN (platform session — W1.2)
// VALIDATION : tenantIdParamSchema for the [id] segment, updateTenantSchema for
//              the body. Every field is optional but at least one is required.
//              status is accepted here — creation defers to the schema default.
// FLOW       : Authorise → validate param and body → load the tenant (404 if
//              absent) → re-check slug uniqueness ONLY when the slug is both
//              supplied and actually changing → apply one atomic update.
//              Only the Tenant model is written; related models are untouched.
// RESPONSE   : { success: true, data: <Tenant>, message: "Tenant updated" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsedParams = tenantIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParams.error),
        },
        { status: 400 }
      );
    }

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = updateTenantSchema.safeParse(body);
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

    const tenantId = parsedParams.data.id;

    const existing = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
    }

    const { address, settings, ...scalars } = parsedBody.data;

    // Uniqueness is only re-checked for a slug that is actually changing —
    // resubmitting the tenant's own current slug is not a conflict with itself.
    if (scalars.slug !== undefined && scalars.slug !== existing.slug) {
      const clash = await prisma.tenant.findUnique({
        where: { slug: scalars.slug },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(fail("Tenant slug already in use", "CONFLICT"), { status: 409 });
      }
    }

    // Single statement, so the write is atomic on its own. The checks above are
    // fast-path guards; the real guarantees are the unique constraint and the
    // row lookup surfacing as P2002 / P2025 in the catch below. JSON columns are
    // cast here because Zod infers unknown-valued records, which Prisma's
    // InputJsonValue does not accept directly.
    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...scalars,
        address: address as Prisma.InputJsonValue | undefined,
        settings: settings as Prisma.InputJsonValue | undefined,
      },
    });

    return NextResponse.json(ok(tenant, "Tenant updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the slug between the check and the update.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(fail("Tenant slug already in use", "CONFLICT"), { status: 409 });
      }
      // The tenant was deleted between the lookup and the update.
      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[PATCH /api/platform/tenants/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
