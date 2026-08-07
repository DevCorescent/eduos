// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : Route
// FLOW   : Guard → validate query → controller → response.
// ACCESS : STUDENT only — the endpoint answers "what did I choose and what came
//          of it", which only the student themselves is asking. Staff read a
//          cohort's position through the allocation report instead.
// BACKEND: openElectiveController → OpenElectiveService → OpenElectiveRepository.
// PURPOSE: One student's own preferences and allocation verdicts.
//
// SECURITY: no studentId in the query schema — a supplied one is stripped. The
//   student is resolved from session.sub, so a student asking about anyone else
//   receives their OWN record rather than an error that would confirm the other
//   student exists.
//
// QUERY BUDGET: three statements — resolve, preferences, allocations.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { openElectiveController } from "@/lib/controllers/openElective.controller";
import { requireElectiveStatus } from "@/lib/middleware/requireOpenElectiveAccess";
import { electiveStatusQuerySchema } from "@/lib/validations/openElective.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/open-electives/status";

// GET
// ACCESS     : requireElectiveStatus.
// VALIDATION : electiveStatusQuerySchema. `semesterId` is REQUIRED — defaulting
//              to "the current semester" would need this layer to decide which
//              semester is current, a determination it cannot make and should
//              not guess.
// FLOW       : Guard → validate → controller.
//
//              `isEditable` is derived from the chosen offerings' own status
//              rather than restated here, so a client need not know that OPEN
//              is the only editable state.
// RESPONSE   : { success: true, data: ElectiveStatusDto }
// STATUS     : 200 · 400 · 401 · 403 · 500
export async function GET(request: NextRequest) {
  try {
    const guard = await requireElectiveStatus();
    if (!guard.granted) return guard.response;

    const parsedQuery = electiveStatusQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const status = await openElectiveController.getStatus(
      guard.context.tenantId,
      guard.context.userId,
      parsedQuery.data.semesterId
    );

    return NextResponse.json(ok(status));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
