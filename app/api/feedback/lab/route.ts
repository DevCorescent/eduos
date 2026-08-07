// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Feedback System
// LAYER  : Route
// FLOW   : Guard → parse body → validate → controller → response.
// ACCESS : STUDENT only — see lib/constants/feedback.ts.
//
//          UNIVERSITY_ADMIN, DEPARTMENT_HOD and FACULTY are all deliberately
//          ABSENT. Feedback is an opinion attributed to a person, and an
//          administrator submitting on a student's behalf would be
//          indistinguishable in the data from the student submitting.
// BACKEND: feedbackController → FeedbackService → domain engine →
//          FeedbackRepository → Prisma.
// PURPOSE: Record a student's feedback about a LAB session.
//
// WHAT MAKES THIS THE "LAB" ENDPOINT
//   Not this file. The form the caller names carries `sessionType`, and a
//   LAB form is what this route is for. The distinction is enforced by the
//   SERVICE, which requires a Timetable entry of sessionType LAB before it will
//   accept the submission — per the Phase 20 decision to read the TIMETABLE
//   rather than Course.type, so a lab course taught only as lectures collects
//   no lab feedback and a lecture course with a weekly lab does.
//
//   A route cannot make that check: it would have to read the form and the
//   timetable, which is business logic wearing a route's clothes.
//
//   This URL and /api/feedback/faculty therefore delegate identically. They exist
//   as two paths because a client renders two different pages; the enforcement
//   lives one layer down, where it can see the form.
//
// SECURITY: no studentId in the body schema, which is `.strict()` — supplying
//   one is a 400 rather than a silent strip. The student is resolved from
//   session.sub inside the service. The tenant comes from requireTenant and
//   never from the request.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { feedbackController } from "@/lib/controllers/feedback.controller";
import { requireFeedbackSubmit } from "@/lib/middleware/requireFeedbackAccess";
import { submitFeedbackSchema } from "@/lib/validations/feedback.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "POST /api/feedback/lab";

// POST
// ACCESS     : requireFeedbackSubmit — STUDENT alone.
// VALIDATION : submitFeedbackSchema. Beyond shape it refuses a rating outside
//              1..5 and the same question answered twice; a PARTIAL answer set
//              is accepted, because completeness is decidable only against the
//              form and a student saving progress is doing something ordinary.
// FLOW       : Guard → parse → validate → controller.
//
//              The service additionally refuses a form that is not OPEN (409),
//              a student who was not taught by that faculty member (403), a
//              second submission once one is final (409), an answer citing a
//              question not on the form (422), and a comment on a question that
//              does not invite one (422).
//
//              `now` is taken once and stamped on the submission, so the stored
//              row and the response cannot disagree about when it happened.
// RESPONSE   : { success: true, data: FeedbackSubmissionResultDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 422 · 500
export async function POST(request: NextRequest) {
  try {
    const guard = await requireFeedbackSubmit();
    if (!guard.granted) return guard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = submitFeedbackSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const result = await feedbackController.submitFeedback(
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
