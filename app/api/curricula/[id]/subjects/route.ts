// ============================================================================
// OWNER  : Gauransh
// MODULE : Curriculum — Curriculum Subjects
// FLOW   : Guard → tenant → param → load curriculum → body → load course →
//          duplicate pre-check → create subject → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: List and add the subjects of one curriculum within the authenticated
//          tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import {
  createCurriculumSubjectSchema,
  curriculumIdParamSchema,
} from "@/lib/validations/curriculum";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Course columns exposed inside a curriculum subject.
 *
 * GET /api/curricula/[id] declares the same shape; both are restated because a
 * Next.js route module may only export route handlers and segment config.
 *
 * Narrower than the full course record: description and syllabus are omitted so
 * the payload does not grow without bound as subjects accumulate. credits is
 * included on purpose — Course.credits is authoritative while the subject's own
 * credits is a snapshot taken when the subject was added, so exposing both lets a
 * client see that the two have diverged.
 */
const COURSE_SUMMARY_SELECT = {
  id: true,
  name: true,
  code: true,
  type: true,
  credits: true,
  isActive: true,
} as const;

/**
 * Columns returned for a curriculum subject.
 *
 * CurriculumSubject has no updatedAt column, so createdAt is the only timestamp
 * there is to report.
 */
const SUBJECT_SELECT = {
  id: true,
  curriculumId: true,
  courseId: true,
  semesterNumber: true,
  isCompulsory: true,
  credits: true,
  internalMarks: true,
  externalMarks: true,
  createdAt: true,
  course: { select: COURSE_SUMMARY_SELECT },
} as const;

/**
 * Ordering applied to the subject list.
 *
 * Typed with `satisfies` rather than frozen with `as const`: `as const` would make
 * the array readonly, and Prisma's orderBy input is a mutable array, so the
 * assignment would not type check. `satisfies` preserves the "asc" literals
 * without freezing.
 *
 * semesterNumber comes first, since a curriculum reads as a semester-wise list.
 * createdAt and id follow as tiebreakers: several subjects added to the same
 * semester can share a createdAt, which would otherwise leave their relative order
 * undefined between calls. Matches the nested ordering used by
 * GET /api/curricula/[id], so the same subjects appear in the same order through
 * either endpoint.
 */
