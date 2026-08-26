// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty — Non-Teaching Employee Detail
// FLOW   : Guard → tenant → param → load employee → body → validate changed
//          references → duplicate check → update → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: View and update a single non-teaching employee within the
//          authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { isRecordNotFound } from "@/lib/utils/prisma-errors";
import { employeeIdParamSchema, updateEmployeeSchema } from "@/lib/validations/employee";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for an employee.
 *
 * The collection route declares the same shape. It is restated here rather than
 * imported because a Next.js route module may only export route handlers and
 * segment config, so this constant cannot be shared from there.
 *
 * No relation is expanded: the linked User is not joined, so the response carries
 * userId rather than the employee's name or email.
 */
const EMPLOYEE_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  employeeId: true,
  departmentId: true,
  designation: true,
  type: true,
  status: true,
  joinDate: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Employee holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : employeeIdParamSchema — the [id] segment must be non-empty once
//              trimmed. No query parameters are read: this addresses a single
//              resource, so there is no collection to page through and no
//              pagination contract to validate. Any query string supplied is
//              simply ignored rather than rejected, matching every other detail
//              route in the project.
// FLOW       : Authorise → resolve tenant → read the employee filtered by BOTH id
//              and tenantId, so one owned by another tenant is simply not found
//              rather than being disclosed. An unknown id and a foreign id return
//              the identical response, so no id is ever confirmed to exist
//              elsewhere.
// RESPONSE   : { success: true, data: <Employee> }
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
    const parsed = employeeIdParamSchema.safeParse(await params);
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
    const employee = await prisma.employee.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
      select: EMPLOYEE_SELECT,
    });

    if (!employee) {
      return NextResponse.json(fail("Employee not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(employee));
  } catch (err) {
    console.error("[GET /api/employees/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : employeeIdParamSchema for the [id] segment, updateEmployeeSchema
//              for the body. Every field optional but at least one required, so an
//              empty body is rejected rather than performing a write that only
//              advances updatedAt.
//              tenantId and userId are both absent from the schema, so a body
//              supplying either has it stripped: an employee can be moved neither
//              between tenants nor onto a different user account. employeeId
//              remains mutable.
// FLOW       : Authorise → resolve tenant → validate → load the employee scoped by
//              tenant (404 otherwise) → issue only the checks a genuinely changing
//              field requires, in parallel → apply them in a fixed precedence →
//              one atomic update scoped by id and tenantId.
//
//              The department is re-verified against this tenant whenever it
//              changes, and that check is the only one in existence:
//              Employee.departmentId has neither a relation nor a foreign key in
//              the schema — unlike FacultyMember.departmentId, which does — so the
//              column would otherwise accept any string at all, including another
//              tenant's id or arbitrary text.
//
//              A field resubmitted with its current value is not a change and
//              costs no query, so a no-op PATCH performs the load and the write
//              and nothing else.
// RESPONSE   : { success: true, data: <Employee>,
//                message: "Employee updated" }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              No foreign-key branch is handled here, and none is reachable.
//              userId is the model's only foreign key and it cannot be changed
//              through this endpoint, while departmentId has no foreign key at
//              all. A department deleted between its check and the update
//              therefore leaves a dangling id rather than raising anything — the
//              same silent outcome as Student.programmeId.
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

    const parsedParams = employeeIdParamSchema.safeParse(await params);
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

    const parsedBody = updateEmployeeSchema.safeParse(body);
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

    const employeeRecordId = parsedParams.data.id;

    // One load serves three purposes: existence with tenant ownership, and the
    // current employeeId and departmentId used to decide which further checks are
    // needed at all.
    const existing = await prisma.employee.findFirst({
      where: { id: employeeRecordId, tenantId: tenant.id },
      select: { id: true, employeeId: true, departmentId: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Employee not found", "NOT_FOUND"), { status: 404 });
    }

    const input = parsedBody.data;

    const departmentChanging =
      input.departmentId !== undefined && input.departmentId !== existing.departmentId;
    const employeeIdChanging =
      input.employeeId !== undefined && input.employeeId !== existing.employeeId;

    // Independent, so they are issued together rather than in sequence. An
    // unchanged field contributes no query at all.
    const [department, duplicateEmployeeId] = await Promise.all([
      departmentChanging
        ? prisma.department.findFirst({
            where: { id: input.departmentId, tenantId: tenant.id },
            select: { id: true },
          })
        : Promise.resolve(null),
      employeeIdChanging
        ? prisma.employee.findUnique({
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
    // different employee by construction.
    if (employeeIdChanging && duplicateEmployeeId) {
      return NextResponse.json(
        fail("Employee id already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    // Scoped by tenantId as well as id, so the write cannot reach another tenant's
    // row even if the id were guessed. Single statement, so the update is atomic
    // on its own.
    const employee = await prisma.employee.update({
      where: { id: employeeRecordId, tenantId: tenant.id },
      data: input,
      select: EMPLOYEE_SELECT,
    });

    return NextResponse.json(ok(employee, "Employee updated"));
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
      // The employee was deleted between the load and the update.
      if (isRecordNotFound(err)) {
        return NextResponse.json(fail("Employee not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[PATCH /api/employees/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
