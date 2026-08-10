// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Academic Year Configuration (W1.5, PRD §5.1)
// FLOW   : requirePlatformAdmin() → Zod → Prisma over the EXISTING AcademicYear.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// PURPOSE: PRD §5.1 "Configure academic year", during onboarding.
//
// Same rationale as the campuses route: /api/academic-years already writes this
// model, but behind requireRole("UNIVERSITY_ADMIN") + requireTenant(), which a
// platform operator can never satisfy — they hold no tenant session and call
// from the root domain, where tenant resolution yields nothing. §5.1 places
// academic-year setup in the Super Admin panel, so the capability needs a
// platform-guarded path. Same model, same rows, different guard.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { platformAcademicYearSchema, tenantIdParamSchema } from "@/lib/validations/platform";
import { logProvisioningEvent } from "@/lib/services/universityProvisioning.service";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** AcademicYear is @@unique([tenantId, name]). */
const UNIQUE_VIOLATION = "P2002";

const YEAR_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  startDate: true,
  endDate: true,
  isCurrent: true,
  createdAt: true,
} as const;

// GET
// ACCESS     : PLATFORM_ADMIN
// FLOW       : Authorise → validate param → read this tenant's academic years,
//              newest first. Scoped by tenantId, so another university's years
//              are unreachable.
// RESPONSE   : { success: true, data: { academicYears } }
// STATUS     : 200 · 400 · 401 · 403 · 500
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

    const academicYears = await prisma.academicYear.findMany({
      where: { tenantId: parsed.data.id },
      select: YEAR_SELECT,
      orderBy: { startDate: "desc" },
    });

    return NextResponse.json(ok({ academicYears }));
  } catch (err) {
    console.error("[GET /api/platform/tenants/[id]/academic-years]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : PLATFORM_ADMIN
// VALIDATION : tenantIdParamSchema + platformAcademicYearSchema. The schema
//              enforces endDate > startDate — an inverted year silently breaks
//              every semester and batch hung off it.
// FLOW       : Authorise → validate → confirm the tenant exists → create. When
//              isCurrent is set, the previous current year is cleared in the
//              SAME transaction: two current years is a state the rest of the
//              product has no way to resolve.
// RESPONSE   : { success: true, data: <AcademicYear>, message }
// STATUS     : 201 · 400 · 401 · 403 · 404 · 409 · 500
export async function POST(
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

    const parsedBody = platformAcademicYearSchema.safeParse(body);
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

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) {
      return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
    }

    const { isCurrent, ...scalars } = parsedBody.data;

    const academicYear = await prisma.$transaction(async (tx) => {
      if (isCurrent) {
        await tx.academicYear.updateMany({
          where: { tenantId, isCurrent: true },
          data: { isCurrent: false },
        });
      }

      return tx.academicYear.create({
        data: { ...scalars, tenantId, isCurrent: isCurrent ?? false },
        select: YEAR_SELECT,
      });
    });

    logProvisioningEvent("academic-year-added", guard.platformUserId, tenantId, academicYear.id);

    return NextResponse.json(ok(academicYear, "Academic year added"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
      return NextResponse.json(
        fail("An academic year with that name already exists in this university", "CONFLICT"),
        { status: 409 }
      );
    }

    console.error("[POST /api/platform/tenants/[id]/academic-years]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
