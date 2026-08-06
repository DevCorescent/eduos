// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Finance — Read Layer
// LAYER  : Route
// FLOW   : Guard → tenant → validate query → controller → response.
// ACCESS : STUDENT_FINANCE_ROLES (STUDENT · UNIVERSITY_ADMIN), self-service
//          only — see lib/constants/studentFinance.ts.
// BACKEND: studentFinanceController → StudentFinanceService →
//          StudentFinanceRepository → Prisma.
// PURPOSE: One student's receipts — SUCCEEDED payments only — filtered,
//          sorted and paged.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { studentFinanceController } from "@/lib/controllers/studentFinance.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { STUDENT_FINANCE_ROLES } from "@/lib/constants/studentFinance";
import { receiptListQuerySchema } from "@/lib/validations/studentFinance.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/fees/receipts";

// GET
// ACCESS     : STUDENT_FINANCE_ROLES, self-service only — identical
//              confinement to GET /api/fees/history.
// VALIDATION : receiptListQuerySchema. No `status` filter is offered — a
//              receipt exists only for a SUCCEEDED payment, and the repository
//              sets that predicate itself rather than accepting one.
// FLOW       : Authorise → resolve tenant → validate query → controller.
// RESPONSE   : { success: true, data: { receipts, pagination } }
// STATUS     : 200 · 400 · 401 · 403 · 500
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole(...STUDENT_FINANCE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedQuery = receiptListQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const result = await studentFinanceController.getReceipts(
      tenantGuard.tenant.id,
      guard.session.sub,
      parsedQuery.data
    );

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
