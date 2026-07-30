// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessments — Assignment Submissions
// FLOW   : Guard → tenant → param → prove the parent assignment → resolve the
//          caller's own student row where required → list / create → response.
// ACCESS : GET  — UNIVERSITY_ADMIN · FACULTY (all) · STUDENT (own only)
//          POST — STUDENT only. A student submits their own work; staff do not
//          submit on anyone's behalf.
// BACKEND: Prisma
// PURPOSE: List an assignment's submissions and record a student's submission.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { assignmentIdParamSchema } from "@/lib/validations/assignment";
import { createSubmissionSchema } from "@/lib/validations/submission";
import { ok, fail } from "@/types";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a submission. Declared once so both handlers answer with
 * the same shape.
 *
 * No relation is expanded, matching every other route in the project. Neither the
 * assignment nor the student is embedded even though this endpoint is keyed on
 * the first and scoped by the second: the caller already holds the assignment id
 * from the URL, and every row carries the same one.
 *
 * There is no tenantId to report. AssignmentSubmission is one of only two models
 * in the schema that store tenant-owned data with no tenant column — ownership is
 * reachable only through the parent assignment or through the student, and the
 * two are not reconciled by any constraint. Every query here is therefore anchored
 * on an assignment already proven to belong to the caller's tenant.
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
// serialize() helper is not applied here. attachments is Json and serialises as
// itself; the DateTime columns carry their own toJSON.

/**
 * The single 404 both handlers answer with.
 *
 * Built here rather than inline so an unknown assignment id, one owned by another
 * tenant, and — for a student — one that exists but is not published cannot drift
 * apart: every miss produces the identical status, code and message, byte for
 * byte. A distinguishable response would confirm that a given id exists
 * somewhere, and for the student case would disclose that an unpublished
 * assignment is being prepared.
 */
function assignmentNotFound(): NextResponse {
  return NextResponse.json(fail("Assignment not found", "NOT_FOUND"), { status: 404 });
}

/** Built on the rejection path — existing FORBIDDEN code and 403 status. */
function forbidden(): NextResponse {
  return NextResponse.json(fail("Forbidden", "FORBIDDEN"), { status: 403 });
}

