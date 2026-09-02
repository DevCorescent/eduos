// ============================================================================
// MODULE : Attendance correction review (PRD §13.2 "Academic admin approval")
// LAYER  : Route handler
// PURPOSE: Approve a correction — which APPLIES it to the register — or reject
//          it, which changes nothing and records why.
//
// WHY FACULTY IS NOT IN THE REVIEW SET
//   ATTENDANCE_CORRECTION_REVIEW_ROLES mirrors ATTENDANCE_UNLOCK_ROLES. This
//   module already draws the line at "a lecturer may finalise their own register
//   but may not reopen it", and approving a change to a finalised register is
//   the same act. Self-review is refused separately in the domain, so a head who
//   raised a request still cannot decide it.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { readRequestOrigin } from "@/lib/middleware/requireAttendanceLockAccess";
import { ATTENDANCE_CORRECTION_REVIEW_ROLES } from "@/lib/constants/attendanceCorrection";
import { reviewCorrection } from "@/lib/services/attendanceCorrection.service";
import {
  correctionIdParamSchema,
  reviewCorrectionSchema,
} from "@/lib/validations/attendanceCorrection";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "PATCH /api/attendance/corrections/[id]";

// PATCH
// ACCESS   : ATTENDANCE_CORRECTION_REVIEW_ROLES — DEPARTMENT_HOD, HOD,
//            UNIVERSITY_ADMIN. FACULTY is deliberately absent.
// BODY     : { decision: "APPROVE" | "REJECT", note?: string }
//            A rejection without a note is refused: the person whose correction
//            was refused is owed the reason.
// EFFECT   : APPROVE applies requestedStatus to the attendance record inside the
//            same transaction as the audit entry. REJECT leaves the register
//            untouched. Both are recorded.
// RESPONSE : { success: true, data: request }
// STATUS   : 200 · 400 · 401 · 403 · 404 · 409 · 422 · 500
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole(...ATTENDANCE_CORRECTION_REVIEW_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const parsedParam = correctionIdParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsed = reviewCorrectionSchema.safeParse(body);
    if (!parsed.success) return validationFailure(parsed.error);

    const origin = readRequestOrigin(request.headers);

    const updated = await reviewCorrection(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsed.data.decision,
      parsed.data.note,
      {
        // The reviewer is the authenticated subject, which is also what the
        // self-review refusal compares against.
        userId: guard.session.sub,
        ipAddress: origin.ipAddress,
        userAgent: origin.userAgent,
      }
    );

    return NextResponse.json(
      ok(updated, parsed.data.decision === "APPROVE" ? "Correction applied" : "Correction rejected")
    );
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
