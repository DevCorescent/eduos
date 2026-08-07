// ============================================================================
// OWNER  : Gauransh
// MODULE : Assignment Management Enhancement (Phase 24)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → parse body → validate →
//          controller → response.
// ACCESS : ASSIGNMENT_SUBMIT_ROLES — STUDENT only.
// BACKEND: assignmentLifecycleController → AssignmentLifecycleService →
//          assignment-analytics domain → AssignmentLifecycleRepository → Prisma.
// PURPOSE: A student submits — or resubmits — their own work.
//
// HOW THIS RELATES TO PHASE 10's POST /[id]/submissions
//   Both are STUDENT-only self-service, so this is the README's Phase 24 URL
//   over the same operation rather than a different one. (The prose in
//   lib/validations/submission.ts describes submissions as recorded "on a
//   student's behalf"; the ROUTE it validates in fact admits STUDENT alone.
//   The route is authoritative.)
//
//   What this path ADDS is the Phase 24 lifecycle Phase 10 has no concept of:
//   a resubmission snapshots the outgoing attempt into
//   AssignmentSubmissionVersion, preserves the grade it supersedes, and reports
//   the attempt number and full history. Phase 10's route is UNTOUCHED and
//   continues to overwrite in place, which is what its own callers expect.
//
//   Both are kept because the README names this URL and Phase 10's is live.
//
// SECURITY: the body schema is .strict() and carries no studentId, so
//          submitting on another student's behalf is not merely refused, it is
//          unexpressible. `submittedAt` and `status` are likewise absent —
//          accepting either would let a client backdate a submission to beat a
//          deadline or record a late one as on-time.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { assignmentLifecycleController } from "@/lib/controllers/assignmentLifecycle.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { ASSIGNMENT_SUBMIT_ROLES } from "@/lib/constants/assignmentLifecycle";
import {
  assignmentLifecycleParamSchema,
  submitAssignmentSchema,
} from "@/lib/validations/assignmentLifecycle.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";
// PHASE 27 faculty event "Assignment Submission". Emitted after the submission
// has committed — see below.
import {
  notificationEmitter,
  userExists,
} from "@/lib/controllers/notificationEmitter.controller";
import { assignmentLifecycleRepository } from "@/lib/repositories/assignmentLifecycle.repository";

const SCOPE = "POST /api/assignments/[id]/submit";

type RouteContext = { params: Promise<{ id: string }> };

// GET
// ACCESS     : requireRole(STUDENT) then requireTenant. Self-service only.
// VALIDATION : assignmentLifecycleParamSchema for [id]. No query, no body.
// PURPOSE    : The README's Phase 24 student features "Submission History",
//              "View Marks" and "Faculty Feedback".
//
//              Marks and feedback are also readable through Phase 10's
//              submissions route, but the VERSION HISTORY this phase introduced
//              was otherwise reachable only as a side effect of resubmitting —
//              a student could not see their earlier attempts without making
//              another one.
//
//              A GET on the /submit path rather than a new URL: the README
//              defines no route for reading a submission, and adding a method
//              to a path it does name is a smaller departure than inventing one
//              it does not.
// FLOW       : Guard → validate → controller.
//
//              The submission is looked up by (assignmentId, resolved
//              studentId), so naming another student's work is unexpressible.
//              A student who has not submitted receives 404 rather than an
//              empty shell that would read as "submitted, nothing attached".
// RESPONSE   : { success: true, data: SubmissionResultDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
//              This handler performs no writes of any kind.
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...ASSIGNMENT_SUBMIT_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = assignmentLifecycleParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    const submission = await assignmentLifecycleController.getOwnSubmission(
      tenantGuard.tenant.id,
      guard.session.sub,
      parsedParam.data.id
    );

    return NextResponse.json(ok(submission));
  } catch (err) {
    return handleRouteError("GET /api/assignments/[id]/submit", err);
  }
}

// POST
// ACCESS     : requireRole(STUDENT) then requireTenant, in that order — an
//              unauthenticated caller receives 401 and a wrongly-roled one 403
//              without the tenant lookup happening at all.
// VALIDATION : assignmentLifecycleParamSchema for [id];
//              submitAssignmentSchema for the body. The body may be empty: a
//              submission is an ACT rather than a payload, and recording that a
//              student submitted with nothing attached is a real outcome.
// FLOW       : Guard → validate → controller.
//
//              The service refuses an assignment that is not PUBLISHED (409), a
//              caller who owns no Student row (403), and a student who is not
//              registered for the course (403).
//
//              LATE is derived by comparing `now` against Assignment.dueDate.
//              A submission at the exact deadline instant is ON TIME.
//
//              A RESUBMISSION snapshots the outgoing attempt into
//              AssignmentSubmissionVersion and clears the live row's grade —
//              marks awarded for work that has just been replaced would
//              otherwise be attributed to a submission nobody assessed. Both
//              writes share one transaction, so the previous attempt cannot be
//              lost.
// RESPONSE   : { success: true, data: SubmissionResultDto } — carrying the
//              attempt number, whether this was a resubmission, and the full
//              history.
// STATUS     : 201 (first submission) · 200 (resubmission) · 400 · 401 · 403 ·
//              404 · 409 · 500
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...ASSIGNMENT_SUBMIT_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsedParam = assignmentLifecycleParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = submitAssignmentSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const result = await assignmentLifecycleController.submit(
      tenantGuard.tenant.id,
      guard.session.sub,
      parsedParam.data.id,
      parsedBody.data,
      new Date()
    );

    // PHASE 27 faculty event "Assignment Submission".
    //
    // AFTER the submission has committed, outside any transaction, and throwing
    // nothing — a submission that succeeded but could not notify must still be
    // a submission. A student's deadline cannot depend on a bell entry.
    //
    // Assignment.createdBy is an unconstrained identity column with no foreign
    // key (TD-C), so it may name a user that no longer exists. It is verified
    // before being addressed, otherwise the row would be undeliverable — the
    // exact dangling-id shape the Phase 27 migration had to clear before its
    // new foreign key could be validated.
    const assignment = await assignmentLifecycleRepository.findAssignment(
      tenantGuard.tenant.id,
      parsedParam.data.id
    );

    if (assignment) {
      const authorResolves = await userExists(tenantGuard.tenant.id, assignment.createdBy);

      await notificationEmitter.assignmentSubmitted({
        tenantId: tenantGuard.tenant.id,
        facultyUserId: authorResolves ? assignment.createdBy : null,
        assignmentTitle: assignment.title,
        assignmentId: assignment.id,
        isResubmission: result.isResubmission,
      });
    }

    // 201 for a row that did not exist, 200 for one that was replaced. A
    // resubmission creates nothing, so reporting Created would misdescribe it.
    return NextResponse.json(
      ok(result, result.isResubmission ? "Assignment resubmitted" : "Assignment submitted"),
      { status: result.isResubmission ? 200 : 201 }
    );
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
