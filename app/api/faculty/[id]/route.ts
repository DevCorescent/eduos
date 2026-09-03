// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty — Faculty Detail
// FLOW   : Guard → tenant → param → load faculty → body → validate changed
//          references → duplicate check → update → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: View and update a single faculty member within the authenticated
//          tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { isForeignKeyViolation, isRecordNotFound } from "@/lib/utils/prisma-errors";
import { facultyIdParamSchema, updateFacultySchema } from "@/lib/validations/faculty";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a faculty member.
 *
 * The collection route declares the same shape. It is restated here rather than
 * imported because a Next.js route module may only export route handlers and
 * segment config, so this constant cannot be shared from there.
 *
 * No relation is expanded: the linked User is not joined, so the response carries
 * userId rather than the member's name or email.
 */
const FACULTY_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  employeeId: true,
  departmentId: true,
  designation: true,
  qualification: true,
  specialization: true,
  experience: true,
  status: true,
  joinDate: true,
  createdAt: true,
  updatedAt: true,
} as const;

// FacultyMember holds no BigInt, Decimal or Json column, so the shared
// serialize() helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : facultyIdParamSchema — the [id] segment must be non-empty once
//              trimmed.
// FLOW       : Authorise → resolve tenant → read the faculty member filtered by
//              BOTH id and tenantId, so one owned by another tenant is simply not
//              found rather than being disclosed.
// RESPONSE   : { success: true, data: <FacultyMember> }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
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
    const parsed = facultyIdParamSchema.safeParse(await params);
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
    const faculty = await prisma.facultyMember.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
      select: FACULTY_SELECT,
    });

    if (!faculty) {
      return NextResponse.json(fail("Faculty member not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(faculty));
  } catch (err) {
    console.error("[GET /api/faculty/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : facultyIdParamSchema for the [id] segment, updateFacultySchema
//              for the body. Every field optional but at least one required.
//              tenantId and userId are both absent from the schema, so a body
//              supplying either has it stripped: a faculty member can be moved
//              neither between tenants nor onto a different user account.
//              employeeId remains mutable, and experience must be zero or more.
// FLOW       : Authorise → resolve tenant → validate → load the member scoped by
//              tenant (404 otherwise) → issue only the checks a genuinely
//              changing field requires, in parallel → apply them in a fixed
//              precedence → one atomic update scoped by id and tenantId.
//
//              The department is re-verified against this tenant whenever it
//              changes. FacultyMember.departmentId carries a foreign key, so the
//              database would confirm the department exists, but a foreign key
//              says nothing about who owns the row — without this check a caller
//              could move their own faculty member into another university's
//              department and the update would succeed.
//
//              A field resubmitted with its current value is not a change and
//              costs no query, so a no-op PATCH performs the load and the write
//              and nothing else.
// RESPONSE   : { success: true, data: <FacultyMember>,
//                message: "Faculty member updated" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
export async function PATCH(
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

    const parsedParams = facultyIdParamSchema.safeParse(await params);
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

    const parsedBody = updateFacultySchema.safeParse(body);
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

    const facultyId = parsedParams.data.id;

    // One load serves three purposes: existence with tenant ownership, and the
    // current employeeId and departmentId used to decide which further checks are
    // needed at all.
    const existing = await prisma.facultyMember.findFirst({
      where: { id: facultyId, tenantId: tenant.id },
      select: { id: true, employeeId: true, departmentId: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Faculty member not found", "NOT_FOUND"), { status: 404 });
    }

    const input = parsedBody.data;

    // `typeof === "string"`, not `!== undefined` — tester issue #25. A null is
    // the caller clearing the column with "", and there is no row to look up:
    // asking for one by a null id would find nothing and answer "Department not
    // found" for a request that named no department. The column is nullable, so
    // emptying it cannot dangle a reference. This gates the EXISTENCE CHECK
    // only; the write below still passes the null through to Prisma.
    const departmentChanging =
      typeof input.departmentId === "string" && input.departmentId !== existing.departmentId;
    const employeeIdChanging =
      input.employeeId !== undefined && input.employeeId !== existing.employeeId;

    // Independent, so they are issued together rather than in sequence. An
    // unchanged field contributes no query at all.
    const [department, duplicateEmployeeId] = await Promise.all([
      departmentChanging
        ? prisma.department.findFirst({
            where: { id: input.departmentId as string, tenantId: tenant.id },
            select: { id: true },
          })
        : Promise.resolve(null),
      employeeIdChanging
        ? prisma.facultyMember.findUnique({
            where: {
              tenantId_employeeId: {
                tenantId: tenant.id,
                employeeId: input.employeeId as string,
              },
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

    // The lookup ran only for a changing id, so any row it found belongs to a
    // different faculty member by construction.
    if (employeeIdChanging && duplicateEmployeeId) {
      return NextResponse.json(
        fail("Employee id already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed. Single statement, so the update
    // is atomic on its own.
    const faculty = await prisma.facultyMember.update({
      where: { id: facultyId, tenantId: tenant.id },
      data: input,
      select: FACULTY_SELECT,
    });

    return NextResponse.json(ok(faculty, "Faculty member updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the employee id between the check and the
      // update. userId is immutable through this endpoint, so the tenant-scoped
      // employee id is the only unique constraint an update here can violate —
      // unlike the create path, where either could be the cause.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Employee id already in use", "CONFLICT"),
          { status: 409 }
        );
      }
      // The department was deleted between its check and the update, so the
      // foreign key rejected the new reference.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(fail("Department not found", "NOT_FOUND"), { status: 404 });
      }
      // The faculty member was deleted between the load and the update.
      if (isRecordNotFound(err)) {
        return NextResponse.json(fail("Faculty member not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[PATCH /api/faculty/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
