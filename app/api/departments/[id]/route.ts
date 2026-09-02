// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Department Detail
// FLOW   : View, update and delete a tenant-owned department.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma Department model.
// PURPOSE: Manage a single department within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import {
  isHeadUniqueViolation,
  resolveHeadAssignment,
} from "@/lib/services/departmentHead";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import {
  departmentIdParamSchema,
  updateDepartmentSchema,
} from "@/lib/validations/department";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/** Prisma's "record required but not found" code, raised by update/delete. */
const RECORD_NOT_FOUND = "P2025";

// Department holds no BigInt, Decimal or Json column — only strings and
// timestamps — so neither the shared serialize() helper nor an InputJsonValue
// cast applies here. The schema is immutable, so that cannot change.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : departmentIdParamSchema — the [id] segment must be non-empty
//              once trimmed.
// FLOW       : Authorise → resolve tenant → read the department filtered by
//              BOTH id and tenantId, so a department owned by another tenant is
//              simply not found rather than being disclosed. No relation is
//              expanded.
// RESPONSE   : { success: true, data: <Department> }
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
    const parsed = departmentIdParamSchema.safeParse(await params);
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
    const department = await prisma.department.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
    });

    if (!department) {
      return NextResponse.json(fail("Department not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(department));
  } catch (err) {
    console.error("[GET /api/departments/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : departmentIdParamSchema for the [id] segment,
//              updateDepartmentSchema for the body. Every field optional but at
//              least one required. tenantId cannot appear in the body, so a
//              department cannot be moved between tenants.
// FLOW       : Authorise → resolve tenant → validate → confirm the department
//              belongs to this tenant (404 otherwise) → issue only the checks
//              a changing field actually requires, in parallel → apply them in
//              a fixed precedence → one atomic update scoped by id and tenantId.
//              Both reference checks are scoped by tenantId, so a row owned by
//              another tenant is reported as NOT_FOUND exactly like a
//              nonexistent one. The database's foreign keys cannot achieve this
//              alone — they verify only that the referenced row exists.
//              No relationship between campusId and schoolId is enforced: the
//              schema models them independently and states no such rule.
// RESPONSE   : { success: true, data: <Department>,
//                message: "Department updated" }
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

    const { tenant } = tenantGuard;

    const parsedParams = departmentIdParamSchema.safeParse(await params);
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

    const parsedBody = updateDepartmentSchema.safeParse(body);
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

    const departmentId = parsedParams.data.id;

    // One lookup serves four purposes: existence, tenant ownership, and the
    // current code, campusId and schoolId used to decide which further checks
    // are needed at all.
    const existing = await prisma.department.findFirst({
      where: { id: departmentId, tenantId: tenant.id },
      select: { id: true, code: true, campusId: true, schoolId: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Department not found", "NOT_FOUND"), { status: 404 });
    }

    const input = parsedBody.data;

    // A field resubmitted with its current value is not a change, so it costs
    // no query — re-pointing at the department's own campus, school or code is
    // never a conflict with itself.
    const campusChanging = input.campusId !== undefined && input.campusId !== existing.campusId;
    const schoolChanging = input.schoolId !== undefined && input.schoolId !== existing.schoolId;
    const codeChanging = input.code !== undefined && input.code !== existing.code;

    // Independent, so they are issued together rather than in sequence.
    const [campus, school, duplicate] = await Promise.all([
      campusChanging
        ? prisma.campus.findFirst({
            where: { id: input.campusId, tenantId: tenant.id },
            select: { id: true },
          })
        : Promise.resolve(null),
      schoolChanging
        ? prisma.school.findFirst({
            where: { id: input.schoolId, tenantId: tenant.id },
            select: { id: true },
          })
        : Promise.resolve(null),
      codeChanging
        ? prisma.department.findUnique({
            where: { tenantId_code: { tenantId: tenant.id, code: input.code as string } },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // happened to resolve first: invalid references before constraint clashes.
    if (campusChanging && !campus) {
      return NextResponse.json(fail("Campus not found", "NOT_FOUND"), { status: 404 });
    }

    if (schoolChanging && !school) {
      return NextResponse.json(fail("School not found", "NOT_FOUND"), { status: 404 });
    }

    if (codeChanging && duplicate) {
      return NextResponse.json(
        fail("Department code already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed. Single statement, so the update
    // is atomic on its own.
    // The head of department, resolved tenant-scoped and checked against the
    // @unique index before the write, so the admin is told which department
    // already claims the user rather than receiving a bare conflict.
    const { hodUserId: rawHead, ...rest } = input;
    let head: string | null | undefined;

    if (rawHead !== undefined) {
      const assignment = await resolveHeadAssignment(
        tenant.id,
        rawHead,
        existing.id
      );

      if (!assignment.ok) {
        return NextResponse.json(fail(assignment.error, assignment.code), {
          status: assignment.code === "NOT_FOUND" ? 404 : 409,
        });
      }

      head = assignment.hodUserId;
    }

    const department = await prisma.department.update({
      where: { id: departmentId, tenantId: tenant.id },
      data: {
        ...rest,
        ...(head === undefined ? {} : { hodUserId: head }),
      },
    });

    return NextResponse.json(ok(department, "Department updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the code between the check and the update.
      if (err.code === UNIQUE_VIOLATION) {
        // Both the code index and the head index are P2002 on this table.
        if (isHeadUniqueViolation(err.meta)) {
          return NextResponse.json(
            fail("That user already heads another department", "CONFLICT"),
            { status: 409 }
          );
        }

        return NextResponse.json(
          fail("Department code already in use", "CONFLICT"),
          { status: 409 }
        );
      }
      // The campus or school was deleted between the ownership check and the
      // update, so the foreign key rejected the new reference. Which of the two
      // it was is not reliably recoverable from the error, so both are reported
      // together rather than guessed at.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced campus or school not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
      // The department was deleted between the lookup and the update.
      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(fail("Department not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[PATCH /api/departments/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// DELETE
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : departmentIdParamSchema — the [id] segment must be non-empty
//              once trimmed.
// FLOW       : Authorise → resolve tenant → confirm the department belongs to
//              this tenant (404 otherwise) → issue a single delete scoped by id
//              and tenantId.
//              No cascade is performed in application code; the database owns
//              that. Programme.departmentId is ON DELETE RESTRICT, so a
//              department that still has programmes cannot be deleted and
//              surfaces as a foreign-key violation → CONFLICT. FacultyMember
//              .departmentId is ON DELETE SET NULL, so faculty are NOT a
//              barrier — they survive with departmentId cleared.
// RESPONSE   : { success: true, data: null, message: "Department deleted" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = departmentIdParamSchema.safeParse(await params);
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

    const departmentId = parsed.data.id;

    const existing = await prisma.department.findFirst({
      where: { id: departmentId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Department not found", "NOT_FOUND"), { status: 404 });
    }

    await prisma.department.delete({
      where: { id: departmentId, tenantId: tenant.id },
    });

    return NextResponse.json(ok(null, "Department deleted"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Programmes still reference this department; the database refuses the
      // delete rather than orphaning them. Reported, not worked around.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Department has dependent records and cannot be deleted", "CONFLICT"),
          { status: 409 }
        );
      }
      // The department was deleted between the lookup and the delete.
      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(fail("Department not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[DELETE /api/departments/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
