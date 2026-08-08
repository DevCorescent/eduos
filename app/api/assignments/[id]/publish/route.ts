// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessments — Assignment Publication
// FLOW   : Guard → tenant → param → tenant-scoped lookup → guarded atomic
//          transition → response.
// ACCESS : UNIVERSITY_ADMIN · FACULTY
//          Students may read published assignments but never publish one.
// BACKEND: Prisma
// PURPOSE: Move a single assignment from DRAFT to PUBLISHED. This is the only
//          endpoint in the project permitted to do so.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isRecordNotFound } from "@/lib/utils/prisma-errors";
import { assignmentIdParamSchema } from "@/lib/validations/assignment";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";
// PHASE 27 student event "Assignment Published". Emitted after commit.
import {
  findStudentUserIdsForCourse,
  notificationEmitter,
  notifyAfterCommit,
} from "@/lib/controllers/notificationEmitter.controller";

/**
 * Columns returned for an assignment.
 *
 * The collection and detail routes declare the same shape. It is restated here
 * rather than imported because a Next.js route module may only export route
 * handlers and segment config, so this constant cannot be shared from either.
 *
 * No relation is expanded, matching both sibling routes. status and publishedAt
 * are included deliberately: they are what this endpoint changes, so the caller
 * reads the result of the transition directly rather than having to re-fetch.
 */
