// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Reporting — Student Analytics
// LAYER  : Route
// FLOW   : Guard → tenant → validate param → controller → response.
// ACCESS : UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION · DEPARTMENT_HOD read
//          any student. STUDENT reads only their own analytics.
// BACKEND: resultController → ResultService → ResultRepository → Prisma.
// PURPOSE: A student's performance over their whole record — SGPA and CGPA
//          trend, component breakdown, credit position, backlogs, improvement
//          history and academic standing.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { resultController } from "@/lib/controllers/result.controller";
import { requireResultAccess } from "@/lib/middleware/requireResultAccess";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { studentResultParamSchema } from "@/lib/validations/result";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/results/analytics/[studentId]";

// GET
// ACCESS     : requireResultAccess — the same rule as the sibling result and
//              transcript endpoints.
// VALIDATION : studentResultParamSchema for [studentId].
// FLOW       : Authorise → resolve tenant → validate → controller.
//
//              Every figure returned is DERIVED from results the Result Engine
//              already produced — nothing here recomputes a percentage or a
//              grade. That is what stops a dashboard and a transcript
//              disagreeing about the same semester.
//
//              The component breakdown names no component. "Internal versus
//              external" is read by the client from the codes this returns,
//              because WHICH components are internal is a tenant's
//              configuration and not a fact the engine may assume — the whole
//              point of the phase. Only leaf components are totalled; including
//              their parents would count every internal mark twice.
//
//              `rankHistory` is returned empty from this endpoint by design. A
//              rank is a statement about a cohort, and a rank computed from one
//              student's record would be a rank of one. Cohort positions come
//              from GET /api/results/semester/[semesterId], which has the
//              cohort to compute them against.
// RESPONSE   : { success: true, data: StudentAnalyticsDTO }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 422 · 500
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ studentId: string }> }
) {
  try {
    const guard = await requireResultAccess();
    if (!guard.granted) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = studentResultParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const analytics = await resultController.getAnalytics(
      tenantGuard.tenant.id,
      parsedParam.data.studentId,
      guard.access
    );

    return NextResponse.json(ok(analytics));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
