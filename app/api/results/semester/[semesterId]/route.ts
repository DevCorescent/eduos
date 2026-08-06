// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Reporting — Semester Cohort Result
// LAYER  : Route
// FLOW   : Guard → tenant → validate param → controller → response.
// ACCESS : UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION only.
//
//          Narrower than the student-scoped endpoints by two roles. A cohort
//          report carries every student's standing side by side and a merit
//          list ordering them: it is an examination-office document, not a
//          departmental one, and certainly not a student's. STUDENT reaches
//          nothing here — a student learns their own rank through their own
//          result, never by reading the class list.
// BACKEND: resultController → ResultService → ResultRepository → Prisma.
// PURPOSE: A whole semester — every student's summary, pass and fail
//          percentages, average, median, grade distribution and merit list.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { resultController } from "@/lib/controllers/result.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { SEMESTER_RESULT_READ_ROLES } from "@/lib/constants/result";
import { semesterResultParamSchema } from "@/lib/validations/result";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/results/semester/[semesterId]";

// GET
// ACCESS     : SEMESTER_RESULT_READ_ROLES.
// VALIDATION : semesterResultParamSchema. Semester.id is an opaque cuid, so an
//              unrecognised but well-formed id is a 404.
// FLOW       : Authorise → resolve tenant → validate → controller.
//
//              The response is NOT paginated, and that is a correctness
//              decision rather than an omission. A pass percentage, a median
//              and a merit list are all statements about the WHOLE population;
//              computed from a page they would be wrong rather than partial,
//              and a client could not repair them because a median is not
//              additive. The cohort is bounded instead — beyond MAX_COHORT_SIZE
//              the request is refused with 422 rather than silently summarised
//              from a slice.
//
//              The whole cohort is computed against ONE prepared regulation:
//              the component tree is indexed once, the rules once and the band
//              table validated once, then shared by every student. That is the
//              difference between a thousand-student batch that finishes and
//              one that does not.
//
//              A student the engine could not compute appears in `failures`
//              rather than vanishing. One student's marks citing a retired
//              component must never abandon the other nine hundred and
//              ninety-nine, and a cohort report that quietly shrank would
//              misreport every percentage on it.
// RESPONSE   : { success: true, data: SemesterCohortResultDTO }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 422 · 500
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ semesterId: string }> }
) {
  try {
    const guard = await requireRole(...SEMESTER_RESULT_READ_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = semesterResultParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const result = await resultController.getSemesterResult(
      tenantGuard.tenant.id,
      parsedParam.data.semesterId
    );

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
