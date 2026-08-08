// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessments — Assignment Detail
// FLOW   : Guard → tenant → param → tenant-scoped lookup → read / update →
//          response.
// ACCESS : GET   — UNIVERSITY_ADMIN · FACULTY · STUDENT (published only)
//          PATCH — UNIVERSITY_ADMIN · FACULTY
//          PARENT is not implemented anywhere yet.
// BACKEND: Prisma
// PURPOSE: View and edit a single assignment within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation, isRecordNotFound } from "@/lib/utils/prisma-errors";
import {
  assignmentIdParamSchema,
  updateAssignmentSchema,
} from "@/lib/validations/assignment";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";
// PHASE 24 — the DELETE handler appended at the foot of this file. These four
// imports serve it alone; the GET and PATCH handlers above are untouched and
// continue to use the inline envelope they were written with.
import { assignmentLifecycleController } from "@/lib/controllers/assignmentLifecycle.controller";
import { ASSIGNMENT_MANAGE_ROLES } from "@/lib/constants/assignmentLifecycle";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";

/**
 * Columns returned for an assignment.
 *
 * The collection route declares the same shape. It is restated here rather than
 * imported because a Next.js route module may only export route handlers and
 * segment config, so this constant cannot be shared from there — the same reason
 * TIMETABLE_SELECT, ATTENDANCE_SELECT and COURSE_SELECT are restated in their
 * own detail routes.
 *
 * No relation is expanded. Assignment carries a real course relation, so that
 * join is possible and is simply not taken; sectionId has no relation to expand
 * even if one were wanted, because Assignment declares no section relation at
 * all. createdBy is reported but not resolved — it carries no foreign key and its
 * target model is not declared in the schema.
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
 * The single 404 every handler answers with.
 *
 * Built here rather than inline so an unknown id, an id owned by another tenant,
 * and — for a student — an id that exists but is not yet published cannot drift
 * apart: every miss produces the identical status, code and message, byte for
 * byte. That identity is the whole point. A distinguishable response would
 * confirm that a given id exists somewhere, and for the student case it would
 * disclose that an unpublished assignment is being prepared.
 */
function assignmentNotFound(): NextResponse {
  return NextResponse.json(fail("Assignment not found", "NOT_FOUND"), { status: 404 });
}

/**
 * Columns that describe where an assignment sits in its lifecycle.
 *
 * Both are server-managed. They are absent from updateAssignmentSchema — and
 * cannot be reintroduced by it, since .partial() only makes existing keys
 * optional — so a plain z.object() would silently strip them and the request
 * would succeed as though nothing had been asked for. A caller trying to publish
 * through PATCH would receive 200 and believe it had worked.
 *
 * They are therefore detected on the raw body, before validation, and refused
 * outright. This is the one place in the project where an unknown key is
 * rejected rather than stripped, and it is deliberate: silently ignoring an
 * attempt to change lifecycle state is worse than refusing it, because the
 * caller cannot tell the difference between "ignored" and "applied".
 */
const LIFECYCLE_KEYS = ["status", "publishedAt"] as const;

