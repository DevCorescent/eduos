// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Feedback System
// LAYER  : Route
// FLOW   : Guard → validate query → controller → response.
// ACCESS : UNIVERSITY_ADMIN · DEPARTMENT_HOD only.
//
//          FACULTY and STUDENT are both ABSENT, and neither is merely refused
//          afterwards: neither role appears in either guard this endpoint
//          composes, so neither ever reaches the controller. A cross-faculty
//          report is a comparison between colleagues — a quality office's
//          document, not a participant's.
// BACKEND: feedbackController → FeedbackService → domain engine →
//          FeedbackRepository → Prisma.
// PURPOSE: The department or institution feedback report.
//
// EACH FACULTY MEMBER COUNTS ONCE
//   The aggregate is the mean of the FACULTY averages, not of every answer, so
//   a lecturer teaching four hundred students cannot dominate one teaching
//   twelve. That arithmetic lives in lib/domain/feedback/report.ts; this file
//   performs none of it.
//
// SECURITY: no studentId is projected anywhere on this path — the repository's
//   report read uses the ANONYMOUS projection, so an identity is not withheld
//   from the response, it is never selected.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { feedbackController } from "@/lib/controllers/feedback.controller";
import { requireFeedbackReport } from "@/lib/middleware/requireFeedbackAccess";
import { feedbackReportQuerySchema } from "@/lib/validations/feedback.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/feedback/report";

// GET
// ACCESS     : requireFeedbackReport — admin, then head.
// VALIDATION : feedbackReportQuerySchema — optional form, semester, course,
//              faculty, department and category filters, each narrowing an
//              already tenant-scoped set. Read-lenient: an unknown key is
//              stripped, so a cache-busting parameter does not earn a 400.
// FLOW       : Guard → validate → controller.
//
//              The response is NOT paginated, and that is a correctness
//              decision rather than an omission: a mean, a median and a
//              distribution are all statements about the WHOLE population, and
//              computed from a page they would be wrong rather than partial.
//              The cohort is bounded instead — beyond MAX_REPORT_COHORT the
//              request is refused with 422 rather than summarised from a slice.
// RESPONSE   : { success: true, data: AggregateSummary }
// STATUS     : 200 · 400 · 401 · 403 · 422 · 500
export async function GET(request: NextRequest) {
  try {
    const guard = await requireFeedbackReport();
    if (!guard.granted) return guard.response;

    const parsedQuery = feedbackReportQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const report = await feedbackController.getReport(
      guard.context.tenantId,
      parsedQuery.data,
      guard.context.access
    );

    return NextResponse.json(ok(report));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
