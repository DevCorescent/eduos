// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Finance — Read Layer
// LAYER  : Route
// FLOW   : Guard → tenant → validate param → controller → response.
// ACCESS : STUDENT_FINANCE_ROLES (STUDENT · UNIVERSITY_ADMIN), self-service
//          only — see lib/constants/studentFinance.ts.
// BACKEND: studentFinanceController → StudentFinanceService →
//          StudentFinanceRepository → Prisma.
// PURPOSE: Everything a printable receipt renders from — the demand, its fee
//          lines, and the fee structure they belong to.
//
// THIS RETURNS DATA, NOT A FILE
//   Nothing in the schema stores a rendered receipt artifact, and producing a
//   PDF or HTML view is a presentation concern the service layer explicitly
//   does not take on (see studentFinance.service.ts). This route returns the
//   same JSON envelope as every other endpoint in this module; a client
//   renders the download from it.
//
// OWNERSHIP IS A 404, NEVER A 403 — identical to GET /api/fees/receipt/
//   [receiptId]. See that route's header for the full rationale.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { studentFinanceController } from "@/lib/controllers/studentFinance.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { STUDENT_FINANCE_ROLES } from "@/lib/constants/studentFinance";
import { receiptParamSchema } from "@/lib/validations/studentFinance.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/fees/download/[receiptId]";

type RouteContext = { params: Promise<{ receiptId: string }> };

// GET
// ACCESS     : STUDENT_FINANCE_ROLES, self-service only.
// VALIDATION : receiptParamSchema for [receiptId] — same schema and same
//              opaque-id reasoning as GET /api/fees/receipt/[receiptId].
// FLOW       : Authorise → resolve tenant → validate param → controller.
// RESPONSE   : { success: true, data: ReceiptDownloadDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...STUDENT_FINANCE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = receiptParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const result = await studentFinanceController.getReceiptDownload(
      tenantGuard.tenant.id,
      guard.session.sub,
      parsedParam.data.receiptId
    );

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
