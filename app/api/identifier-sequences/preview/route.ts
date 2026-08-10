// ============================================================================
// OWNER  : Gauransh
// MODULE : Identifier Engine — Preview (PRD §9.3 "Rule preview and testing")
// FLOW   : Guard → tenant → validate query → read-only render → response.
// ACCESS : UNIVERSITY_ADMIN only, own institution only.
// BACKEND: Prisma
// PURPOSE: Show what the next identifier would look like, without issuing it.
//
// READ-ONLY, AND THAT IS THE ENTIRE POINT
//   This endpoint takes no row lock and writes nothing. A preview that
//   incremented would let anybody burn a university's certificate numbers by
//   refreshing a page, and would leave gaps an auditor has to account for.
//   It renders lastSequence + 1 through the SAME formatter the generator uses,
//   so the preview and the issued value cannot drift apart.
//
// IT IS A PREVIEW, NOT A RESERVATION
//   If somebody enrols a student between the preview and the next issue, the
//   number moves on. The screen says so rather than implying the value is held.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { previewIdSequenceQuerySchema } from "@/lib/validations/identifier";
import { previewIdentifier } from "@/lib/services/identifier.service";
import { AppError } from "@/lib/errors/AppError";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : previewIdSequenceQuerySchema — entityType required and from the
//              closed union; scopeKey optional, defaulting to the tenant-wide
//              counter. Strict, so a misspelled parameter is a 400 rather than
//              a preview of the wrong sequence.
// RESPONSE   : { success: true, data: { preview, nextSequence, willReset } }
//
//              `willReset` is returned rather than folded into the string: an
//              administrator configuring a YEARLY sequence in December needs to
//              know the next number restarts at 1, and the rendered value alone
//              would not tell them why it looks lower than the last one issued.
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsed = previewIdSequenceQuerySchema.safeParse(
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

    const result = await previewIdentifier({
      tenantId: tenantGuard.tenant.id,
      entityType: parsed.data.entityType,
      scopeKey: parsed.data.scopeKey,
    });

    return NextResponse.json(ok(result));
  } catch (err) {
    // The service raises a typed 404 when no sequence is configured. Mapped
    // rather than logged as a 500: an unconfigured entity is an ordinary state
    // for an institution that has not set one up yet.
    if (err instanceof AppError) {
      return NextResponse.json(fail(err.message, err.code), { status: err.statusCode });
    }

    console.error("[GET /api/identifier-sequences/preview]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