const SUBJECT_ORDER_BY = [
  { semesterNumber: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
] satisfies Prisma.CurriculumSubjectOrderByWithRelationInput[];

// Neither CurriculumSubject nor Course holds a BigInt, Decimal or Json column, so
// the shared serialize() helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : curriculumIdParamSchema — the [id] segment must be non-empty once
//              trimmed. No query parameters are read.
//
//              The subjects are returned in full rather than paged, matching
//              GET /api/curricula/[id], which returns the same rows nested inside
//              the curriculum. No nested pagination contract exists anywhere in
//              the project, so introducing one only here would make the two
//              endpoints disagree about the same data.
// FLOW       : Authorise → resolve tenant → prove the curriculum belongs to this
//              tenant → read its subjects.
//
//              Ownership is established on the curriculum first and the route
//              parameter is authoritative. The subjects themselves are then filtered
//              by curriculumId alone, which is sufficient and is the only option:
//              CurriculumSubject has no tenantId column, so a subject's tenant is
//              entirely inherited from its curriculum. Scoping the parent scopes the
//              children.
//
//              An unknown curriculum and one owned by another tenant return the
//              identical 404, so no id is ever confirmed to exist elsewhere.
// RESPONSE   : { success: true, data: { subjects } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              A curriculum with no subjects returns 200 with subjects: [], not
//              404 — the curriculum exists and an empty subject list is a valid
//              state.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsed = curriculumIdParamSchema.safeParse(await params);
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

    const curriculumId = parsed.data.id;

    // Ownership is proven before any subject is read, so a foreign curriculum id
    // yields a 404 rather than that curriculum's subject list.
    const curriculum = await prisma.curriculum.findFirst({
      where: { id: curriculumId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!curriculum) {
      return NextResponse.json(fail("Curriculum not found", "NOT_FOUND"), { status: 404 });
    }

    const subjects = await prisma.curriculumSubject.findMany({
      where: { curriculumId },
      orderBy: SUBJECT_ORDER_BY,
      select: SUBJECT_SELECT,
    });

    return NextResponse.json(ok({ subjects }));
  } catch (err) {
    console.error("[GET /api/curricula/[id]/subjects]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : curriculumIdParamSchema for the [id] segment,
//              createCurriculumSubjectSchema for the body. courseId and
//              semesterNumber required; isCompulsory, internalMarks and
//              externalMarks optional.
//
//              Two exclusions are deliberate and both are business rules rather
//              than shape decisions. curriculumId is absent from the schema, so the
//              route segment is authoritative and a body cannot redirect the subject
//              into a different curriculum. credits is absent, so a body supplying
//              it has the value stripped: Course.credits is authoritative and the
//              server copies it here, making CurriculumSubject.credits a historical
//              snapshot rather than client input.
//
//              semesterNumber, internalMarks and externalMarks follow the schema
//              and nothing else — no range, no total, and no comparison against
//              Programme.durationValue.
// FLOW       : Authorise → resolve tenant → validate the param → prove the
//              curriculum belongs to this tenant → validate the body → verify the
//              course and pre-check the duplicate together → create.
//
//              This endpoint is the only protection against a cross-tenant
//              curriculum subject, so both references are proven explicitly:
//
//              1. The curriculum is loaded by { id, tenantId }.
//              2. The course is loaded by { id, tenantId }.
//
//              The courseId foreign key is deliberately not relied upon. It proves
//              the course exists, not who owns it, so without step 2 another
//              tenant's course could be attached to this curriculum — and because
//              CurriculumSubject has no tenantId column of its own, nothing
//              downstream would ever detect it. An unknown course and a
//              cross-tenant course return the identical 404.
//
//              credits is read from the course loaded in step 2, so the snapshot
//              can only ever be copied from a course this tenant owns. The column
//              is NOT NULL with no database default, so it must always be supplied
//              explicitly.
// RESPONSE   : { success: true, data: <CurriculumSubject>,
//                message: "Subject added to curriculum" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              @@unique([curriculumId, courseId, semesterNumber]) is respected
//              exactly: the same course in the same semester of the same curriculum
//              is a 409, while the same course in a different semester is allowed.
//              All three keyed columns are NOT NULL, so unlike the constraint
//              recorded as TD-001 this index is fully enforceable and P2002 is a
//              reliable concurrency backstop.
//
//              A foreign-key branch is reachable and handled: both curriculumId and
//              courseId carry real foreign keys, so either row disappearing between
//              its check and the insert makes the write fail. Which one it was is
//              not recoverable from the error, so both are reported together.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const { tenant } = tenantGuard;

    const parsedParams = curriculumIdParamSchema.safeParse(await params);
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

    const curriculumId = parsedParams.data.id;

    // Ownership of the parent is established before the body is read, so a
    // foreign or unknown curriculum is rejected without the request revealing
    // whether its payload would otherwise have been acceptable.
    const curriculum = await prisma.curriculum.findFirst({
      where: { id: curriculumId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!curriculum) {
      return NextResponse.json(fail("Curriculum not found", "NOT_FOUND"), { status: 404 });
    }

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = createCurriculumSubjectSchema.safeParse(body);
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

    const input = parsedBody.data;

    // Two independent reads, so they are issued together rather than in sequence.
    // The course lookup is tenant-scoped, not merely an existence check.
    const [course, duplicate] = await Promise.all([
      prisma.course.findFirst({
        where: { id: input.courseId, tenantId: tenant.id },
        select: { id: true, credits: true },
      }),
      prisma.curriculumSubject.findUnique({
        where: {
          curriculumId_courseId_semesterNumber: {
            curriculumId,
            courseId: input.courseId,
            semesterNumber: input.semesterNumber,
          },
        },
        select: { id: true },
      }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: an invalid reference before the constraint clash. It also
    // matters for isolation — a foreign courseId must report 404 rather than
    // disclosing, through a 409, that it already sits in this curriculum.
    if (!course) {
      return NextResponse.json(fail("Course not found", "NOT_FOUND"), { status: 404 });
    }

    if (duplicate) {
      return NextResponse.json(
        fail("Course already assigned to this semester", "CONFLICT"),
        { status: 409 }
      );
    }

    // Single write — already atomic, so no transaction is warranted. curriculumId
    // comes from the route segment and credits from the course just verified to
    // belong to this tenant; neither is ever taken from the request body.
    const subject = await prisma.curriculumSubject.create({
      data: {
        ...input,
        curriculumId,
        credits: course.credits,
      },
      select: SUBJECT_SELECT,
    });

    return NextResponse.json(ok(subject, "Subject added to curriculum"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the same course and semester between the
      // pre-check and the insert. The curriculum/course/semester triple is the
      // model's only unique constraint, so it is the only cause this branch can
      // have.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Course already assigned to this semester", "CONFLICT"),
          { status: 409 }
        );
      }
      // The curriculum or the course was deleted between its check and the
      // insert, so the foreign key rejected the reference. Which of the two it
      // was is not recoverable from the error, so both are reported together.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Curriculum or course not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[POST /api/curricula/[id]/subjects]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
