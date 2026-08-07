// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : Route
// FLOW   : Guard → parse body → validate → controller → response.
// ACCESS : STUDENT only.
//
//          UNIVERSITY_ADMIN and DEPARTMENT_HOD are deliberately ABSENT. An
//          administrator choosing on a student's behalf would be
//          indistinguishable in the data from the student choosing, and
//          preference order is the input to an allocation someone may later
//          dispute. If a correction is needed it belongs in an audited
//          administrative flow, not in the student's own endpoint.
// BACKEND: openElectiveController → OpenElectiveService → OpenElectiveRepository.
// PURPOSE: Record a student's ranked choices for one semester.
//
// THIS REPLACES, IT DOES NOT APPEND
//   A submission is the student's WHOLE preference list for that semester. The
//   previous set is deleted and the new one written inside one transaction —
//   a per-row diff would have to survive a transient duplicate rank mid-flight,
//   which the (student, semester, rank) unique constraint would abort.
//
// SECURITY: no studentId in the body schema, which is `.strict()` — supplying
//   one is a 400 rather than a silent strip. The student is resolved from
//   session.sub inside the service.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { openElectiveController } from "@/lib/controllers/openElective.controller";
import { requireElectiveSelect } from "@/lib/middleware/requireOpenElectiveAccess";
import { submitPreferencesSchema } from "@/lib/validations/openElective.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "POST /api/open-electives/select";

// POST
// ACCESS     : requireElectiveSelect — STUDENT alone.
// VALIDATION : submitPreferencesSchema. Beyond shape, it refuses three things
//              no per-field rule would catch: the same offering ranked twice,
//              two offerings sharing a rank, and a gap in the ranks. Ranks must
//              be a contiguous 1..n — a list ranked 1, 2, 5 is almost always a
//              client that dropped a row, and honouring it would silently
//              allocate against choices the student did not know they had lost.
// FLOW       : Guard → parse → validate → controller.
//
//              The service additionally refuses a choice whose offering is not
//              OPEN (409), belongs to another semester (422), does not resolve
//              (404), or that the student is not eligible for (403). Eligibility
//              is checked HERE at selection rather than later at allocation,
//              because being told at allocation time is the worse of the two
//              moments to find out.
//
//              `now` is taken once and stamped on every choice — it is the FCFS
//              tie-breaker, so all of one submission must share an instant.
// RESPONSE   : { success: true, data: PreferenceSubmissionDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 422 · 500
export async function POST(request: NextRequest) {
  try {
    const guard = await requireElectiveSelect();
    if (!guard.granted) return guard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = submitPreferencesSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const result = await openElectiveController.submitPreferences(
      guard.context.tenantId,
      guard.context.userId,
      parsedBody.data,
      new Date()
    );

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
