// ============================================================================
// OWNER  : Gauransh
// MODULE : Assignment Management Enhancement (Phase 24)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → parse body → validate →
//          controller → response.
// ACCESS : ASSIGNMENT_MANAGE_ROLES — FACULTY · DEPARTMENT_HOD · HOD ·
//          UNIVERSITY_ADMIN.
// BACKEND: assignmentLifecycleController → AssignmentLifecycleService →
//          AssignmentLifecycleRepository → Prisma.
// PURPOSE: Award a mark and written feedback on one submission — the README's
//          "Grade Assignment" and "Add Feedback".
//
// WHY THE SUBMISSION ID IS IN THE BODY
//   The README's route is PATCH /api/assignments/[id]/grade, which has no
//   segment for it. Phase 10's equivalent puts it in the path
//   (/[id]/submissions/[sid]); both reach the same service method, so the
//   grading rules exist once and the two URLs cannot drift apart. Phase 10's
//   route is untouched and still works.
//
// ONE DELIBERATE DIVERGENCE FROM PHASE 10: ZERO IS A VALID MARK
//   Phase 10's gradeSubmissionSchema requires a positive mark. A student who
//   submitted nothing of merit scores zero, and refusing to record that forces
//   a faculty member either to award a mark that was not earned or to leave the
//   submission ungraded forever. This is a new endpoint stating its own rule;
//   it does not change Phase 10's.
//
// SECURITY: gradedBy comes from session.sub and is absent from the schema, so a
//          grade cannot be attributed to another user. The schema is .strict(),
//          so supplying `status`, `gradedAt` or `studentId` is a 400.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { assignmentLifecycleController } from "@/lib/controllers/assignmentLifecycle.controller";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { ASSIGNMENT_MANAGE_ROLES } from "@/lib/constants/assignmentLifecycle";
import {
  assignmentLifecycleParamSchema,
  gradeAssignmentSchema,
} from "@/lib/validations/assignmentLifecycle.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";
// PHASE 27 student event "Assignment Evaluated". Emitted after the grade has
// committed — see below.
import {
  findStudentUserId,
  notificationEmitter,
  notifyAfterCommit,
} from "@/lib/controllers/notificationEmitter.controller";
import { assignmentLifecycleRepository } from "@/lib/repositories/assignmentLifecycle.repository";

const SCOPE = "PATCH /api/assignments/[id]/grade";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH
// ACCESS     : requireRole(ASSIGNMENT_MANAGE_ROLES) then requireTenant.
// VALIDATION : assignmentLifecycleParamSchema for [id]; gradeAssignmentSchema
//              for the body — submissionId and marks required, feedback
//              optional and bounded at 5000 characters.
//
//              The upper bound on marks cannot be applied in validation because
//              it depends on Assignment.maxMarks, a stored value the schema
//              layer cannot read. The SERVICE enforces marks <= maxMarks after
//              loading the parent and answers 400 naming the maximum.
// FLOW       : Guard → validate → controller.
//
//              The update's own predicate asserts BOTH that the submission
//              belongs to the named assignment and that the assignment belongs
//              to the caller's tenant — AssignmentSubmission carries no
//              tenantId of its own (TD-A), so ownership is anchored through the
//              relation. A submission moved between a check and the write
//              therefore cannot be graded: a zero row count becomes the 404.
// RESPONSE   : { success: true, data: SubmittedRowDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireRole(...ASSIGNMENT_MANAGE_ROLES);
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

    const parsedBody = gradeAssignmentSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const graded = await assignmentLifecycleController.grade(
      tenantGuard.tenant.id,
      parsedParam.data.id,
      parsedBody.data,
      guard.session.sub,
      new Date()
    );

    // PHASE 27 student event "Assignment Evaluated".
    //
    // AFTER the grade has committed, outside any transaction, throwing nothing.
    // The recipient is resolved Student -> User because the notification is
    // addressed to a person, not to an enrolment.
    const assignment = await assignmentLifecycleRepository.findAssignment(
      tenantGuard.tenant.id,
      parsedParam.data.id
    );

    if (assignment) {
      const studentUserId = await findStudentUserId(
        tenantGuard.tenant.id,
        graded.student.studentId
      );

      await notifyAfterCommit("PATCH /api/assignments/[id]/grade", async () => {
        await notificationEmitter.assignmentEvaluated({
          tenantId: tenantGuard.tenant.id,
          studentUserId,
          assignmentTitle: assignment.title,
          assignmentId: assignment.id,
          marks: parsedBody.data.marks,
          maxMarks: assignment.maxMarks,
        });
      });
    }

    return NextResponse.json(ok(graded, "Submission graded"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
