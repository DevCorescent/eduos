// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessments — Assignment Submission Detail
// FLOW   : Guard → tenant → params → prove the parent assignment → resolve the
//          caller's own student row where required → assignment-scoped lookup →
//          read / grade → response.
// ACCESS : GET   — UNIVERSITY_ADMIN · FACULTY (any) · STUDENT (own only)
//          PATCH — UNIVERSITY_ADMIN · FACULTY. A student submits their own work
//          but never grades it.
// BACKEND: Prisma
// PURPOSE: View a single submission and record a grade against it.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isRecordNotFound } from "@/lib/utils/prisma-errors";
import { assignmentIdParamSchema } from "@/lib/validations/assignment";
import {
  gradeSubmissionSchema,
  submissionIdParamSchema,
} from "@/lib/validations/submission";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/**
 * Columns returned for a submission.
 *
 * The collection route declares the same shape. It is restated here rather than
 * imported because a Next.js route module may only export route handlers and
 * segment config, so this constant cannot be shared from there.
 *
 * No relation is expanded. Neither the assignment nor the student is embedded
 * even though this endpoint is scoped by both: the caller already holds the
 * assignment id from the URL, and the student is either the caller themselves or
 * identified by the studentId column.
 *
 * There is no tenantId to report. AssignmentSubmission is one of only two models
 * in the schema that store tenant-owned data with no tenant column, so every
 * query here is anchored on an assignment already proven to belong to the
 * caller's tenant.
 */
