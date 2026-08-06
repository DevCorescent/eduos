// ============================================================================
// OWNER  : Gauransh
// MODULE : Result Reporting — Transcript
// LAYER  : Route
// FLOW   : Guard → tenant → validate param → controller → response.
// ACCESS : UNIVERSITY_ADMIN · CONTROLLER_OF_EXAMINATION · DEPARTMENT_HOD read
//          any student. STUDENT reads only their own transcript.
// BACKEND: resultController → ResultService → ResultRepository → Prisma.
// PURPOSE: A student's whole academic record as a transcript — every semester's
//          courses, credits, grades, grade points and attempts, with SGPA, a
//          running CGPA, a degree summary and a classification.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { resultController } from "@/lib/controllers/result.controller";
import { requireResultAccess } from "@/lib/middleware/requireResultAccess";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { studentResultParamSchema } from "@/lib/validations/result";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/results/transcript/[studentId]";

// GET
// ACCESS     : requireResultAccess — the same rule the sibling result and
//              analytics endpoints apply, declared once and shared.
// VALIDATION : studentResultParamSchema for [studentId]. The same schema the
//              sibling routes use for the same segment, so one id cannot be
//              validated three different ways.
// FLOW       : Authorise → resolve tenant → validate → controller.
//
//              The whole record is loaded, never a semester of it, because a
//              transcript's running CGPA and its attempt reconciliation are
//              both degree-wide: a re-sit in semester five can replace a
//              failure from semester two, and no page boundary can express that.
//
//              `isProvisional` is the integrity flag and it is not decoration.
//              A transcript carrying a course whose cohort moderation or curve
//              has not yet run is not a final transcript, and issuing one that
//              did not say so would be issuing a document the university may
//              later have to contradict.
// RESPONSE   : { success: true, data: TranscriptDTO }
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

    const transcript = await resultController.getTranscript(
      tenantGuard.tenant.id,
      parsedParam.data.studentId,
      guard.access
    );

    return NextResponse.json(ok(transcript));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
