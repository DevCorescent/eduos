// ============================================================================
// MODULE : Platform — a tenant's batches, read-only (W3)
// ACCESS : PLATFORM_ADMIN.
// PURPOSE: §8.5 "Assigns programme and batch" — conversion needs the real Batch
//          rows to choose from. Same pattern and same reason as the programmes
//          route beside it. READ ONLY; batch management stays with the
//          university's own console.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { tenantIdParamSchema } from "@/lib/validations/platform";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// GET — this tenant's batches. Optional ?programmeId narrows to one programme.
// STATUS: 200 · 400 · 401 · 403 · 500
export async function GET(
  request: NextRequest,
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

    const programmeId = request.nextUrl.searchParams.get("programmeId");

    const batches = await prisma.batch.findMany({
      where: {
        tenantId: parsed.data.id,
        ...(programmeId ? { programmeId } : {}),
      },
      select: { id: true, code: true, name: true, programmeId: true },
      orderBy: { code: "asc" },
    });

    return NextResponse.json(ok({ batches }));
  } catch (err) {
    console.error("[GET /api/platform/tenants/[id]/batches]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
