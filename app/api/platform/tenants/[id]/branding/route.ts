// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — University Branding (W1.5, PRD §5.1)
// FLOW   : requirePlatformAdmin() → Zod → Prisma over the EXISTING Tenant
//          branding columns.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// PURPOSE: PRD §5.1 "Upload university logo and branding", during onboarding.
//
// SAME FOUR COLUMNS AS /api/tenant/branding, DIFFERENT GUARD
//   WP-3 already wired branding for the university's own console. That route is
//   tenant-guarded and unreachable by a platform operator, who holds no tenant
//   session and calls from the root domain. §5.1 puts branding in the Super
//   Admin panel — an operator configures it as part of onboarding, before the
//   university has anybody to configure it themselves. So this writes the same
//   Tenant.logoUrl / faviconUrl / primaryColor / accentColor, and no new column
//   or model exists for it.
//
// URLs, NOT FILE UPLOADS
//   §5.1 says "Upload university logo". This project has no object storage and
//   no upload endpoint anywhere, so a file input here would be a control with
//   nothing behind it. The columns are and always were URLs; this route sets
//   them. The absence of storage is recorded in TECHNICAL_DEBT.md rather than
//   papered over with a fake uploader.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { platformBrandingSchema, tenantIdParamSchema } from "@/lib/validations/platform";
import { logProvisioningEvent } from "@/lib/services/universityProvisioning.service";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's "record required but not found" code, raised by update. */
const RECORD_NOT_FOUND = "P2025";

const BRANDING_SELECT = {
  id: true,
  name: true,
  logoUrl: true,
  faviconUrl: true,
  primaryColor: true,
  accentColor: true,
} as const;

// GET
// ACCESS     : PLATFORM_ADMIN
// FLOW       : Authorise → validate param → read the four branding columns.
// RESPONSE   : { success: true, data: <branding> }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

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

    const branding = await prisma.tenant.findUnique({
      where: { id: parsed.data.id },
      select: BRANDING_SELECT,
    });

    if (!branding) {
      return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(branding));
  } catch (err) {
    console.error("[GET /api/platform/tenants/[id]/branding]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : PLATFORM_ADMIN
// VALIDATION : tenantIdParamSchema + platformBrandingSchema. Every key optional
//              but at least one required. Colours must be hex — the existing
//              branding implementation writes these straight into CSS custom
//              properties, so a free string would reach a stylesheet unescaped.
// FLOW       : Authorise → validate → update the four columns.
// RESPONSE   : { success: true, data: <branding>, message: "Branding updated" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
// null CLEARS a value; an omitted key leaves it unchanged. Branding is the one
// place clearing genuinely matters — a university that drops its logo mid-
// onboarding must be able to go back to the platform default rather than being
// stuck with a broken image URL forever.
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = platformBrandingSchema.safeParse(body);
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

    const branding = await prisma.tenant.update({
      where: { id: parsedParams.data.id },
      data: parsedBody.data,
      select: BRANDING_SELECT,
    });

    logProvisioningEvent("branding-configured", guard.platformUserId, parsedParams.data.id);

    return NextResponse.json(ok(branding, "Branding updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === RECORD_NOT_FOUND) {
      return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
    }

    console.error("[PATCH /api/platform/tenants/[id]/branding]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
