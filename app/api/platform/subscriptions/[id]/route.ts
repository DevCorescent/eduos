// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Update Subscription
// FLOW   : Validates input, updates an existing subscription, returns updated data.
// ACCESS : SUPER_ADMIN
// BACKEND: Uses existing Prisma Subscription model.
// PURPOSE: Manage platform SaaS subscriptions.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { serialize } from "@/lib/utils/serialize";
import { subscriptionIdParamSchema, updateSubscriptionSchema } from "@/lib/validations/platform";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's "record required but not found" code, raised by update/delete. */
const RECORD_NOT_FOUND = "P2025";

// PATCH
// ACCESS     : SUPER_ADMIN
// VALIDATION : subscriptionIdParamSchema for the [id] segment,
//              updateSubscriptionSchema for the body. Every field optional but
//              at least one required. tenantId is not accepted — re-parenting a
//              subscription is not a capability the README describes.
// FLOW       : Authorise → validate param and body → confirm the subscription
//              exists (404 if absent) → apply one atomic update → serialise.
//              Only the Subscription model is written; Tenant, PlatformInvoice
//              and User are untouched.
//              No CONFLICT branch exists because Subscription carries no unique
//              constraint beyond its primary key — only @@index([tenantId]) —
//              so there is no unique-violation path to map.
// RESPONSE   : { success: true, data: <Subscription>,
//                message: "Subscription updated" }
//              maxStorage is a BigInt and is returned as a lossless string by
//              the shared serializer; pricePerMonth is a Decimal and rides
//              Prisma's own toJSON. No route-specific conversion is performed.
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("SUPER_ADMIN");
    if (!guard.authorized) return guard.response;

    // Route params resolve asynchronously in this Next.js version.
    const parsedParams = subscriptionIdParamSchema.safeParse(await params);
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

    const parsedBody = updateSubscriptionSchema.safeParse(body);
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

    const subscriptionId = parsedParams.data.id;

    const existing = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Subscription not found", "NOT_FOUND"), { status: 404 });
    }

    const { features, ...scalars } = parsedBody.data;

    // Single statement, so the write is atomic on its own. The lookup above is
    // a fast-path guard; a concurrent delete is caught as P2025 below. The JSON
    // column is cast here because Zod infers an unknown-valued record, which
    // Prisma's InputJsonValue does not accept directly.
    const subscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        ...scalars,
        features: features as Prisma.InputJsonValue | undefined,
      },
    });

    return NextResponse.json(ok(serialize(subscription), "Subscription updated"));
  } catch (err) {
    // The subscription was deleted between the lookup and the update.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === RECORD_NOT_FOUND
    ) {
      return NextResponse.json(fail("Subscription not found", "NOT_FOUND"), { status: 404 });
    }

    console.error("[PATCH /api/platform/subscriptions/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
