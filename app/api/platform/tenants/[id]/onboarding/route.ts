// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — University Onboarding Progress (W1.5, PRD §5.1 / §49.1)
// FLOW   : requirePlatformAdmin() → Zod → lib/services/tenantOnboarding.service.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// BACKEND: TenantOnboardingStep, plus read-only derivation over Tenant, Domain,
//          Subscription, AcademicYear and User. No tenant model is written.
// PURPOSE: PRD §5.1 "Track onboarding progress" and "University readiness
//          checklist", over the twelve §49.1 stages.
//
// WHY A TICK AND A DERIVED CHECK BOTH EXIST
//   Some §49.1 stages are unobservable from inside the product — Commercial
//   Approval, Training, UAT happen with the university, not in the database.
//   Those need a human tick. The rest can be proven or disproven from the data,
//   and are, so a ticked stage whose evidence is missing shows as exactly that
//   rather than as a green row. See the service header.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { onboardingStepSchema, tenantIdParamSchema } from "@/lib/validations/platform";
import {
  clearOnboardingStage,
  getOnboardingProgress,
  markOnboardingStage,
} from "@/lib/services/tenantOnboarding.service";
import { logProvisioningEvent } from "@/lib/services/universityProvisioning.service";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Shared param + body parsing for the two mutating verbs below. */
async function parseRequest(
  request: NextRequest,
  params: Promise<{ id: string }>
): Promise<
  | { ok: true; tenantId: string; stage: (typeof onboardingStepSchema)["_output"] }
  | { ok: false; response: NextResponse }
> {
  // Route params resolve asynchronously in this Next.js version.
  const parsedParams = tenantIdParamSchema.safeParse(await params);
  if (!parsedParams.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParams.error),
        },
        { status: 400 }
      ),
    };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 }),
    };
  }

  const parsedBody = onboardingStepSchema.safeParse(body);
  if (!parsedBody.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedBody.error),
        },
        { status: 400 }
      ),
    };
  }

  return { ok: true, tenantId: parsedParams.data.id, stage: parsedBody.data };
}

// GET
// ACCESS     : PLATFORM_ADMIN
// VALIDATION : tenantIdParamSchema.
// FLOW       : Authorise → validate param → read the twelve stages with their
//              ticks and their derived evidence.
// RESPONSE   : { success: true, data: { stages, completedCount, totalCount, dataReady } }
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

    const progress = await getOnboardingProgress(parsed.data.id);

    // null means the tenant is gone — distinct from a tenant with no ticks,
    // which returns twelve unticked stages.
    if (!progress) {
      return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(progress));
  } catch (err) {
    console.error("[GET /api/platform/tenants/[id]/onboarding]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : PLATFORM_ADMIN
// VALIDATION : tenantIdParamSchema + onboardingStepSchema (stage, optional note).
//              `completedBy` is NOT accepted — it comes from the platform
//              session, so an operator cannot record a colleague's sign-off.
// FLOW       : Authorise → validate → upsert the stage (idempotent).
// RESPONSE   : { success: true, data: <progress>, message: "Stage recorded" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
// No stage ORDER is enforced. §49.1's arrows are the intended sequence, not a
// lock — training and data import genuinely run in parallel, and refusing an
// out-of-order tick would make the checklist misreport work that happened.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsed = await parseRequest(request, params);
    if (!parsed.ok) return parsed.response;

    const marked = await markOnboardingStage(
      parsed.tenantId,
      parsed.stage.stage,
      guard.platformUserId,
      parsed.stage.note
    );

    if (!marked) {
      return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
    }

    logProvisioningEvent("onboarding-stage-marked", guard.platformUserId, parsed.tenantId);

    // The whole progress object is returned rather than the single step, so the
    // screen re-renders derived readiness too — ticking "Go Live" changes what
    // other rows say about themselves.
    const progress = await getOnboardingProgress(parsed.tenantId);
    return NextResponse.json(ok(progress, "Stage recorded"));
  } catch (err) {
    console.error("[POST /api/platform/tenants/[id]/onboarding]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// DELETE
// ACCESS     : PLATFORM_ADMIN
// VALIDATION : Same as POST — the stage travels in the body, not the URL,
//              because it is a value rather than a resource path segment.
// FLOW       : Authorise → validate → remove the tick if present.
// RESPONSE   : { success: true, data: <progress>, message: "Stage cleared" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
// Clearing an absent tick succeeds: the caller wanted the stage unmarked, and
// it is.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsed = await parseRequest(request, params);
    if (!parsed.ok) return parsed.response;

    await clearOnboardingStage(parsed.tenantId, parsed.stage.stage);

    const progress = await getOnboardingProgress(parsed.tenantId);
    if (!progress) {
      return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
    }

    logProvisioningEvent("onboarding-stage-cleared", guard.platformUserId, parsed.tenantId);

    return NextResponse.json(ok(progress, "Stage cleared"));
  } catch (err) {
    console.error("[DELETE /api/platform/tenants/[id]/onboarding]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
