// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Batch Detail
// FLOW   : View, update and delete a tenant-owned batch.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma Batch model.
// PURPOSE: Manage a single batch within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import {
  batchIdParamSchema,
  updateBatchSchema,
} from "@/lib/validations/batch";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/** Prisma's "record required but not found" code. */
const RECORD_NOT_FOUND = "P2025";

// Batch holds only scalar values and createdAt. No BigInt, Decimal or Json
// column exists, so the shared serialize() helper is unnecessary.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : batchIdParamSchema.
// FLOW       : Authorise → resolve tenant → fetch tenant-owned batch.
// RESPONSE   : { success: true, data: <Batch> }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
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

    const parsed = batchIdParamSchema.safeParse(await params);
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

    const batch = await prisma.batch.findFirst({
      where: {
        id: parsed.data.id,
        tenantId: tenant.id,
      },
    });

    if (!batch) {
      return NextResponse.json(
        fail("Batch not found", "NOT_FOUND"),
        { status: 404 }
      );
    }

    return NextResponse.json(ok(batch));
  } catch (err) {
    console.error("[GET /api/batches/[id]]", err);

    return NextResponse.json(
      fail("Internal server error", "SERVER_ERROR"),
      { status: 500 }
    );
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : batchIdParamSchema + updateBatchSchema.
// FLOW       :
// Authorise
// → resolve tenant
// → validate
// → verify tenant ownership
// → verify changed relations
// → verify duplicate code only if changed
// → atomic update
// RESPONSE   : { success: true, data: <Batch>, message: "Batch updated" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
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

    const parsedParams = batchIdParamSchema.safeParse(await params);

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

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        fail("Invalid input", "VALIDATION_ERROR"),
        { status: 400 }
      );
    }

    const parsedBody = updateBatchSchema.safeParse(body);

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

    const batchId = parsedParams.data.id;

    const existing = await prisma.batch.findFirst({
      where: {
        id: batchId,
        tenantId: tenant.id,
      },
      select: {
        id: true,
        code: true,
        programmeId: true,
        academicYearId: true,
      },
    });

    if (!existing) {
      return NextResponse.json(
        fail("Batch not found", "NOT_FOUND"),
        { status: 404 }
      );
    }

    const input = parsedBody.data;

    const programmeChanging =
      input.programmeId !== undefined &&
      input.programmeId !== existing.programmeId;

    const academicYearChanging =
      input.academicYearId !== undefined &&
      input.academicYearId !== existing.academicYearId;

    const codeChanging =
      input.code !== undefined &&
      input.code !== existing.code;

    const [programme, academicYear, duplicate] =
      await Promise.all([
        programmeChanging
          ? prisma.programme.findFirst({
              where: {
                id: input.programmeId,
                tenantId: tenant.id,
              },
              select: {
                id: true,
              },
            })
          : Promise.resolve(null),

        academicYearChanging
          ? prisma.academicYear.findFirst({
              where: {
                id: input.academicYearId,
                tenantId: tenant.id,
              },
              select: {
                id: true,
              },
            })
          : Promise.resolve(null),

        codeChanging
          ? prisma.batch.findUnique({
              where: {
                tenantId_code: {
                  tenantId: tenant.id,
                  code: input.code as string,
                },
              },
              select: {
                id: true,
              },
            })
          : Promise.resolve(null),
      ]);

    if (programmeChanging && !programme) {
      return NextResponse.json(
        fail("Programme not found", "NOT_FOUND"),
        { status: 404 }
      );
    }

    if (academicYearChanging && !academicYear) {
      return NextResponse.json(
        fail("Academic year not found", "NOT_FOUND"),
        { status: 404 }
      );
    }

    if (codeChanging && duplicate) {
      return NextResponse.json(
        fail("Batch code already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    const batch = await prisma.batch.update({
      where: {
        id: batchId,
        tenantId: tenant.id,
      },
      data: input,
    });

    return NextResponse.json(
      ok(batch, "Batch updated")
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Batch code already in use", "CONFLICT"),
          { status: 409 }
        );
      }

      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail(
            "Referenced programme or academic year not found",
            "NOT_FOUND"
          ),
          { status: 404 }
        );
      }

      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(
          fail("Batch not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[PATCH /api/batches/[id]]", err);

    return NextResponse.json(
      fail("Internal server error", "SERVER_ERROR"),
      { status: 500 }
    );
  }
}
// DELETE
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : batchIdParamSchema.
// FLOW       :
// Authorise
// → resolve tenant
// → validate
// → verify tenant ownership
// → delete tenant-owned batch
// RESPONSE   : { success: true, data: null, message: "Batch deleted" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
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

    const parsed = batchIdParamSchema.safeParse(await params);

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

    const batchId = parsed.data.id;

    const existing = await prisma.batch.findFirst({
      where: {
        id: batchId,
        tenantId: tenant.id,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return NextResponse.json(
        fail("Batch not found", "NOT_FOUND"),
        { status: 404 }
      );
    }

    await prisma.batch.delete({
      where: {
        id: batchId,
        tenantId: tenant.id,
      },
    });

    return NextResponse.json(
      ok(null, "Batch deleted")
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Section, Student or any future dependent model still references
      // this batch. The database prevents orphaned records.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail(
            "Batch has dependent records and cannot be deleted",
            "CONFLICT"
          ),
          { status: 409 }
        );
      }

      // Batch deleted after lookup but before delete.
      if (err.code === RECORD_NOT_FOUND) {
        return NextResponse.json(
          fail("Batch not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[DELETE /api/batches/[id]]", err);

    return NextResponse.json(
      fail("Internal server error", "SERVER_ERROR"),
      { status: 500 }
    );
  }
}