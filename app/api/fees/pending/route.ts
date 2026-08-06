// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Finance — Read Layer
// LAYER  : Route
// FLOW   : Guard → tenant → validate query → controller → response.
// ACCESS : STUDENT_FINANCE_ROLES (STUDENT · UNIVERSITY_ADMIN), self-service
//          only — see lib/constants/studentFinance.ts.
// BACKEND: studentFinanceController → StudentFinanceService →
//          StudentFinanceRepository → Prisma.
// PURPOSE: A student's full financial position in one page — outstanding
//          demands (paged), concessions granted, and overdue liability. See
//          PendingFeesResult in studentFinance.service.ts for why this is one
//          route rather than three.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { studentFinanceController } from "@/lib/controllers/studentFinance.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { STUDENT_FINANCE_ROLES } from "@/lib/constants/studentFinance";
import { pendingFeeQuerySchema } from "@/lib/validations/studentFinance.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import type { ScholarshipFilters } from "@/lib/repositories/studentFinance.repository";
import { ok } from "@/types";

const SCOPE = "GET /api/fees/pending";

// GET
// ACCESS     : STUDENT_FINANCE_ROLES, self-service only.
// VALIDATION : pendingFeeQuerySchema — shared pagination, the fee-demand sort
//              whitelist, an optional status narrowed within the outstanding
//              set, an optional semesterId and an optional dueBefore bound.
//              `.strict()`, so an unrecognised param (e.g. `feeType`, which
//              only the concession list understands) is a 400 rather than a
//              silently ignored filter.
// FLOW       : Authorise → resolve tenant → validate query → controller.
//
//              `semesterId`, once validated, narrows BOTH the outstanding
//              demand page and the concession list — a student asking for one
//              semester's position expects a coherent answer for the whole
//              page, not demands filtered one way and concessions another.
//              `feeType` is not exposed here: pendingFeeQuerySchema is strict
//              and does not declare it, so narrowing concessions by fee type
//              is a filter this route does not offer (the service still
//              accepts it for a caller other than this route).
// RESPONSE   : { success: true, data: { demands, pagination, scholarships,
//                fineSummary } }
// STATUS     : 200 · 400 · 401 · 403 · 500
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole(...STUDENT_FINANCE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedQuery = pendingFeeQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const scholarshipFilters: ScholarshipFilters = {
      semesterId: parsedQuery.data.semesterId,
    };

    const result = await studentFinanceController.getPendingFees(
      tenantGuard.tenant.id,
      guard.session.sub,
      parsedQuery.data,
      scholarshipFilters
    );

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
