// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Finance — Read Layer
// LAYER  : Route
// FLOW   : Guard → tenant → validate param → controller → response.
// ACCESS : STUDENT_FINANCE_ROLES (STUDENT · UNIVERSITY_ADMIN), self-service
//          only — see lib/constants/studentFinance.ts.
// BACKEND: studentFinanceController → StudentFinanceService →
//          StudentFinanceRepository → Prisma.
// PURPOSE: One receipt, with the demand it settled.
//
// OWNERSHIP IS A 404, NEVER A 403
//   [receiptId] is Payment.id, an opaque cuid, and this route accepts no
//   studentId. The repository folds tenantId AND the caller's OWN resolved
//   studentId into the lookup (findReceiptById), so a receipt that does not
//   exist and one that belongs to another student are indistinguishable here
//   — both surface as RECEIPT_NOT_FOUND / 404. Nothing in this route (or the
//   service beneath it) can disclose that another student's receipt exists.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { studentFinanceController } from "@/lib/controllers/studentFinance.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { STUDENT_FINANCE_ROLES } from "@/lib/constants/studentFinance";
import { receiptParamSchema } from "@/lib/validations/studentFinance.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/fees/receipt/[receiptId]";

type RouteContext = { params: Promise<{ receiptId: string }> };

// GET
// ACCESS     : STUDENT_FINANCE_ROLES, self-service only.
// VALIDATION : receiptParamSchema for [receiptId] — non-empty once trimmed; no
//              format is asserted, since Payment.id is an opaque cuid and an
//              unrecognised-but-well-formed id is a 404 rather than a 400.
// FLOW       : Authorise → resolve tenant → validate param → controller. The
//              service resolves studentId first and then reads the receipt
//              scoped by (tenantId, studentId, receiptId) — see the file
//              header for why ownership never surfaces as 403.
// RESPONSE   : { success: true, data: ReceiptDetailDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...STUDENT_FINANCE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = receiptParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const result = await studentFinanceController.getReceiptDetail(
      tenantGuard.tenant.id,
      guard.session.sub,
      parsedParam.data.receiptId
    );

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
