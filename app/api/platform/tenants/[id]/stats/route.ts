// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Tenant Statistics
// FLOW   : Validates tenant, aggregates platform statistics, returns summary.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// BACKEND: Uses existing Prisma aggregate/count queries.
// PURPOSE: Provide operational statistics for a single tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { EmployeeStatus, StudentStatus } from "@/app/generated/prisma/client";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { tenantIdParamSchema } from "@/lib/validations/platform";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// GET
// ACCESS     : PLATFORM_ADMIN (platform session — W1.2)
// VALIDATION : tenantIdParamSchema — the [id] segment must be a non-empty
//              string once trimmed. Reused as-is from the sibling routes.
// FLOW       : Authorise → validate the route param → confirm the tenant exists
//              before any aggregate runs → count students and faculty, total
//              and active, concurrently → return the summary.
//              No revenue metric is produced: the README names the category but
//              never defines it, so PlatformInvoice, Payment and FeeDemand are
//              deliberately not queried rather than a figure being invented.
// RESPONSE   : { success: true, data: { students: { total, active },
//                                       faculty:  { total, active } } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    // Route params resolve asynchronously in this Next.js version.
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

    const tenantId = parsed.data.id;

    // Existence is settled first so an unknown tenant answers NOT_FOUND rather
    // than a misleading set of zeroes. Only the primary key is selected.
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
    }

    // Four independent counts, so they run concurrently. count() returns
    // integers from the database — no rows are loaded — and both models carry
    // @@index([tenantId]), so each is index-served.
    const [studentsTotal, studentsActive, facultyTotal, facultyActive] = await Promise.all([
      prisma.student.count({ where: { tenantId } }),
      prisma.student.count({ where: { tenantId, status: StudentStatus.ACTIVE } }),
      prisma.facultyMember.count({ where: { tenantId } }),
      prisma.facultyMember.count({ where: { tenantId, status: EmployeeStatus.ACTIVE } }),
    ]);

    return NextResponse.json(
      ok({
        students: { total: studentsTotal, active: studentsActive },
        faculty: { total: facultyTotal, active: facultyActive },
      })
    );
  } catch (err) {
    console.error("[GET /api/platform/tenants/[id]/stats]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
