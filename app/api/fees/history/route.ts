// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Finance — Read Layer
// LAYER  : Route
// FLOW   : Guard → tenant → validate query → controller → response.
// ACCESS : STUDENT_FINANCE_ROLES (STUDENT · UNIVERSITY_ADMIN), self-service
//          only — see lib/constants/studentFinance.ts.
// BACKEND: studentFinanceController → StudentFinanceService →
//          StudentFinanceRepository → Prisma.
// PURPOSE: One student's payment history, filtered, sorted and paged.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { studentFinanceController } from "@/lib/controllers/studentFinance.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { STUDENT_FINANCE_ROLES } from "@/lib/constants/studentFinance";
import { paymentHistoryQuerySchema } from "@/lib/validations/studentFinance.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/fees/history";

// GET
// ACCESS     : STUDENT_FINANCE_ROLES. No [studentId] segment exists on this
//              route — every caller is resolved to the Student row THEY OWN by
//              the service's resolveOwnStudent(), keyed off session.sub. A
//              caller-supplied studentId is never accepted anywhere in this
//              module; see lib/constants/studentFinance.ts for why UNIVERSITY_
//              ADMIN is listed here and what it actually grants.
// VALIDATION : paymentHistoryQuerySchema — shared pagination, the sort
//              whitelist, status/method enums, an optional search term and an
//              ordered date range.
// FLOW       : Authorise → resolve tenant → validate query → controller. The
//              service resolves studentId from (tenantId, session.sub); a
//              caller holding a permitted role but owning no Student row in
//              this tenant is FORBIDDEN, not served an empty page.
// RESPONSE   : { success: true, data: { payments, pagination } }
// STATUS     : 200 · 400 · 401 · 403 · 500
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole(...STUDENT_FINANCE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedQuery = paymentHistoryQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const result = await studentFinanceController.getPaymentHistory(
      tenantGuard.tenant.id,
      guard.session.sub,
      parsedQuery.data
    );

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
