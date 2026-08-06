// ============================================================================
// OWNER  : Gauransh
// MODULE : Open Elective Management
// LAYER  : Route
// FLOW   : Guard → parse body → validate → controller → response.
// ACCESS : UNIVERSITY_ADMIN · DEPARTMENT_HOD.
// BACKEND: openElectiveController → OpenElectiveService → OpenElectiveRepository.
// PURPOSE: Freeze one offering's preference set.
//
// WHAT LOCKING MEANS HERE
//   OPEN -> LOCKED. Students may no longer add, change or withdraw a choice,
//   and the cohort is now fixed so an allocation can be computed against it and
//   reproduced afterwards. It is the step BEFORE allocation, not after it.
//
//   The transition is decided by the table in lib/constants/openElective.ts and
//   not restated here: DRAFT cannot be locked (nothing has been offered yet)
//   and ALLOCATED cannot be locked (it is terminal — re-opening would leave
//   enrolments whose allocation no longer exists).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { openElectiveController } from "@/lib/controllers/openElective.controller";
import { requireElectiveManage } from "@/lib/middleware/requireOpenElectiveAccess";
import { lockSchema } from "@/lib/validations/openElective.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "PATCH /api/open-electives/lock";

// PATCH
// ACCESS     : requireElectiveManage — staff only.
// VALIDATION : lockSchema, `.strict()`. It carries `offeringId` and NOTHING
//              else — deliberately no target status, because a body able to
//              name any status would make this a general transition endpoint
//              with a misleading name.
// FLOW       : Guard → parse → validate → controller.
// RESPONSE   : { success: true, data: OpenElectiveOfferingDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function PATCH(request: NextRequest) {
  try {
    const guard = await requireElectiveManage();
    if (!guard.granted) return guard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = lockSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const offering = await openElectiveController.lock(
      guard.context.tenantId,
      parsedBody.data,
      new Date()
    );

    return NextResponse.json(ok(offering));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
