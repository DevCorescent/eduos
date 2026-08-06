// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessment Event — Lifecycle Transition
// LAYER  : Route
// FLOW   : Guard → tenant → validate param → validate body → controller →
//          service → response.
// ACCESS : UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION.
//
//          This one endpoint carries the whole locking and publication
//          workflow, so it is the narrowest gate in the module: opening a
//          sitting authorises marks to be written against it, locking freezes
//          them, and publishing reveals them to students.
// BACKEND: assessmentEventController → AssessmentEventService →
//          AssessmentEventRepository / AuditLogRepository → Prisma.
// PURPOSE: Move a sitting through DRAFT → OPEN → LOCKED → PUBLISHED, and back
//          where the workflow permits.
//
// WHY ONE ENDPOINT RATHER THAN FOUR VERBS
//   open, lock, publish and unpublish would be four route files repeating the
//   same guard/validate/delegate skeleton, and the state machine would be
//   spread across four of them instead of living in one constant. Naming the
//   target status in the body keeps every transition on one path.
//
//   This is a deliberate departure from C2, where activate and archive ARE
//   separate routes. Two transitions justify two endpoints; five do not.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { assessmentEventController } from "@/lib/controllers/assessmentEvent.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { ASSESSMENT_EVENT_MANAGE_ROLES } from "@/lib/constants/assessmentEvent";
import {
  assessmentEventParamSchema,
  assessmentEventStatusSchema,
} from "@/lib/validations/assessmentEvent";
import { buildRequestContext } from "@/lib/utils/request-context";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "POST /api/assessment-events/[id]/status";

// POST
// ACCESS     : ASSESSMENT_EVENT_MANAGE_ROLES.
// VALIDATION : assessmentEventParamSchema for the segment,
//              assessmentEventStatusSchema for the body — a single enum member
//              naming the target state. Which transitions are LEGAL depends on
//              the stored status, so the state machine is applied in the
//              service.
// FLOW       : Authorise → resolve tenant → validate → controller.
//
//              The permitted moves are:
//                DRAFT     → OPEN                  mark entry begins
//                OPEN      → LOCKED                entry closes, marks frozen
//                LOCKED    → PUBLISHED             students can see them
//                LOCKED    → OPEN                  reopen to correct an error
//                PUBLISHED → LOCKED                unpublish
//
//              OPEN → PUBLISHED is absent, and its absence is the verification
//              gate: nothing reaches a student without someone having closed
//              entry first.
//
//              The two backward moves are deliberate. A lifecycle with no
//              correction path is the defect recorded as TD-C40, where an
//              accidental revocation could only be undone through direct
//              database access. Both are audited like any other change, with
//              the before and after status recorded.
//
//              Re-requesting the CURRENT status is refused rather than treated
//              as a no-op: the machine lists no self-transition, and a silent
//              success would let a caller believe a publication happened when
//              it did not.
// RESPONSE   : { success: true, data: AssessmentEventDTO,
//                message: "Assessment event status updated" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
//
//              409 — the requested move is not one the machine permits.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireRole(...ASSESSMENT_EVENT_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = assessmentEventParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = assessmentEventStatusSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const event = await assessmentEventController.changeStatus(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedBody.data,
      buildRequestContext(request, guard.session)
    );

    return NextResponse.json(ok(event, "Assessment event status updated"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
