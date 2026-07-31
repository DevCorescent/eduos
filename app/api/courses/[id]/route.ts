// ============================================================================
// OWNER  : Gauransh
// MODULE : Curriculum — Course Detail
// FLOW   : Guard → tenant → param → load course → body → validate changed
//          references → duplicate check → update → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: View and update a single course within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isRecordNotFound } from "@/lib/utils/prisma-errors";
import { courseIdParamSchema, updateCourseSchema } from "@/lib/validations/course";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a course.
 *
 * The collection route declares the same shape. It is restated here rather than
 * imported because a Next.js route module may only export route handlers and
 * segment config, so this constant cannot be shared from there.
 *
 * No relation is expanded, and for this model none could be: Course declares no
 * department relation in the schema, so the department's name is not reachable
 * through a nested select here at all — the response carries departmentId and
 * nothing more.
 */
const COURSE_SELECT = {
  id: true,
  tenantId: true,
  departmentId: true,
  name: true,
  code: true,
  type: true,
  credits: true,
  description: true,
  syllabus: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Course holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : courseIdParamSchema — the [id] segment must be non-empty once
//              trimmed. No query parameters are read: this addresses a single
//              resource, so there is no collection to page through and no
//              pagination contract to validate. Any query string supplied is
//              simply ignored rather than rejected, matching every other detail
//              route in the project.
// FLOW       : Authorise → resolve tenant → read the course filtered by BOTH id
//              and tenantId, so one owned by another tenant is simply not found
//              rather than being disclosed. An unknown id and a foreign id return
//              the identical response, so no id is ever confirmed to exist
//              elsewhere.
// RESPONSE   : { success: true, data: <Course> }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsed = courseIdParamSchema.safeParse(await params);
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

    // findFirst rather than findUnique: the tenant filter is part of the lookup,
    // so another tenant's row can never be returned or even acknowledged.
    const course = await prisma.course.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
      select: COURSE_SELECT,
    });

    if (!course) {
      return NextResponse.json(fail("Course not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(course));
  } catch (err) {
    console.error("[GET /api/courses/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : courseIdParamSchema for the [id] segment, updateCourseSchema for
//              the body. Every field optional but at least one required, so an
//              empty body is rejected rather than performing a write that only
//              advances updatedAt.
//              tenantId is absent from the schema, so a body supplying it has it
//              stripped: a course cannot be moved between tenants. Nothing else
//              is omitted — Course has no identity column that outlives an edit,
//              unlike Student, FacultyMember and Employee, each permanently bound
//              to the User it was created against. code is therefore mutable, as
//              the schema permits.
//              No validation is applied beyond what the schema declares: credits
//              may be set to zero or a negative value because Course.credits is a
//              plain Int with no constraint.
//              departmentId is .optional(), not .nullish(), so a literal null is
//              rejected as a 400 rather than clearing the column. A department
//              already assigned therefore cannot be unassigned through this
//              endpoint — the same limitation every other PATCH route in the
//              project has with its nullable columns.
// FLOW       : Authorise → resolve tenant → validate → load the course scoped by
//              tenant (404 otherwise) → issue only the checks a genuinely changing
//              field requires, in parallel → apply them in a fixed precedence →
//              one atomic update scoped by id and tenantId.
//
//              The department is re-verified against this tenant whenever it
//              changes, and that check is the only one in existence: Course
//              declares no foreign key at all in the migration — not on
//              departmentId, and not even on tenantId — so the column would
//              otherwise accept any string, including another tenant's id. An
//              unknown department and one owned by another tenant return the
//              identical 404, so no id is ever confirmed to exist elsewhere.
//
//              A field resubmitted with its current value is not a change and
//              costs no query, so a no-op PATCH performs the load and the write
//              and nothing else.
// RESPONSE   : { success: true, data: <Course>, message: "Course updated" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              No foreign-key branch is handled here, and none is reachable:
//              Course has no foreign key on any column, so a department deleted
//              between its check and the update leaves a dangling departmentId
//              rather than raising anything — the same silent outcome as
//              Student.programmeId and Employee.departmentId. P2002 remains the
//              race backstop for the tenant-scoped code, which is a real unique
//              index.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsedParams = courseIdParamSchema.safeParse(await params);
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

    const parsedBody = updateCourseSchema.safeParse(body);
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

    const courseId = parsedParams.data.id;

    // One load serves three purposes: existence with tenant ownership, and the
    // current code and departmentId used to decide which further checks are
    // needed at all.
    const existing = await prisma.course.findFirst({
      where: { id: courseId, tenantId: tenant.id },
      select: { id: true, code: true, departmentId: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Course not found", "NOT_FOUND"), { status: 404 });
    }

    const input = parsedBody.data;

    const departmentChanging =
      input.departmentId !== undefined && input.departmentId !== existing.departmentId;
    const codeChanging = input.code !== undefined && input.code !== existing.code;

    // Independent, so they are issued together rather than in sequence. An
    // unchanged field contributes no query at all.
    const [department, duplicateCode] = await Promise.all([
      departmentChanging
        ? prisma.department.findFirst({
            where: { id: input.departmentId, tenantId: tenant.id },
            select: { id: true },
          })
        : Promise.resolve(null),
      codeChanging
        ? prisma.course.findUnique({
            where: {
              tenantId_code: { tenantId: tenant.id, code: input.code as string },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: an invalid reference before the constraint clash.
    if (departmentChanging && !department) {
      return NextResponse.json(fail("Department not found", "NOT_FOUND"), { status: 404 });
    }

    // The lookup ran only for a changing code, so any row it found belongs to a
    // different course by construction.
    if (codeChanging && duplicateCode) {
      return NextResponse.json(
        fail("Course code already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    // Scoped by tenantId as well as id, so the write cannot reach another tenant's
    // row even if the id were guessed. Single statement, so the update is atomic
    // on its own.
    const course = await prisma.course.update({
      where: { id: courseId, tenantId: tenant.id },
      data: input,
      select: COURSE_SELECT,
    });

    return NextResponse.json(ok(course, "Course updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the code between the check and the update. The
      // tenant-scoped code is the model's only unique constraint, so it is the
      // only cause this branch can have.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Course code already in use", "CONFLICT"),
          { status: 409 }
        );
      }
      // The course was deleted between the load and the update.
      if (isRecordNotFound(err)) {
        return NextResponse.json(fail("Course not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[PATCH /api/courses/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
