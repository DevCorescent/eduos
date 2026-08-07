// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : Route
// FLOW   : Guard → parse body → validate → controller → response.
// ACCESS : UNIVERSITY_ADMIN · DEPARTMENT_HOD. STUDENT is absent, and that
//          absence is what stops a student allocating seats to themselves.
//          DEPARTMENT_HOD is present because an offering belongs to a
//          department and its seats are that department's to give.
// BACKEND: openElectiveController → OpenElectiveService → allocation engine →
//          CourseRegistrationService → OpenElectiveRepository.
// PURPOSE: Run one offering's seat allocation.
//
// THE MOST CONSEQUENTIAL WRITE IN THIS MODULE
//   It assigns seats, creates enrolments, and moves the offering to a terminal
//   state. Three things protect it:
//
//     • the offering must be LOCKED. Allocating against a preference set that
//       can still move would make the result unreproducible, which is why
//       LOCKED precedes ALLOCATED in this lifecycle rather than following it.
//     • a re-run requires explicit `force`. Without it a second call is a 409,
//       so re-allocation is never something a double-click can cause.
//     • everything happens in ONE transaction: clear prior verdicts, enrol the
//       winners, write every verdict, move the status.
//
// NO ALLOCATION LOGIC LIVES HERE OR IN THE SERVICE
//   Eligibility, ordering and seat awarding are computed by
//   lib/domain/open-electives, which touches no database. The service supplies
//   data and persists the answer; it never decides who gets a seat.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { openElectiveController } from "@/lib/controllers/openElective.controller";
import { requireElectiveManage } from "@/lib/middleware/requireOpenElectiveAccess";
import { allocateSchema } from "@/lib/validations/openElective.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "POST /api/open-electives/allocate";

// POST
// ACCESS     : requireElectiveManage — staff only.
// VALIDATION : allocateSchema, `.strict()`. It carries `offeringId` and an
//              optional `force`, and deliberately REFUSES a `strategy` field:
//              the strategy is configuration on the offering, and accepting a
//              per-request override would let a caller countermand a
//              department's declared policy at allocation time.
// FLOW       : Guard → parse → validate → controller.
//
//              Every applicant receives a verdict, refusals included. A report
//              listing only winners cannot answer "why did I not get it", and
//              that is the question an examination office actually receives.
// RESPONSE   : { success: true, data: AllocationReportDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 422 · 500
export async function POST(request: NextRequest) {
  try {
    const guard = await requireElectiveManage();
    if (!guard.granted) return guard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = allocateSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const report = await openElectiveController.allocate(
      guard.context.tenantId,
      parsedBody.data,
      guard.context.userId,
      new Date()
    );

    return NextResponse.json(ok(report));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
