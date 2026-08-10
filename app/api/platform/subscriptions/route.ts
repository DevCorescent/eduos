// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — List Subscriptions
// FLOW   : Returns paginated platform subscriptions.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// BACKEND: Uses existing Prisma Subscription model.
// PURPOSE: View SaaS subscriptions managed by the platform.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { serialize } from "@/lib/utils/serialize";
import { listSubscriptionsQuerySchema } from "@/lib/validations/platform";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// GET
// ACCESS     : PLATFORM_ADMIN (platform session — W1.2)
// VALIDATION : listSubscriptionsQuerySchema — ?page (default 1) and ?limit
//              (default 20, max 100), both coerced from search params.
// FLOW       : Authorise → validate query → read one page of subscriptions
//              alongside the total count in a single transaction → pass the
//              payload through the shared serializer → return both.
//              Subscription.maxStorage is a BigInt, which JSON.stringify throws
//              on outright; serialize() is the project-wide strategy for that.
//              pricePerMonth is a Decimal and needs no help — Prisma's Decimal
//              defines its own toJSON and is passed through untouched.
//              No relation is included: README Phase 2 asks only for the
//              subscription list, so the tenant is referenced by tenantId.
//              requireTenant is deliberately NOT used — platform routes are
//              served from the root domain, which resolves to no tenant.
// RESPONSE   : { success: true, data: { subscriptions, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsed = listSubscriptionsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
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

    const { page, limit } = parsed.data;

    // Paired in one transaction so the total cannot shift between the two
    // reads and leave the page metadata inconsistent with the rows returned.
    // The explicit ordering is required for correctness, not presentation:
    // offset pagination over an unordered result can repeat or skip rows.
    const [subscriptions, total] = await prisma.$transaction([
      prisma.subscription.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.subscription.count(),
    ]);

    return NextResponse.json(
      ok(
        serialize({
          subscriptions,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        })
      )
    );
  } catch (err) {
    console.error("[GET /api/platform/subscriptions]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
