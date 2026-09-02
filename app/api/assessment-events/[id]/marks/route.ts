// ============================================================================
// OWNER  : Gauransh
// MODULE : Student Component Score — Marks Sheet
// LAYER  : Route
// FLOW   : Guard → tenant → validate param → controller → service → response.
// ACCESS : UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION · DEPARTMENT_HOD ·
//          FACULTY.
//
//          STUDENT and PARENT reach nothing here. A marks sheet is the whole
//          class, and a student's own marks arrive through their published
//          result — never as a row on someone else's register.
// BACKEND: studentComponentScoreController → StudentComponentScoreService →
//          StudentComponentScoreRepository → Prisma.
// PURPOSE: Read every mark recorded at one sitting.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { studentComponentScoreController } from "@/lib/controllers/studentComponentScore.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { resolveDepartmentId } from "@/lib/auth/departmentScope";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { MARK_READ_ROLES } from "@/lib/constants/studentComponentScore";
import { marksSheetParamSchema } from "@/lib/validations/studentComponentScore";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/assessment-events/[id]/marks";

// GET
// ACCESS     : MARK_READ_ROLES.
// VALIDATION : marksSheetParamSchema. The id is an opaque cuid, so no format is
//              asserted: an unrecognised but well-formed id is a 404.
// FLOW       : Authorise → resolve tenant → validate param → controller.
//
//              The response is NOT paginated, and that is a contract decision
//              rather than an omission. A marks sheet is bounded by the class
//              registered for one sitting, and a page of it is not a marks
//              sheet — an examiner reconciling entries against a register needs
//              the whole list, and a partial one invites exactly the
//              transcription error the reconciliation exists to catch.
//
//              The sitting's own state travels with the sheet, so a client
//              knows whether to render an editable grid without a second
//              request: `acceptsMarks` is the single predicate that decides it,
//              and it is true only while the sitting is OPEN.
//
//              The three counts are tallied in the same pass that builds the
//              rows, so an examiner sees how many were recorded, absent and
//              withheld without counting them client-side.
// RESPONSE   : { success: true, data: MarksSheetDTO }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireRole(...MARK_READ_ROLES);
    if (!guard.authorized) return guard.response;

    // MARK_READ_ROLES admits DEPARTMENT_HOD. Without this a head read every
    // mark in the university; with it they read their own department's.
    const scope = await resolveDepartmentId(guard.session);
    if (!scope.ok) return scope.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const parsedParam = marksSheetParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const sheet = await studentComponentScoreController.getMarksSheet(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      scope.departmentId
    );

    return NextResponse.json(ok(sheet));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
