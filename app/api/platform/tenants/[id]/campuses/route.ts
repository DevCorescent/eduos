// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Campuses and Affiliated Colleges (W1.5, PRD §5.1)
// FLOW   : requirePlatformAdmin() → Zod → Prisma over the EXISTING Campus and
//          School models.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// PURPOSE: PRD §5.1 "Add campuses and affiliated colleges", during onboarding.
//
// WHY THIS EXISTS WHEN /api/campuses ALREADY DOES
//   It is not a duplicate model or a duplicate CRUD surface — it is the same
//   two tables behind a DIFFERENT guard, because the existing route cannot be
//   reached by the actor §5.1 names.
//
//   /api/campuses is guarded by requireRole("UNIVERSITY_ADMIN") + requireTenant().
//   requireTenant resolves the tenant from the request HOST and then compares it
//   against the caller's own tenantId. A platform operator has no tenant session
//   at all and calls from the root domain, where tenant resolution yields
//   nothing by design — so that route answers 404 for them, always. §5.1 puts
//   campus setup in the Super Admin panel, so a platform-guarded path is
//   required for the capability to exist for that actor.
//
//   The university keeps its own route unchanged. Neither is authoritative over
//   the other; both write the same rows.
//
// THE TENANT COMES FROM THE ROUTE, NEVER THE BODY
//   platformCampusSchema is strict and has no tenantId. A body-supplied tenant
//   id is how a campus ends up under the wrong university.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { platformCampusSchema, tenantIdParamSchema } from "@/lib/validations/platform";
import { logProvisioningEvent } from "@/lib/services/universityProvisioning.service";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. Campus is @@unique([tenantId, code]). */
const UNIQUE_VIOLATION = "P2002";

/**
 * Campus rows with their affiliated colleges.
 *
 * §5.1 says "campuses AND affiliated colleges", and in this schema an
 * affiliated college is a School hanging off a Campus — so the two are returned
 * together rather than forcing the screen to make a second request per campus.
 */
const CAMPUS_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  code: true,
  email: true,
  phone: true,
  isMain: true,
  createdAt: true,
  schools: { select: { id: true, name: true, code: true, deanName: true, email: true } },
} as const;

// GET
// ACCESS     : PLATFORM_ADMIN
// VALIDATION : tenantIdParamSchema.
// FLOW       : Authorise → validate param → read this tenant's campuses with
//              their schools. Scoped by tenantId, so it can never return
//              another university's rows.
// RESPONSE   : { success: true, data: { campuses } }
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

    const campuses = await prisma.campus.findMany({
      where: { tenantId: parsed.data.id },
      select: CAMPUS_SELECT,
      orderBy: [{ isMain: "desc" }, { name: "asc" }],
    });

    return NextResponse.json(ok({ campuses }));
  } catch (err) {
    console.error("[GET /api/platform/tenants/[id]/campuses]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : PLATFORM_ADMIN
// VALIDATION : tenantIdParamSchema + platformCampusSchema (strict; no tenantId).
// FLOW       : Authorise → validate → confirm the tenant exists → create the
//              campus. When isMain is set, the previous main campus is cleared
//              in the SAME transaction, because two main campuses is a state no
//              amount of careful ordering afterwards can repair.
// RESPONSE   : { success: true, data: <Campus & { schools }>, message }
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

    const parsedBody = platformCampusSchema.safeParse(body);
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

    const { isMain, ...scalars } = parsedBody.data;

    const campus = await prisma.$transaction(async (tx) => {
      if (isMain) {
        await tx.campus.updateMany({ where: { tenantId, isMain: true }, data: { isMain: false } });
      }

      return tx.campus.create({
        data: { ...scalars, tenantId, isMain: isMain ?? false },
        select: CAMPUS_SELECT,
      });
    });

    logProvisioningEvent("campus-added", guard.platformUserId, tenantId, campus.id);

    return NextResponse.json(ok(campus, "Campus added"), { status: 201 });
  } catch (err) {
    // Campus.code is unique per tenant. The check is left to the database
    // rather than pre-read, because a pre-read cannot close the race.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
      return NextResponse.json(
        fail("A campus with that code already exists in this university", "CONFLICT"),
        { status: 409 }
      );
    }

    console.error("[POST /api/platform/tenants/[id]/campuses]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