/**
 * Resolve the caller's own Student row within this tenant.
 *
 * Student.userId is @unique and the lookup is tenant-scoped, so the resolution is
 * unambiguous. A caller holding the STUDENT role with no Student row in this
 * tenant resolves to null and is refused rather than served an empty list or
 * allowed to submit against nothing — the same treatment already applied in
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
//              elevated pair is tested first and a caller holding either lists
//              every submission for the assignment. Only a caller who holds
//              neither falls through to the STUDENT branch, which is narrowed to
//              that student's own row.
//
//              Scope is decided by asking requireRole twice rather than by
//              reading session.roles: the roles in the token are a snapshot from
//              sign-in, and requireRole resolves them live against UserRole on
//              every request so a revoked role takes effect immediately. The
//              elevated check runs first, so the common path costs one guard call
//              and only a student pays for a second. An anonymous caller fails
//              both and receives requireAuth's 401 from the second, so the
//              fallback cannot turn a 401 into a 403.
// VALIDATION : assignmentIdParamSchema for the [id] segment — non-empty once
//              trimmed; a cuid is an opaque key, so an
//              unrecognised-but-well-formed id is a 404 rather than a 400.
//              paginationQuerySchema for ?page and ?limit, consumed directly as
//              in every other collection route. No filter parameter is defined.
// FLOW       : Authorise → resolve tenant → validate → prove the parent
//              assignment → read one page of its submissions with the total.
//
//              The assignment is resolved first and tenant-scoped, and the
//              submission query is anchored on its id. That is what establishes
//              ownership: AssignmentSubmission carries no tenantId, so a query on
//              submission columns alone could reach any tenant's rows. For a
//              student the assignment lookup additionally requires publishedAt to
//              be set, so an unpublished assignment is indistinguishable from an
//              unknown one — exactly as on the assignment detail route.
//
//              A student's page is filtered to their own studentId, and that
//              filter is applied to the count as well as the page, so the total
//              can never describe a wider set than they can read.
//
//              Ordering is by createdAt then id, both descending — newest first,
//              matching every other collection route. It is required for
//              correctness rather than presentation: offset pagination over an
//              unordered result can repeat or skip rows across pages, and
//              submissions recorded in the same moment can share a createdAt.
// RESPONSE   : { success: true, data: { submissions, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
    const parsedParam = assignmentIdParamSchema.safeParse(await params);
    if (!parsedParam.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedQuery = paginationQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const assignmentId = parsedParam.data.id;
    const { page, limit } = parsedQuery.data;

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
      return assignmentNotFound();
    }

    // A student is narrowed to their own row. Their Student record is resolved
    // from the session and never from anything the caller supplied.
    let where: { assignmentId: string; studentId?: string } = { assignmentId };

    if (!isElevated) {
      const self = await resolveSelf(session.sub, tenant.id);
      if (!self) {
        return forbidden();
      }
      where = { assignmentId, studentId: self.id };
    }

    // Paired in one transaction so the total cannot shift between the two reads.
    const [submissions, total] = await prisma.$transaction([
      prisma.assignmentSubmission.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: SUBMISSION_SELECT,
      }),
      prisma.assignmentSubmission.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        submissions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/assignments/[id]/submissions]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : STUDENT only. A student submits their own work; UNIVERSITY_ADMIN
//              and FACULTY receive 403 here, which is the one place in this phase
//              where an elevated role has less access than a student. Staff
//              record a grade against a submission, not the submission itself.
// VALIDATION : assignmentIdParamSchema for the [id] segment, createSubmissionSchema
//              for the body. attachments is the only client-writable column and
//              the body may legitimately be empty — submitting nothing attached is
//              a real outcome. id, assignmentId, studentId, status, submittedAt,
//              gradedAt, gradedBy, createdAt and updatedAt are absent from the
//              schema and so are stripped from any body that supplies them.
// FLOW       : Authorise → resolve tenant → validate → prove the assignment is
//              published and in this tenant → resolve the caller's own student
//              row → create.
//
//              assignmentId comes from the route segment and studentId from the
//              session, so neither can be supplied by the caller. A student
//              therefore cannot file a submission against a different assignment
//              than the one addressed in the URL, nor attribute one to another
//              student. Both are proven against this tenant before the write.
//
//              The assignment must be published. A DRAFT assignment is not
//              visible to a student anywhere in this phase, so submitting to one
//              returns the identical 404 an unknown id returns — the endpoint
//              never reveals that an unpublished assignment exists. CLOSED and
//              GRADED assignments still carry publishedAt, so they remain
//              submittable: no rule anywhere in the schema or the approved
//              decisions closes submission at a lifecycle state, and inventing one
//              is out of scope.
//
//              submittedAt is the server clock. status is set to SUBMITTED — the
//              row is created by the act of submitting, so the PENDING default,
//              which means "has not submitted", would misdescribe it. LATE is not
//              derived: no late-submission rule is in scope here, so dueDate is
//              not consulted and a submission after the deadline is recorded as
//              SUBMITTED like any other.
//
//              A single create, with no pre-check and no upsert. The
//              @@unique([assignmentId, studentId]) constraint has both columns
//              NOT NULL, so PostgreSQL enforces it completely — unlike the
//              nullable-column constraints recorded as TD-001 and in the
//              attendance module. A pre-check would add a read without changing
//              any outcome and would still need the P2002 backstop for the race,
//              so the database is left as the single authority and a second
//              submission is reported as 409 CONFLICT.
// RESPONSE   : { success: true, data: <Submission>,
//                message: "Submission recorded" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              The 409 carries CONFLICT rather than the ILLEGAL_STATE_TRANSITION
//              used by the publish route: this one reports a uniqueness clash,
//              which is what CONFLICT means everywhere else in the project.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("STUDENT");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { session, tenant } = tenantGuard;

    const parsedParam = assignmentIdParamSchema.safeParse(await params);
    if (!parsedParam.success) {
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

    const parsedBody = createSubmissionSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const assignmentId = parsedParam.data.id;
    const { attachments } = parsedBody.data;

    // Both reads are independent, so they are issued together. The assignment
    // must exist in this tenant AND be published; the student row must exist in
    // this tenant for the caller.
    const [assignment, self] = await Promise.all([
      prisma.assignment.findFirst({
        where: { id: assignmentId, tenantId: tenant.id, publishedAt: { not: null } },
        select: { id: true },
      }),
      resolveSelf(session.sub, tenant.id),
    ]);

    if (!assignment) {
      return assignmentNotFound();
    }

    if (!self) {
      return forbidden();
    }

    // Single write — already atomic, so no transaction is warranted.
    // assignmentId comes from the route and studentId from the session; status
    // and submittedAt are server-set. The Json column is cast at this boundary
    // because Zod infers an unknown-valued record, which Prisma's InputJsonValue
    // does not accept directly — the same cast Campus.address requires.
    const submission = await prisma.assignmentSubmission.create({
      data: {
        assignmentId,
        studentId: self.id,
        status: "SUBMITTED",
        submittedAt: new Date(),
        attachments: attachments as Prisma.InputJsonValue | undefined,
      },
      select: SUBMISSION_SELECT,
    });

    return NextResponse.json(ok(submission, "Submission recorded"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // This student has already submitted for this assignment. The constraint
      // is fully enforced by the database, so this branch is authoritative
      // rather than a backstop behind a pre-check.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Submission already recorded for this assignment", "CONFLICT"),
          { status: 409 }
        );
      }

      // The assignment or the student row was deleted between its check and the
      // insert, so the foreign key rejected the reference. Which of the two it
      // was is not recoverable from the error.
      if (isForeignKeyViolation(err)) {
        return assignmentNotFound();
      }
    }

    console.error("[POST /api/assignments/[id]/submissions]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
