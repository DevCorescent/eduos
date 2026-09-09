// ============================================================================
// MODULE : Result Reporting — Semester Result Approval
// LAYER  : Route
// FLOW   : Guard → tenant → validate param → body → controller → response.
// ACCESS : SEMESTER_RESULT_APPROVE_ROLES — CONTROLLER_OF_EXAMINATION ONLY.
//
//          NARROWER THAN THE READ SET BY ONE, AND THE OMISSION IS THE POINT.
//          UNIVERSITY_ADMIN reads the cohort report through the sibling GET and
//          does NOT sign it off. Approval is the examination controller's
//          statutory act — the moment a computed result becomes the
//          institution's official position on a cohort — and PRD §49.4 places
//          it between Moderation and Publication precisely because it belongs
//          to a named office rather than to general administration. A confirmed
//          product decision, pinned by a test so widening it must be deliberate.
//
//          DEPARTMENT_HOD cannot read a cohort report at all, so there is
//          nothing here for them to approve. FACULTY, STUDENT and PARENT reach
//          neither endpoint.
// BACKEND: resultController → ResultService → ResultRepository → Prisma.
// PURPOSE: Record the Controller of Examination's sign-off on one semester.
//
// APPROVAL IS NOT PUBLICATION. This writes APPROVED and never PUBLISHED. PRD
// §49.4 keeps the two stages apart, and collapsing them would release marks to
// students the instant a controller approved them.
//
// NO CALCULATION IS DUPLICATED HERE OR IN THE SERVICE. The precondition is
// checked by running the same getSemesterResult the GET serves, so a sign-off
// can never be granted against a different computation from the one the
// controller was looking at.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { resultController } from "@/lib/controllers/result.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { SEMESTER_RESULT_APPROVE_ROLES } from "@/lib/constants/result";
import { approveSemesterResultSchema, semesterResultParamSchema } from "@/lib/validations/result";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "POST /api/results/semester/[semesterId]/approve";

// POST
// ACCESS     : SEMESTER_RESULT_APPROVE_ROLES.
// VALIDATION : semesterResultParamSchema for the id; approveSemesterResultSchema
//              for the body, which carries at most an optional `remarks`.
//
//              status, approvedAt and approvedById are absent from that schema
//              and therefore stripped from any body supplying them. The status
//              is fixed by which endpoint was called, the timestamp is the
//              server's, and the approver is the authenticated subject — a
//              client able to set the last of those could attribute a statutory
//              sign-off to a colleague.
//
//              A MISSING BODY IS VALID. The ordinary approval carries no
//              remark, so an empty request is the common case rather than a
//              client error.
// FLOW       : Authorise → resolve tenant → validate → controller.
//
//              The tenant comes from requireTenant and is never read from the
//              request, so a controller can only ever approve a semester
//              belonging to their own university. An id from another tenant is
//              indistinguishable from one that exists nowhere: both are the
//              404 the service raises from its tenant-scoped semester lookup.
// RESPONSE   : { success: true, data: SemesterCohortResultDTO,
//                message: "Semester result approved" }
//
//              The whole cohort report is returned, now carrying the stored
//              decision, rather than a bare acknowledgement — so the caller
//              renders what was actually persisted instead of assuming its own
//              request succeeded as sent.
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 422 · 500
//
//              409 — the cohort is already APPROVED (or PUBLISHED), is empty,
//                    or carries students the engine could not compute.
//              422 — the cohort exceeds MAX_COHORT_SIZE, raised by the shared
//                    read path.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ semesterId: string }> }
) {
  try {
    const guard = await requireRole(...SEMESTER_RESULT_APPROVE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = semesterResultParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    // An absent or unparseable body is treated as "approve with no remark",
    // which is the ordinary case. Only a body that IS present and malformed in
    // its shape is rejected, by the schema below.
    let rawBody: unknown = {};
    try {
      rawBody = (await request.json()) ?? {};
    } catch {
      rawBody = {};
    }

    const parsedBody = approveSemesterResultSchema.safeParse(rawBody);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const result = await resultController.approveSemesterResult(
      tenantGuard.tenant.id,
      parsedParam.data.semesterId,
      // The authenticated subject. Never a body field — see VALIDATION above.
      guard.session.sub,
      parsedBody.data.remarks
    );

    return NextResponse.json(ok(result, "Semester result approved"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
