// ============================================================================
// MODULE : Platform — a tenant's programmes, read-only (W3)
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// PURPOSE: The admission form must offer the university's REAL programmes
//          (§8.2 "Multiple programme preferences", and the instruction not to
//          hardcode choices). /api/programmes is tenant-guarded and therefore
//          unreachable from the platform portal, so this is the same rows
//          behind the platform guard — the same shape W1.5 established for
//          campuses and academic years.
//
//          READ ONLY. Programme creation stays with the university's own
//          console; nothing here writes.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { tenantIdParamSchema } from "@/lib/validations/platform";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// GET — this tenant's active programmes. STATUS: 200 · 400 · 401 · 403 · 500
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

    // Scoped by tenantId — another university's programmes are unreachable.
    const programmes = await prisma.programme.findMany({
      where: { tenantId: parsed.data.id, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });

    return NextResponse.json(ok({ programmes }));
  } catch (err) {
    console.error("[GET /api/platform/tenants/[id]/programmes]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
