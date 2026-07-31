// ============================================================================
// OWNER  : Gauransh
// MODULE : University — School Detail
// FLOW   : View, update and delete a tenant-owned school.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma School model.
// PURPOSE: Manage a single school within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { schoolIdParamSchema, updateSchoolSchema } from "@/lib/validations/school";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/** Prisma's "record required but not found" code, raised by update/delete. */
const RECORD_NOT_FOUND = "P2025";

// School holds no BigInt, Decimal or Json column — only strings and timestamps
// — so neither the shared serialize() helper nor an InputJsonValue cast applies
// here. The schema is immutable, so that cannot change.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : schoolIdParamSchema — the [id] segment must be non-empty once
//              trimmed.
// FLOW       : Authorise → resolve tenant → read the school filtered by BOTH id
//              and tenantId, so a school owned by another tenant is simply not
//              found rather than being disclosed. No relation is expanded.
// RESPONSE   : { success: true, data: <School> }
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
    const parsed = schoolIdParamSchema.safeParse(await params);
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
    const school = await prisma.school.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
    });

    if (!school) {
      return NextResponse.json(fail("School not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(school));
  } catch (err) {
    console.error("[GET /api/schools/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : schoolIdParamSchema for the [id] segment, updateSchoolSchema for
//              the body. Every field optional but at least one required.
//              tenantId cannot appear in the body, so a school cannot be moved
//              between tenants.
// FLOW       : Authorise → resolve tenant → validate → confirm the school
//              belongs to this tenant (404 otherwise) → when campusId is
//              changing, confirm the target campus also belongs to this tenant
//              (404 otherwise) → when code is changing, re-check uniqueness
//              (409 otherwise) → apply one atomic update scoped by id and
//              tenantId.
//              The campus re-check matters because campusId is client-supplied
//              and mutable: without it a caller could re-point their own school
//              at another tenant's campus. The database's foreign key would
//              accept that, since it only verifies the campus exists.
// RESPONSE   : { success: true, data: <School>, message: "School updated" }
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

    const parsedParams = schoolIdParamSchema.safeParse(await params);
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

    const parsedBody = updateSchoolSchema.safeParse(body);
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

    const schoolId = parsedParams.data.id;

    // One lookup serves three purposes: existence, tenant ownership, and the
    // current code and campusId used to decide whether further checks are
    // needed at all.
    const existing = await prisma.school.findFirst({
      where: { id: schoolId, tenantId: tenant.id },
      select: { id: true, code: true, campusId: true },
    });

    if (!existing) {
      return NextResponse.json(fail("School not found", "NOT_FOUND"), { status: 404 });
    }

    const input = parsedBody.data;

    // Only when the campus is actually changing — re-pointing at the school's
    // own current campus needs no verification.
    if (input.campusId !== undefined && input.campusId !== existing.campusId) {
      const campus = await prisma.campus.findFirst({
        where: { id: input.campusId, tenantId: tenant.id },
        select: { id: true },
      });

      if (!campus) {
        return NextResponse.json(fail("Campus not found", "NOT_FOUND"), { status: 404 });
      }
    }

    // Uniqueness is only re-checked for a code that is actually changing —
    // resubmitting the school's own current code is not a conflict with itself.
    // The constraint is @@unique([tenantId, code]), so the same code may
    // legitimately exist under a different tenant.
    if (input.code !== undefined && input.code !== existing.code) {
      const clash = await prisma.school.findUnique({
        where: { tenantId_code: { tenantId: tenant.id, code: input.code } },
        select: { id: true },
      });

      if (clash) {
        return NextResponse.json(fail("School code already in use", "CONFLICT"), { status: 409 });
      }
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed. Single statement, so the update
    // is atomic on its own.
    const school = await prisma.school.update({
      where: { id: schoolId, tenantId: tenant.id },
      data: input,
    });

    return NextResponse.json(ok(school, "School updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the code between the check and the update.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(fail("School code already in use", "CONFLICT"), { status: 409 });
      }
      // The campus was deleted between the ownership check and the update, so
      // the foreign key rejected the new reference.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(fail("Campus not found", "NOT_FOUND"), { status: 404 });
      }
      // The school was deleted between the lookup and the update.
      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(fail("School not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[PATCH /api/schools/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// DELETE
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : schoolIdParamSchema — the [id] segment must be non-empty once
//              trimmed.
// FLOW       : Authorise → resolve tenant → confirm the school belongs to this
//              tenant (404 otherwise) → issue a single delete scoped by id and
//              tenantId.
//              No cascade is performed in application code; the database owns
//              that. Note that Department.schoolId is ON DELETE SET NULL, not
//              RESTRICT, so deleting a school does NOT fail when departments
//              reference it — those departments survive with schoolId cleared.
//              The foreign-key branch below is therefore correct but not
//              currently reachable: no constraint on School is RESTRICT. It is
//              retained so a blocked delete could never be misreported as a
//              500 if a future reference behaved differently.
// RESPONSE   : { success: true, data: null, message: "School deleted" }
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

    const parsed = schoolIdParamSchema.safeParse(await params);
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

    const schoolId = parsed.data.id;

    const existing = await prisma.school.findFirst({
      where: { id: schoolId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(fail("School not found", "NOT_FOUND"), { status: 404 });
    }

    await prisma.school.delete({
      where: { id: schoolId, tenantId: tenant.id },
    });

    return NextResponse.json(ok(null, "School deleted"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Reported, not worked around: no dependent row is ever removed here.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("School has dependent records and cannot be deleted", "CONFLICT"),
          { status: 409 }
        );
      }
      // The school was deleted between the lookup and the delete.
      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(fail("School not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[DELETE /api/schools/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