const ASSIGNMENT_SELECT = {
  id: true,
  tenantId: true,
  courseId: true,
  sectionId: true,
  createdBy: true,
  title: true,
  description: true,
  type: true,
  status: true,
  maxMarks: true,
  dueDate: true,
  publishedAt: true,
  attachments: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Assignment holds no BigInt or Decimal column, so the shared serialize() helper
// is not applied here.

/**
 * The single 404 this route answers with.
 *
 * Built here rather than inline so an unknown id and one owned by another tenant
 * cannot drift apart: both produce the identical status, code and message, byte
 * for byte, and match what the sibling detail route answers. A distinguishable
 * response would confirm that a given id exists somewhere.
 */
function assignmentNotFound(): NextResponse {
  return NextResponse.json(fail("Assignment not found", "NOT_FOUND"), { status: 404 });
}

/**
 * The 409 answered when the assignment is not in DRAFT.
 *
 * Built once so an already-published assignment, a closed one, a graded one and
 * the loser of a concurrent publish all receive the identical response — the
 * outcome is the same in every case: this assignment cannot be published now.
 *
 * The code is ILLEGAL_STATE_TRANSITION rather than the CONFLICT used elsewhere,
 * matching PATCH /api/assignments/[id]. Every other 409 in this project reports
 * a uniqueness clash; this one reports a lifecycle rule, and the two would be
 * indistinguishable under a shared code. They can never collide here anyway —
 * Assignment declares no unique constraint at all.
 */
function illegalTransition(): NextResponse {
  return NextResponse.json(
    fail("Only a DRAFT assignment can be published", "ILLEGAL_STATE_TRANSITION"),
    { status: 409 }
  );
}

// POST
// ACCESS     : UNIVERSITY_ADMIN · FACULTY. A caller holding only STUDENT is
//              rejected by the guard with 403. No two-tier logic exists here:
//              publication is a staff action, so the guard is a single
//              requireRole call and a student's 403 is byte-identical to any
//              other role rejection.
// VALIDATION : assignmentIdParamSchema — the [id] segment must be non-empty once
//              trimmed. Assignment.id is a cuid, not a UUID, so no format
//              assertion is applied; an unrecognised-but-well-formed id is a 404
//              rather than a 400.
//
//              No body schema exists and no body is read. The transition this
//              endpoint performs is fixed, its target state is not chosen by the
//              caller, and both columns it writes are server-managed — a body
//              schema would be dead code. Any body sent is ignored rather than
//              rejected, matching the project's other body-less writes.
//              No client field influences the outcome in any way.
// FLOW       : Authorise → resolve tenant → validate param → prove the assignment
//              belongs to this tenant → apply one guarded, atomic transition.
//
//              The lookup decides which failure the caller sees: absent or
//              foreign is 404, present but not DRAFT is 409. That ordering
//              matters — reporting 409 for an id that does not exist would
//              confirm its existence, and reporting 404 for a published
//              assignment would deny that it exists at all.
//
//              The write is a single UPDATE carrying status = 'DRAFT' in its WHERE
//              clause alongside id and tenantId. That guard is what makes the
//              transition safe under concurrency: two simultaneous publish
//              requests both pass the lookup, but only one can match a row that
//              is still DRAFT, and the loser raises P2025 and is reported as the
//              same 409 the lookup would have produced. Without the guard both
//              would succeed and the second would silently overwrite the first
//              publication timestamp.
//
//              status and publishedAt are set in that same statement, so they can
//              never disagree — there is no window in which one is written and
//              the other is not, and no transaction is needed to achieve it. The
//              schema does not link the two columns, so this is the only thing
//              keeping them consistent; the sibling PATCH route refuses to write
//              either for the same reason.
//
//              publishedAt is the server clock. It is never accepted from a
//              client anywhere in this phase, because it is the visibility
//              predicate every read uses.
//
//              The tenant filter is part of the write as well as the lookup, so
//              the update cannot reach another tenant's row even if the id were
//              guessed. Assignment.tenantId carries no foreign key, so this
//              predicate is the only record of ownership the write has.
// RESPONSE   : { success: true, data: <Assignment>,
//                message: "Assignment published" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND
//              409 ILLEGAL_STATE_TRANSITION · 500 SERVER_ERROR
//
//              Publication is not idempotent: republishing returns 409 rather
//              than 200. A publication date is an audit fact, and answering 200
//              on a retry would either rewrite it or imply a change that did not
//              happen. This matches the project's treatment of a repeated delete,
//              which is a 404 rather than a silent success.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN", "FACULTY");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsed = assignmentIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsed.error),
        },
        { status: 400 }
      );
    }

    const assignmentId = parsed.data.id;

    // findFirst rather than findUnique: the tenant filter is part of the lookup,
    // so another tenant's assignment can never be resolved or even acknowledged.
    const existing = await prisma.assignment.findFirst({
      where: { id: assignmentId, tenantId: tenant.id },
      select: { status: true },
    });

    if (!existing) {
      return assignmentNotFound();
    }

    // PUBLISHED, CLOSED and GRADED are all refused here. DRAFT is the only state
    // from which publication is permitted, and no other transition exists.
    if (existing.status !== "DRAFT") {
      return illegalTransition();
    }

    // One statement, so both columns move together and the transition is atomic
    // on its own — no transaction is warranted. status: "DRAFT" in the filter is
    // the concurrency guard: if another request published this assignment between
    // the lookup above and this write, no row matches and Prisma raises P2025,
    // which the catch below reports as the same 409.
    const assignment = await prisma.assignment.update({
      where: { id: assignmentId, tenantId: tenant.id, status: "DRAFT" },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
      select: ASSIGNMENT_SELECT,
    });

        // PHASE 27 student event "Assignment Published".
    //
    // After the publish has committed, throwing nothing. Addressed to the
    // students registered for the course, narrowed to the section when the
    // assignment names one — an assignment set for Section A must not notify
    // Section B.
    await notifyAfterCommit("POST /api/assignments/[id]/publish", async () => {
      await notificationEmitter.assignmentPublished({
        tenantId: tenant.id,
        recipientUserIds: await findStudentUserIdsForCourse(
          tenant.id,
          assignment.courseId,
          assignment.sectionId ?? null
        ),
        assignmentTitle: assignment.title,
        assignmentId: assignment.id,
        dueDate: assignment.dueDate ? assignment.dueDate.toISOString().slice(0, 10) : null,
      });
    });

    return NextResponse.json(ok(assignment, "Assignment published"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // The guarded update matched nothing. The lookup already proved the row
      // existed and was DRAFT, so the only thing that can have changed in that
      // window is its status — a concurrent publish won the race. No delete
      // endpoint exists for assignments, so the row cannot have disappeared.
      if (isRecordNotFound(err)) {
        return illegalTransition();
      }
    }

    console.error("[POST /api/assignments/[id]/publish]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
