// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Enabled Modules (W1.5, PRD §2.1, §5.1, §57)
// FLOW   : requirePlatformAdmin() → Zod → Prisma over the EXISTING
//          Subscription.features column.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// PURPOSE: PRD §5.1 "Assign enabled modules" / §2.1 "Module allocation", over
//          the PRD §57 catalogue.
//
// NO NEW STORAGE, AND NO SECOND FEATURE-FLAG SYSTEM
//   Selection continues to live in Subscription.features, which is where the
//   existing /platform/feature-flags screen has always written it. What changes
//   is that the keys are now CONSTRAINED to the §57 catalogue, so a typo cannot
//   become a module — the column currently carries `{"jhjj": true}` on a real
//   tenant precisely because nothing checked.
//
// UNRECOGNISED KEYS ARE PRESERVED, NOT DELETED
//   The column predates the catalogue. Silently dropping keys nobody can
//   account for would destroy data the platform may be reading; silently
//   promoting them would let junk become an official capability. They are
//   carried through every write untouched and reported separately, so an
//   operator can SEE them and decide.
//
// WHAT THIS ROUTE DELIBERATELY DOES NOT DO — GAP-01, remaining half
//   It does not enforce anything. The PRD names module allocation in §2.1, §5.1
//   and §57 and nowhere states what a DISABLED module does: no hidden
//   navigation, no 403, no 404, no redirect. Inventing one would be inventing an
//   authorization model. Enforcement stays a documented gap, and the UI says so
//   rather than implying a switch has an effect it does not have.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { moduleSelectionSchema, tenantIdParamSchema } from "@/lib/validations/platform";
import { UNIVERSITY_MODULES, partitionFeatures } from "@/lib/constants/modules";
import { logProvisioningEvent } from "@/lib/services/universityProvisioning.service";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * The tenant's subscription, which is where module selection lives.
 *
 * A university with no subscription cannot hold a selection at all — the column
 * belongs to Subscription, not Tenant. W1.4 provisioning creates one, so this
 * only affects tenants that predate it, and the route says so plainly rather
 * than silently succeeding.
 */
async function readSubscription(tenantId: string) {
  return prisma.subscription.findFirst({
    where: { tenantId },
    select: { id: true, features: true },
    orderBy: { createdAt: "desc" },
  });
}

// GET
// ACCESS     : PLATFORM_ADMIN
// VALIDATION : tenantIdParamSchema.
// FLOW       : Authorise → validate → read the subscription's stored features →
//              split them into catalogue modules and unrecognised keys.
// RESPONSE   : { success: true, data: { catalogue, modules, unknown, subscriptionId } }
//              `catalogue` is the §57 list, so the UI never hard-codes it.
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

    const subscription = await readSubscription(parsed.data.id);
    if (!subscription) {
      return NextResponse.json(
        fail("This university has no subscription, so modules cannot be assigned", "NOT_FOUND"),
        { status: 404 }
      );
    }

    const { modules, unknown } = partitionFeatures(
      subscription.features as Record<string, unknown> | null
    );

    return NextResponse.json(
      ok({
        subscriptionId: subscription.id,
        catalogue: UNIVERSITY_MODULES,
        modules,
        unknown,
      })
    );
  } catch (err) {
    console.error("[GET /api/platform/tenants/[id]/modules]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PUT
// ACCESS     : PLATFORM_ADMIN
// VALIDATION : tenantIdParamSchema + moduleSelectionSchema. The map's KEYS are
//              a Zod enum built from the §57 catalogue, so a key the PRD never
//              named is a 400 rather than a stored module.
// FLOW       : Authorise → validate → read the current column → merge the
//              submitted selection over the preserved unrecognised keys →
//              write the whole column back.
// RESPONSE   : { success: true, data: { modules, unknown }, message }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
// PUT, not PATCH: the submitted map REPLACES the module selection wholesale,
// matching how the column has always been written. A module absent from the map
// is off, which is the same as false.
export async function PUT(
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

    const parsedBody = moduleSelectionSchema.safeParse(body);
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

    const subscription = await readSubscription(parsedParams.data.id);
    if (!subscription) {
      return NextResponse.json(
        fail("This university has no subscription, so modules cannot be assigned", "NOT_FOUND"),
        { status: 404 }
      );
    }

    const { unknown } = partitionFeatures(
      subscription.features as Record<string, unknown> | null
    );

    // Unrecognised keys FIRST, so a catalogue module can never be shadowed by a
    // stale key of the same name, and the preserved values survive the write.
    const merged = { ...unknown, ...parsedBody.data.modules };

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { features: merged as Prisma.InputJsonValue },
    });

    logProvisioningEvent("modules-assigned", guard.platformUserId, parsedParams.data.id);

    return NextResponse.json(
      ok({ modules: parsedBody.data.modules, unknown }, "Modules updated")
    );
  } catch (err) {
    console.error("[PUT /api/platform/tenants/[id]/modules]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
