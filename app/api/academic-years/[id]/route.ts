// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Academic Year Detail
// FLOW   : View, update and delete a tenant-owned academic year.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma AcademicYear model.
// PURPOSE: Manage a single academic year within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import {
  academicYearIdParamSchema,
  updateAcademicYearSchema,
} from "@/lib/validations/academic-year";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/** Prisma's "record required but not found" code, raised by update/delete. */
const RECORD_NOT_FOUND = "P2025";

// AcademicYear holds no BigInt, Decimal or Json column, so the shared
// serialize() helper is not applied here. The schema is immutable, so that
// cannot change.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : academicYearIdParamSchema — the [id] segment must be non-empty
//              once trimmed.
// FLOW       : Authorise → resolve tenant → read the academic year filtered by
//              BOTH id and tenantId, so one owned by another tenant is simply
//              not found rather than being disclosed. No relation is expanded.
// RESPONSE   : { success: true, data: <AcademicYear> }
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
    const parsed = academicYearIdParamSchema.safeParse(await params);
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
    const academicYear = await prisma.academicYear.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
    });

    if (!academicYear) {
      return NextResponse.json(fail("Academic year not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(academicYear));
  } catch (err) {
    console.error("[GET /api/academic-years/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : academicYearIdParamSchema for the [id] segment,
//              updateAcademicYearSchema for the body. Every field optional but
//              at least one required. tenantId cannot appear in the body, so an
//              academic year cannot be moved between tenants.
// FLOW       : Authorise → resolve tenant → validate → confirm the academic
//              year belongs to this tenant (404 otherwise) → re-check name
//              uniqueness ONLY when the name is both supplied and changing →
//              apply one atomic update scoped by id and tenantId.
// RESPONSE   : { success: true, data: <AcademicYear>,
//                message: "Academic year updated" }
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

    const parsedParams = academicYearIdParamSchema.safeParse(await params);
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

    const parsedBody = updateAcademicYearSchema.safeParse(body);
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

    const academicYearId = parsedParams.data.id;

    const existing = await prisma.academicYear.findFirst({
      where: { id: academicYearId, tenantId: tenant.id },
      select: { id: true, name: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Academic year not found", "NOT_FOUND"), { status: 404 });
    }

    const input = parsedBody.data;

    // Uniqueness is only re-checked for a name that is actually changing —
    // resubmitting the academic year's own current name is not a conflict with
    // itself. The constraint is @@unique([tenantId, name]), so the same name
    // may legitimately exist under a different tenant.
    if (input.name !== undefined && input.name !== existing.name) {
      const clash = await prisma.academicYear.findUnique({
        where: { tenantId_name: { tenantId: tenant.id, name: input.name } },
        select: { id: true },
      });

      if (clash) {
        return NextResponse.json(
          fail("Academic year name already in use", "CONFLICT"),
          { status: 409 }
        );
      }
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed.
    //
    // At most one academic year per tenant may be current. When this one claims
    // it, every other current year is cleared and this row updated in a single
    // transaction, so the two never diverge. The NOT clause leaves this row
    // untouched by the clear, and only an explicit isCurrent: true triggers it —
    // false or omitted leaves any existing current year alone.
    const academicYear =
      input.isCurrent === true
        ? (
            await prisma.$transaction([
              prisma.academicYear.updateMany({
                where: { tenantId: tenant.id, isCurrent: true, NOT: { id: academicYearId } },
                data: { isCurrent: false },
              }),
              prisma.academicYear.update({
                where: { id: academicYearId, tenantId: tenant.id },
                data: input,
              }),
            ])
          )[1]
        : await prisma.academicYear.update({
            where: { id: academicYearId, tenantId: tenant.id },
            data: input,
          });

    return NextResponse.json(ok(academicYear, "Academic year updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the name between the check and the update.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Academic year name already in use", "CONFLICT"),
          { status: 409 }
        );
      }
      // The academic year was deleted between the lookup and the update.
      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(fail("Academic year not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[PATCH /api/academic-years/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// DELETE
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : academicYearIdParamSchema — the [id] segment must be non-empty
//              once trimmed.
// FLOW       : Authorise → resolve tenant → confirm the academic year belongs
//              to this tenant (404 otherwise) → issue a single delete scoped by
//              id and tenantId.
//              No cascade is performed in application code; the database owns
//              that. Semester.academicYearId and Batch.academicYearId are both
//              ON DELETE RESTRICT, so an academic year that still has semesters
//              or batches cannot be deleted and surfaces as a foreign-key
//              violation → CONFLICT. Nothing referencing it cascades or nulls
//              out.
// RESPONSE   : { success: true, data: null,
//                message: "Academic year deleted" }
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

    const parsed = academicYearIdParamSchema.safeParse(await params);
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

    const academicYearId = parsed.data.id;

    const existing = await prisma.academicYear.findFirst({
      where: { id: academicYearId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Academic year not found", "NOT_FOUND"), { status: 404 });
    }

    await prisma.academicYear.delete({
      where: { id: academicYearId, tenantId: tenant.id },
    });

    return NextResponse.json(ok(null, "Academic year deleted"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Semesters or batches still reference this academic year; the database
      // refuses the delete rather than orphaning them. Reported, not worked
      // around.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Academic year has dependent records and cannot be deleted", "CONFLICT"),
          { status: 409 }
        );
      }
      // The academic year was deleted between the lookup and the delete.
      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(fail("Academic year not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[DELETE /api/academic-years/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
