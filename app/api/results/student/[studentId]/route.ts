// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Reporting — Student Result
// LAYER  : Route
// FLOW   : Guard → tenant → validate param and query → controller → response.
// ACCESS : UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION · DEPARTMENT_HOD read
//          any student. STUDENT reads only their own record.
//
//          FACULTY is deliberately absent. A lecturer marks their own sittings
//          and reads their own marks sheets; a student's whole academic record
//          is not theirs to browse.
// BACKEND: resultController → ResultService → ResultRepository → Prisma, with
//          the Result Engine doing every calculation.
// PURPOSE: One student's complete semester results — component marks, course
//          results, grades, credits, pass/fail, SGPA and CGPA.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { resultController } from "@/lib/controllers/result.controller";
import { requireResultAccess } from "@/lib/middleware/requireResultAccess";
import { requireTenant } from "@/lib/middleware/requireTenant";
import {
  studentResultParamSchema,
  studentResultQuerySchema,
} from "@/lib/validations/result";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/results/student/[studentId]";

// GET
// ACCESS     : requireResultAccess — elevated roles read anyone, a STUDENT is
//              confined to themselves. The confinement is applied by the
//              service, which is the layer that can resolve the caller's own
//              record; the route decides only WHICH authority is held.
// VALIDATION : studentResultParamSchema for [studentId], studentResultQuerySchema
//              for ?semesterId. Both ids are opaque cuids, so no format is
//              asserted — an unrecognised but well-formed id is a 404 for an
//              elevated caller and a 403 for a student.
// FLOW       : Authorise → resolve tenant → validate → controller.
//
//              The response is NOT paginated. A result is a coherent academic
//              document: a CGPA computed from a page of semesters would be
//              wrong rather than partial, and a client cannot reassemble it
//              because the credit-weighted average is not additive across
//              pages. The record is bounded instead — a student beyond
//              MAX_STUDENT_COURSES registrations is refused loudly.
//
//              ?semesterId narrows to one semester. Note that the CGPA reported
//              alongside is then computed from that semester alone, which is
//              what "this semester's result" means; a client wanting the true
//              cumulative figure omits the filter.
// RESPONSE   : { success: true, data: StudentResultDTO }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 422 · 500
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ studentId: string }> }
) {
  try {
    const guard = await requireResultAccess();
    if (!guard.granted) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = studentResultParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const parsedQuery = studentResultQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const result = await resultController.getStudentResult(
      tenantGuard.tenant.id,
      parsedParam.data.studentId,
      guard.access,
      parsedQuery.data.semesterId
    );

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
