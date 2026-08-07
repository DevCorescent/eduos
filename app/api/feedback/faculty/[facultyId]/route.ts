// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Feedback System
// LAYER  : Route
// FLOW   : Guard → validate param and query → controller → response.
// ACCESS : UNIVERSITY_ADMIN · DEPARTMENT_HOD · FACULTY, in that precedence.
//          STUDENT reaches nothing here — a student gives feedback, they do not
//          read a faculty member's record.
// BACKEND: feedbackController → FeedbackService → domain engine →
//          FeedbackRepository → Prisma.
// PURPOSE: One faculty member's feedback analytics.
//
// THREE AUDIENCES, THREE DIFFERENT ANSWERS
//   ADMIN   sees everything, ungated.
//   HOD     is gated by the disclosure threshold.
//   FACULTY is gated by the threshold AND confined to their own record — the
//           facultyId in the guard's context is resolved from session.sub, and
//           the service refuses any record but that one.
//
//   The route names none of those rules. It carries the AUTHORITY the guard
//   established and lets the domain engine decide, which is why there is no
//   comparison of a count to a threshold anywhere in this file.
//
// SECURITY: the [facultyId] segment names the SUBJECT, never the caller. A
//   faculty member cannot read a colleague by putting their id in the path —
//   the service compares it against the guard's own resolved id and refuses.
//   The refusal carries no response count, so it cannot confirm the colleague
//   exists.
//
// QUERY BUDGET: two statements when withheld, four when disclosed. The count is
//   read BEFORE the submissions, so a caller below the threshold never has the
//   cohort's answers in memory at all.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { feedbackController } from "@/lib/controllers/feedback.controller";
import { requireFacultyFeedbackRead } from "@/lib/middleware/requireFeedbackAccess";
import {
  facultyFeedbackQuerySchema,
  facultyParamSchema,
} from "@/lib/validations/feedback.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/feedback/faculty/[facultyId]";

// GET
// ACCESS     : requireFacultyFeedbackRead — admin, then head, then faculty. A
//              caller holding an elevated role is treated as elevated even if
//              they are also a faculty member, because confining an
//              administrator to their own record would be the wrong reading of
//              a role they hold deliberately.
// VALIDATION : facultyParamSchema for [facultyId], facultyFeedbackQuerySchema
//              for the optional course, semester and form filters. FacultyMember.id
//              is an opaque cuid, so an unrecognised but well-formed id is a 404
//              rather than a 400.
//
//              There is no `includeStudentIdentity` parameter and there must
//              never be one — whether a caller sees attribution is decided by
//              their ROLE, in the service, against the repository's two
//              projections.
// FLOW       : Guard → validate → controller.
// RESPONSE   : { success: true, data: FacultySummary }
//              `analytics` is null when withheld, and `disclosure` carries the
//              reason and the shortfall — a withheld summary still reports the
//              response COUNT, because "3 responses, 2 more needed" is
//              actionable and "unavailable" is not.
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ facultyId: string }> }
) {
  try {
    const guard = await requireFacultyFeedbackRead();
    if (!guard.granted) return guard.response;

    const parsedParam = facultyParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const parsedQuery = facultyFeedbackQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) return validationFailure(parsedQuery.error);

    const summary = await feedbackController.getFacultyFeedback(
      guard.context.tenantId,
      parsedParam.data.facultyId,
      parsedQuery.data,
      guard.context.access
    );

    return NextResponse.json(ok(summary));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