// GET
// ACCESS     : UNIVERSITY_ADMIN · FACULTY · STUDENT, with different scope.
//
//              Role precedence is UNIVERSITY_ADMIN > FACULTY > STUDENT, so the
//              elevated pair is tested first and a caller holding either reads
//              any assignment in the tenant, DRAFT included. Only a caller who
//              holds neither falls through to the STUDENT branch, which requires
//              publishedAt to be set.
//
//              Scope is decided by asking requireRole twice rather than by
//              reading session.roles: the roles in the token are a snapshot from
//              sign-in, and requireRole resolves them live against UserRole on
//              every request so a revoked role takes effect immediately. The
//              elevated check runs first, so the common path costs one guard call
//              and only a student pays for a second. An anonymous caller fails
//              both and receives requireAuth's 401 from the second, so the
//              fallback cannot turn a 401 into a 403.
// VALIDATION : assignmentIdParamSchema — the [id] segment must be non-empty once
//              trimmed. Assignment.id is a cuid, not a UUID, so no format
//              assertion is applied; an unrecognised-but-well-formed id is a 404
//              rather than a 400. No query parameters are read.
// FLOW       : Authorise → resolve tenant → read the assignment filtered by BOTH
//              id and tenantId, plus publishedAt for a student.
//
//              findFirst, never findUnique(id). The tenant filter is part of the
//              lookup itself rather than a check applied to a row already
//              fetched, so another tenant's assignment is never loaded, never
//              acknowledged and cannot leak through a mistake in a later branch.
//              Assignment.tenantId carries no foreign key, so the column is the
//              only record of ownership and this query is the only thing
//              enforcing it.
//
//              For a student the publishedAt predicate is part of the same
//              lookup rather than a check applied afterwards, so an unpublished
//              assignment is not merely hidden — it is never read. An unknown id,
//              a foreign id and an unpublished id are therefore indistinguishable
//              to a student.
// RESPONSE   : { success: true, data: <Assignment> }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Precedence: the elevated pair is tested first, so a caller holding either
    // never reaches the student branch.
    const elevatedGuard = await requireRole("UNIVERSITY_ADMIN", "FACULTY");

    let isElevated: boolean;

    if (elevatedGuard.authorized) {
      isElevated = true;
    } else {
      const studentGuard = await requireRole("STUDENT");
      if (!studentGuard.authorized) return studentGuard.response;

      isElevated = false;
    }

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

    // findFirst rather than findUnique: the tenant filter — and, for a student,
    // the published predicate — are part of the lookup, so an out-of-scope row
    // can never be returned or even acknowledged.
    const assignment = await prisma.assignment.findFirst({
      where: isElevated
        ? { id: parsed.data.id, tenantId: tenant.id }
        : { id: parsed.data.id, tenantId: tenant.id, publishedAt: { not: null } },
      select: ASSIGNMENT_SELECT,
    });

    if (!assignment) {
      return assignmentNotFound();
    }

    return NextResponse.json(ok(assignment));
  } catch (err) {
    console.error("[GET /api/assignments/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN · FACULTY. A caller holding only STUDENT is
//              rejected by the guard with 403 — students read assignments but do
//              not edit them.
// VALIDATION : assignmentIdParamSchema for the [id] segment, updateAssignmentSchema
//              for the body. Every field optional but at least one required, so an
//              empty body is a client error rather than a silent no-op that would
//              still advance updatedAt.
//
//              Mutable: courseId, sectionId, title, description, type, maxMarks,
//              dueDate, attachments.
//
//              tenantId, createdBy, createdAt and updatedAt are absent from the
//              create schema, so .partial() cannot introduce them — an assignment
//              can never be moved between tenants or re-attributed through this
//              endpoint, and a body supplying them has them stripped in the
//              project-wide manner.
//
//              status and publishedAt are treated differently: they are refused
//              rather than stripped. See LIFECYCLE_KEYS above.
// FLOW       : Authorise → resolve tenant → validate param → parse body → refuse
//              lifecycle keys → validate body → prove the assignment belongs to
//              this tenant → revalidate any changed reference → apply one atomic
//              update scoped by id and tenantId.
//
//              Precedence between the 409 and the 400 is fixed: the lifecycle
//              refusal is decided on the raw body and therefore runs before
//              schema validation. A body that both tries to publish and carries
//              an invalid title reports the publication attempt, because that is
//              the more specific and more consequential fault — and because after
//              validation the evidence for it no longer exists.
//
//              courseId and sectionId are revalidated whenever they are supplied,
//              tenant-scoped, exactly as on create. This mirrors
//              PATCH /api/courses/[id], which re-checks a changed reference
//              rather than trusting the stored one. Both lookups are skipped when
//              neither key is present, so a title-only edit costs no extra reads.
//              An unknown id and one owned by another tenant return the identical
//              404 for each reference.
//
//              No status transition is performed. Advancing an assignment through
//              its lifecycle is not this endpoint's job: publication belongs to
//              POST /api/assignments/[id]/publish, and PATCH neither reads nor
//              writes status or publishedAt. Editing an already-published
//              assignment is permitted — nothing in the schema or the approved
//              decisions freezes a published assignment's content.
// RESPONSE   : { success: true, data: <Assignment>,
//                message: "Assignment updated" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND
//              409 ILLEGAL_STATE_TRANSITION · 500 SERVER_ERROR
//
//              The 409 carries ILLEGAL_STATE_TRANSITION rather than the CONFLICT
//              code used elsewhere. Every existing 409 in this project reports a
//              uniqueness clash; this one reports an attempt to drive a lifecycle
//              from the wrong endpoint, which is a different fault and would be
//              indistinguishable under a shared code. Assignment declares no
//              unique constraint at all, so no CONFLICT is reachable here and the
//              two can never collide on this route.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN", "FACULTY");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsedParams = assignmentIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParams.error),
        },
        { status: 400 }
      );
    }

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    // Inspected on the raw body, before validation, because updateAssignmentSchema
    // would strip these keys and the attempt would succeed silently. Only a plain
    // object can carry them; an array or scalar body falls through to the schema,
    // which rejects it as invalid input.
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      const raw = body as Record<string, unknown>;
      if (LIFECYCLE_KEYS.some((key) => key in raw)) {
        return NextResponse.json(
          fail(
            "Assignment status and publication are managed by the publish endpoint",
            "ILLEGAL_STATE_TRANSITION"
          ),
          { status: 409 }
        );
      }
    }

    const parsedBody = updateAssignmentSchema.safeParse(body);
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

    const assignmentId = parsedParams.data.id;
    const { attachments, ...scalars } = parsedBody.data;

    const existing = await prisma.assignment.findFirst({
      where: { id: assignmentId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!existing) {
      return assignmentNotFound();
    }

    // Both lookups are skipped when neither reference is being changed, so a
    // title-only edit costs no extra reads. When either is supplied it is
    // re-proven against this tenant, exactly as on create.
    const [course, section] = await Promise.all([
      scalars.courseId === undefined
        ? Promise.resolve(null)
        : prisma.course.findFirst({
            where: { id: scalars.courseId, tenantId: tenant.id },
            select: { id: true },
          }),
      scalars.sectionId === undefined
        ? Promise.resolve(null)
        : prisma.section.findFirst({
            where: { id: scalars.sectionId, tenantId: tenant.id },
            select: { id: true },
          }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first. The order follows the schema's column order.
    if (scalars.courseId !== undefined && !course) {
      return NextResponse.json(fail("Course not found", "NOT_FOUND"), { status: 404 });
    }

    if (scalars.sectionId !== undefined && !section) {
      return NextResponse.json(fail("Section not found", "NOT_FOUND"), { status: 404 });
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed. Single statement, so the update
    // is atomic on its own. status, publishedAt, tenantId and createdBy are
    // absent from the data, so the stored values are left exactly as they were.
    //
    // The Json column is cast at this boundary because Zod infers an
    // unknown-valued record, which Prisma's InputJsonValue does not accept
    // directly — the same cast Campus.address requires.
    const assignment = await prisma.assignment.update({
      where: { id: assignmentId, tenantId: tenant.id },
      data: {
        ...scalars,
        attachments: attachments as Prisma.InputJsonValue | undefined,
      },
      select: ASSIGNMENT_SELECT,
    });

    return NextResponse.json(ok(assignment, "Assignment updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // The referenced course was deleted between its check and the update, so
      // the foreign key rejected the reference. sectionId cannot reach this
      // branch — it carries no foreign key, so a section deleted in the same
      // window leaves a dangling id rather than raising anything.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(fail("Course not found", "NOT_FOUND"), { status: 404 });
      }
      // The assignment was deleted between the lookup and the update.
      if (isRecordNotFound(err)) {
        return assignmentNotFound();
      }
    }

    console.error("[PATCH /api/assignments/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// ============================================================================
// PHASE 24 ADDITION — DELETE
//
// The README's Phase 24 names DELETE /api/assignments/[id] ("Delete
// Assignment"), which Phase 10 did not implement. It is added HERE rather than
// at a new path because Next.js requires every method for one URL to live in
// one route module — a sibling file would not be reachable.
//
// NOTHING ABOVE THIS COMMENT WAS CHANGED. The GET and PATCH handlers, the
// ASSIGNMENT_SELECT projection and the existing error mapping are exactly as
// Phase 10 left them; this is a pure append.
//
// THE RULE, AND WHY IT IS A REFUSAL RATHER THAN A CASCADE
//   An assignment holding submissions cannot be deleted — 409, not 403. The
//   caller's role is not the problem; the state of the resource is. Destroying
//   student work as a side effect of tidying an assignment list is not
//   something an API should do quietly, and AssignmentSubmission holds a plain
//   foreign key to Assignment with no cascade, so the database would refuse it
//   anyway with an error a caller could not interpret.
//
//   An assignment with no submissions is removed permanently. The schema has no
//   deletedAt column for this model and no archive to soft-delete into.
// ============================================================================

// DELETE
// ACCESS     : ASSIGNMENT_MANAGE_ROLES — FACULTY · DEPARTMENT_HOD · HOD ·
//              UNIVERSITY_ADMIN. Wider than this file's GET and PATCH, which
//              predate the two HOD role names; a head of department managing
//              their own department's assignments is the README's Phase 24
//              intent and neither existing handler is altered to match.
// VALIDATION : assignmentIdParamSchema — the same schema the sibling handlers
//              use, so all three agree on what an id is.
// FLOW       : Guard → tenant → validate param → controller.
//
//              The service resolves the assignment tenant-scoped first, so an
//              unknown id and another tenant's id are the identical 404 and
//              neither is ever confirmed to exist elsewhere. It then counts
//              submissions and refuses with 409 if any exist. A row deleted
//              between the check and the write reports the same 404 the lookup
//              would have produced.
// RESPONSE   : { success: true, data: null, message: "Assignment deleted" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole(...ASSIGNMENT_MANAGE_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const parsed = assignmentIdParamSchema.safeParse(await params);
    if (!parsed.success) return validationFailure(parsed.error);

    await assignmentLifecycleController.deleteAssignment(
      tenantGuard.tenant.id,
      parsed.data.id
    );

    return NextResponse.json(ok(null, "Assignment deleted"));
  } catch (err) {
    return handleRouteError("DELETE /api/assignments/[id]", err);
  }
}