const SUBMISSION_SELECT = {
  id: true,
  assignmentId: true,
  studentId: true,
  status: true,
  submittedAt: true,
  attachments: true,
  marks: true,
  feedback: true,
  gradedAt: true,
  gradedBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

// AssignmentSubmission holds no BigInt or Decimal column, so the shared
// serialize() helper is not applied here.

/**
 * The single 404 both handlers answer with.
 *
 * Built here rather than inline so every miss produces the identical status,
 * code and message, byte for byte — an unknown assignment, an assignment owned
 * by another tenant, an assignment not yet published when the caller is a
 * student, an unknown submission, a submission belonging to a different
 * assignment, and a submission belonging to another student when the caller is a
 * student. Collapsing all seven into one response is what stops the endpoint
 * confirming that any of those things exist.
 */
function notFound(): NextResponse {
  return NextResponse.json(fail("Submission not found", "NOT_FOUND"), { status: 404 });
}

/** Built on the rejection path — existing FORBIDDEN code and 403 status. */
function forbidden(): NextResponse {
  return NextResponse.json(fail("Forbidden", "FORBIDDEN"), { status: 403 });
}

/**
 * Parse both route segments, each from its own key.
 *
 * assignmentIdParamSchema is keyed on id and submissionIdParamSchema on sid,
 * matching the segment names Next.js supplies. They are parsed separately
 * because a plain z.object() strips unknown keys: parsing the combined
 * { id, sid } object against either one alone would silently validate a single
 * segment and ignore the other. Same reasoning as
 * DELETE /api/curricula/[id]/subjects/[subjectId], the project's other
 * two-parameter nested route.
 */
function parseParams(raw: { id: string; sid: string }) {
  const parsedAssignment = assignmentIdParamSchema.safeParse({ id: raw.id });
  const parsedSubmission = submissionIdParamSchema.safeParse({ sid: raw.sid });

  if (!parsedAssignment.success || !parsedSubmission.success) return null;

  return { assignmentId: parsedAssignment.data.id, submissionId: parsedSubmission.data.sid };
}

/**
 * Resolve the caller's own Student row within this tenant.
 *
 * Student.userId is @unique and the lookup is tenant-scoped, so the resolution is
 * unambiguous. A caller holding the STUDENT role with no Student row in this
 * tenant resolves to null and is refused rather than served someone else's
 * submission — the same treatment already applied in the collection route and in
 * GET /api/attendance/report/[studentId].
 */
async function resolveSelf(userId: string, tenantId: string) {
  return prisma.student.findFirst({
    where: { userId, tenantId },
    select: { id: true },
  });
}

// GET
// ACCESS     : UNIVERSITY_ADMIN · FACULTY · STUDENT, with different scope.
//
//              Role precedence is UNIVERSITY_ADMIN > FACULTY > STUDENT, so the
//              elevated pair is tested first and a caller holding either reads
//              any submission for the assignment. Only a caller who holds
//              neither falls through to the STUDENT branch, which is narrowed to
//              their own row.
//
//              Scope is decided by asking requireRole twice rather than by
//              reading session.roles: the roles in the token are a snapshot from
//              sign-in, and requireRole resolves them live against UserRole on
//              every request so a revoked role takes effect immediately. An
//              anonymous caller fails both and receives requireAuth's 401 from
//              the second, so the fallback cannot turn a 401 into a 403.
// VALIDATION : assignmentIdParamSchema for [id] and submissionIdParamSchema for
//              [sid], each parsed from its own key so neither can stand in for
//              the other. Both must be non-empty once trimmed. Both ids are
//              cuids and therefore opaque keys, so an
//              unrecognised-but-well-formed value is a 404 rather than a 400.
//              No query parameters are read: this addresses a single resource.
// FLOW       : Authorise → resolve tenant → validate both params → prove the
//              parent assignment → read the submission filtered by BOTH its own
//              id and that assignmentId.
//
//              Both route parameters are authoritative and sid alone never
//              authorises anything. AssignmentSubmission has no tenantId, so its
//              tenant is inherited entirely through its assignment: a lookup
//              keyed on the submission id alone would reach any submission in
//              any tenant. The parent is therefore resolved first, tenant-scoped,
//              and the submission is then filtered by that assignmentId as well
//              as its own — a submission belonging to a different assignment
//              matches nothing, whether that assignment is in this tenant or
//              another one.
//
//              For a student the assignment lookup additionally requires
//              publishedAt to be set, and the submission query adds their own
//              studentId. A student therefore cannot read a classmate's
//              submission, and cannot learn whether an unpublished assignment
//              exists. Every one of those failures returns the identical 404.
// RESPONSE   : { success: true, data: <Submission> }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; sid: string }> }
) {
  try {
    // Precedence: the elevated pair is tested first, so a caller holding either
    // never reaches the student branch.
    const elevatedGuard = await requireRole("UNIVERSITY_ADMIN", "FACULTY");

    let session;
    let isElevated: boolean;

    if (elevatedGuard.authorized) {
      session = elevatedGuard.session;
      isElevated = true;
    } else {
      const studentGuard = await requireRole("STUDENT");
      if (!studentGuard.authorized) return studentGuard.response;

      session = studentGuard.session;
      isElevated = false;
    }

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsed = parseParams(await params);
    if (!parsed) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const { assignmentId, submissionId } = parsed;

    // findFirst rather than findUnique: the tenant filter — and, for a student,
    // the published predicate — are part of the lookup, so an out-of-scope
    // assignment can never be resolved or even acknowledged.
    const assignment = await prisma.assignment.findFirst({
      where: isElevated
        ? { id: assignmentId, tenantId: tenant.id }
        : { id: assignmentId, tenantId: tenant.id, publishedAt: { not: null } },
      select: { id: true },
    });

    if (!assignment) {
      return notFound();
    }

    // Filtered by assignmentId as well as its own id, so a submission belonging
    // to another assignment matches nothing. A student is additionally narrowed
    // to their own studentId, resolved from the session.
    const where: { id: string; assignmentId: string; studentId?: string } = {
      id: submissionId,
      assignmentId,
    };

    if (!isElevated) {
      const self = await resolveSelf(session.sub, tenant.id);
      if (!self) {
        return forbidden();
      }
      where.studentId = self.id;
    }

    const submission = await prisma.assignmentSubmission.findFirst({
      where,
      select: SUBMISSION_SELECT,
    });

    if (!submission) {
      return notFound();
    }

    return NextResponse.json(ok(submission));
  } catch (err) {
    console.error("[GET /api/assignments/[id]/submissions/[sid]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN · FACULTY. A caller holding only STUDENT is
//              rejected by the guard with 403 — a student submits their own work
//              but never grades it. This is the mirror of the collection route,
//              where POST is STUDENT-only and staff are refused.
// VALIDATION : assignmentIdParamSchema for [id] and submissionIdParamSchema for
//              [sid]. gradeSubmissionSchema for the body: marks required and a
//              positive integer, feedback optional and trimmed. An empty body
//              fails because marks is required. id, assignmentId, studentId,
//              status, submittedAt, gradedAt, gradedBy, createdAt and updatedAt
//              are absent from the schema and so are stripped from any body that
//              supplies them.
//
//              marks is additionally bounded above by the parent assignment's
//              maxMarks. That bound cannot live in the validation module because
//              it depends on a stored value, so it is applied here after the
//              assignment is loaded. It is reported as the project's standard
//              400 rather than a bespoke status: the request is malformed with
//              respect to the resource it addresses, and every other 400 in this
//              project carries the same shape. maxMarks itself is bounded to a
//              positive integer on the assignment schema, so the permitted range
//              is never empty.
// FLOW       : Authorise → resolve tenant → validate params and body → load the
//              parent assignment with its maxMarks → apply the upper bound →
//              prove the submission belongs to that assignment → apply one
//              atomic update scoped by id and assignmentId.
//
//              The write is scoped by assignmentId as well as the submission's
//              own id, so it cannot reach a submission under a different
//              assignment even if the id were guessed — which matters because
//              AssignmentSubmission has no tenantId of its own and the parent is
//              the only thing establishing ownership.
//
//              status becomes GRADED, gradedAt is the server clock and gradedBy
//              is the authenticated session, so a grade can never be attributed
//              to another user. submittedAt, assignmentId and studentId are
//              absent from the update data, so a grade can neither move a
//              submission to a different student or assignment nor rewrite when
//              it arrived.
//
//              Re-grading is permitted and simply overwrites: marks, feedback,
//              gradedAt and gradedBy are all refreshed. The README provides PATCH
//              rather than a one-shot action, which is what a revisable operation
//              looks like. No RETURNED state is set — nothing in the schema or
//              the approved decisions defines what returning a submission means,
//              and there is no column to record it — so GRADED is the only status
//              this endpoint writes. No resubmission or late-submission logic
//              appears here either: neither is in scope, and dueDate is never
//              read.
// RESPONSE   : { success: true, data: <Submission>,
//                message: "Submission graded" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              No 409 is reachable and none is handled. The only unique
//              constraint on this model is @@unique([assignmentId, studentId]),
//              and neither column is writable here, so a uniqueness clash cannot
//              occur. There is no lifecycle transition to refuse either: grading
//              an already-graded submission is a legitimate re-grade rather than
//              an illegal state change. P2025 remains the race backstop — if the
//              row is removed between the lookup and the update, that is reported
//              as the same 404 the lookup would have produced.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sid: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN", "FACULTY");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { session, tenant } = tenantGuard;

    const parsed = parseParams(await params);
    if (!parsed) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = gradeSubmissionSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedBody.error),
        },
        { status: 400 }
      );
    }

    const { assignmentId, submissionId } = parsed;
    const { marks, feedback } = parsedBody.data;

    // maxMarks is loaded here because the upper bound on marks depends on it and
    // no validation schema can read a stored value.
    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, tenantId: tenant.id },
      select: { maxMarks: true },
    });

    if (!assignment) {
      return notFound();
    }

    if (marks > assignment.maxMarks) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    // Ownership is proven before anything is written. A submission under a
    // different assignment stops here and no write is issued at all.
    const existing = await prisma.assignmentSubmission.findFirst({
      where: { id: submissionId, assignmentId },
      select: { id: true },
    });

    if (!existing) {
      return notFound();
    }

    // Scoped by assignmentId as well as id, so the write cannot reach a
    // submission under a different assignment. Single statement, so the update is
    // atomic on its own — status, marks, feedback, gradedAt and gradedBy all move
    // together and no window exists in which some are written and others are not.
    const submission = await prisma.assignmentSubmission.update({
      where: { id: submissionId, assignmentId },
      data: {
        marks,
        feedback,
        status: "GRADED",
        gradedAt: new Date(),
        gradedBy: session.sub,
      },
      select: SUBMISSION_SELECT,
    });

    return NextResponse.json(ok(submission, "Submission graded"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // The submission was deleted between the lookup and the update. Reported as
      // the same 404 the lookup would have produced, so a losing racer and an
      // unknown id are indistinguishable.
      if (isRecordNotFound(err)) {
        return notFound();
      }
    }

    console.error("[PATCH /api/assignments/[id]/submissions/[sid]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
