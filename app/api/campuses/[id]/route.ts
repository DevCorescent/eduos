// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Campus Detail
// FLOW   : View, update and delete a tenant-owned campus.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma Campus model.
// PURPOSE: Manage a single campus within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { campusIdParamSchema, updateCampusSchema } from "@/lib/validations/campus";
import { ok, fail } from "@/types";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/** Prisma's "record required but not found" code, raised by update/delete. */
const RECORD_NOT_FOUND = "P2025";

// Foreign-key detection lives in lib/utils/prisma-errors, shared with the other
// detail routes that map a blocked write onto the existing CONFLICT response.

// Campus holds no BigInt or Decimal column, so the shared serialize() helper is
// not applied here. The schema is immutable, so that cannot change.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : campusIdParamSchema — the [id] segment must be non-empty once
//              trimmed.
// FLOW       : Authorise → resolve tenant → read the campus filtered by BOTH id
//              and tenantId, so a campus owned by another tenant is simply not
//              found rather than being disclosed.
// RESPONSE   : { success: true, data: <Campus> }
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
    const parsed = campusIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    // findFirst rather than findUnique: the tenant filter is part of the lookup,
    // so another tenant's row can never be returned or even acknowledged.
    const campus = await prisma.campus.findFirst({
      where: { id: parsed.data.id, tenantId: tenant.id },
    });

    if (!campus) {
      return NextResponse.json(fail("Campus not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(campus));
  } catch (err) {
    console.error("[GET /api/campuses/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : campusIdParamSchema for the [id] segment, updateCampusSchema for
//              the body. Every field optional but at least one required.
//              tenantId cannot appear in the body, so a campus cannot be moved
//              between tenants.
// FLOW       : Authorise → resolve tenant → validate → confirm the campus
//              belongs to this tenant (404 otherwise) → re-check code
//              uniqueness ONLY when the code is both supplied and changing →
//              apply one atomic update scoped by id and tenantId.
// RESPONSE   : { success: true, data: <Campus>, message: "Campus updated" }
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

    const parsedParams = campusIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
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

    const parsedBody = updateCampusSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const campusId = parsedParams.data.id;

    const existing = await prisma.campus.findFirst({
      where: { id: campusId, tenantId: tenant.id },
      select: { id: true, code: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Campus not found", "NOT_FOUND"), { status: 404 });
    }

    const { address, ...scalars } = parsedBody.data;

    // Uniqueness is only re-checked for a code that is actually changing —
    // resubmitting the campus's own current code is not a conflict with itself.
    // The constraint is @@unique([tenantId, code]), so the same code may
    // legitimately exist under a different tenant.
    if (scalars.code !== undefined && scalars.code !== existing.code) {
      const clash = await prisma.campus.findUnique({
        where: { tenantId_code: { tenantId: tenant.id, code: scalars.code } },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(fail("Campus code already in use", "CONFLICT"), { status: 409 });
      }
    }

    // Scoped by tenantId as well as id, so the write cannot reach another
    // tenant's row even if the id were guessed. Single statement, so the update
    // is atomic on its own. The JSON column is cast at this boundary because
    // Zod infers an unknown-valued record, which Prisma's InputJsonValue does
    // not accept directly.
    const campus = await prisma.campus.update({
      where: { id: campusId, tenantId: tenant.id },
      data: {
        ...scalars,
        address: address as Prisma.InputJsonValue | undefined,
      },
    });

    return NextResponse.json(ok(campus, "Campus updated"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the code between the check and the update.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(fail("Campus code already in use", "CONFLICT"), { status: 409 });
      }
      // The campus was deleted between the lookup and the update.
      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(fail("Campus not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[PATCH /api/campuses/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// DELETE
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : campusIdParamSchema — the [id] segment must be non-empty once
//              trimmed.
// FLOW       : Authorise → resolve tenant → confirm the campus belongs to this
//              tenant (404 otherwise) → issue a single delete scoped by id and
//              tenantId.
//              No cascade is performed in application code. The database owns
//              that: School.campusId is ON DELETE CASCADE, so a campus's
//              schools are removed with it, while Department.campusId is
//              ON DELETE RESTRICT, so a campus that still has departments
//              cannot be deleted and surfaces as P2003 → CONFLICT.
// RESPONSE   : { success: true, data: null, message: "Campus deleted" }
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

    const parsed = campusIdParamSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const campusId = parsed.data.id;

    const existing = await prisma.campus.findFirst({
      where: { id: campusId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(fail("Campus not found", "NOT_FOUND"), { status: 404 });
    }

    await prisma.campus.delete({
      where: { id: campusId, tenantId: tenant.id },
    });

    return NextResponse.json(ok(null, "Campus deleted"));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Departments still reference this campus; the database refuses the
      // delete rather than orphaning them. Reported, not worked around.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Campus has dependent records and cannot be deleted", "CONFLICT"),
          { status: 409 }
        );
      }
      // The campus was deleted between the lookup and the delete.
      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(fail("Campus not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[DELETE /api/campuses/[id]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
