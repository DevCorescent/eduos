// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Section
// FLOW   : Retrieve, update and delete a tenant-owned section.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma Section model.
// PURPOSE: Manage an individual section.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import {
  isForeignKeyViolation,
  isRecordNotFound,
} from "@/lib/utils/prisma-errors";
import {
  sectionIdParamSchema,
  updateSectionSchema,
} from "@/lib/validations/section";
import { ok, fail } from "@/types";

/** Prisma unique constraint violation. */
const UNIQUE_VIOLATION = "P2002";

// ============================================================================
// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : sectionIdParamSchema
// FLOW       :
// Authorise
// → resolve tenant
// → validate route
// → fetch tenant-owned section
// → return section
// RESPONSE   : { success:true,data:<Section> }
// ============================================================================
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

    const parsedParams = sectionIdParamSchema.safeParse(await params);

    if (!parsedParams.success) {
      return NextResponse.json(
        fail("Invalid input", "VALIDATION_ERROR"),
        {
          status: 400,
        }
      );
    }

    const section = await prisma.section.findFirst({
      where: {
        id: parsedParams.data.id,
        tenantId: tenant.id,
      },
    });

    if (!section) {
      return NextResponse.json(
        fail("Section not found", "NOT_FOUND"),
        {
          status: 404,
        }
      );
    }

    return NextResponse.json(ok(section));
  } catch (err) {
    console.error("[GET /api/sections/[id]]", err);

    return NextResponse.json(
      fail("Internal server error", "SERVER_ERROR"),
      {
        status: 500,
      }
    );
  }
}
// ============================================================================
// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : sectionIdParamSchema + updateSectionSchema
// FLOW       :
// Authorise
// → resolve tenant
// → validate
// → fetch existing section
// → validate changed relations
// → validate duplicate name
// → update section
// RESPONSE   : { success:true,data:<Section>,message:"Section updated" }
// ============================================================================
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

    const parsedParams = sectionIdParamSchema.safeParse(await params);

    if (!parsedParams.success) {
      return NextResponse.json(
        fail("Invalid input", "VALIDATION_ERROR"),
        {
          status: 400,
        }
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        fail("Invalid input", "VALIDATION_ERROR"),
        {
          status: 400,
        }
      );
    }

    const parsedBody = updateSectionSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        fail("Invalid input", "VALIDATION_ERROR"),
        {
          status: 400,
        }
      );
    }

    const sectionId = parsedParams.data.id;
    const input = parsedBody.data;

    const existing = await prisma.section.findFirst({
      where: {
        id: sectionId,
        tenantId: tenant.id,
      },
    });

    if (!existing) {
      return NextResponse.json(
        fail("Section not found", "NOT_FOUND"),
        {
          status: 404,
        }
      );
    }

    const batchId = input.batchId ?? existing.batchId;
    const semesterId = input.semesterId ?? existing.semesterId;
    const name = input.name ?? existing.name;

    const batchChanged = batchId !== existing.batchId;
    const semesterChanged = semesterId !== existing.semesterId;
    const identityChanged =
      batchChanged ||
      semesterChanged ||
      name !== existing.name;

    if (batchChanged) {
      const batch = await prisma.batch.findFirst({
        where: {
          id: batchId,
          tenantId: tenant.id,
        },
        select: {
          id: true,
        },
      });

      if (!batch) {
        return NextResponse.json(
          fail("Batch not found", "NOT_FOUND"),
          {
            status: 404,
          }
        );
      }
    }

    if (semesterChanged) {
      const semester = await prisma.semester.findFirst({
        where: {
          id: semesterId,
          tenantId: tenant.id,
        },
        select: {
          id: true,
        },
      });

      if (!semester) {
        return NextResponse.json(
          fail("Semester not found", "NOT_FOUND"),
          {
            status: 404,
          }
        );
      }
    }

    if (identityChanged) {
      const duplicate = await prisma.section.findFirst({
        where: {
          batchId,
          semesterId,
          name,
          NOT: {
            id: sectionId,
          },
        },
        select: {
          id: true,
        },
      });

      if (duplicate) {
        return NextResponse.json(
          fail(
            "Section name already exists for this batch and semester",
            "CONFLICT"
          ),
          {
            status: 409,
          }
        );
      }
    }

    const updated = await prisma.section.update({
      where: {
        id: sectionId,
      },
      data: input,
    });

    return NextResponse.json(
      ok(updated, "Section updated")
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail(
            "Section name already exists for this batch and semester",
            "CONFLICT"
          ),
          {
            status: 409,
          }
        );
      }

      if (isRecordNotFound(err)) {
        return NextResponse.json(
          fail("Section not found", "NOT_FOUND"),
          {
            status: 404,
          }
        );
      }

      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail(
            "Referenced batch or semester not found",
            "NOT_FOUND"
          ),
          {
            status: 404,
          }
        );
      }
    }

    console.error("[PATCH /api/sections/[id]]", err);

    return NextResponse.json(
      fail("Internal server error", "SERVER_ERROR"),
      {
        status: 500,
      }
    );
  }
}
// ============================================================================
// DELETE
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : sectionIdParamSchema
// FLOW       :
// Authorise
// → resolve tenant
// → validate route
// → verify section belongs to tenant
// → delete section
// RESPONSE   : { success:true,message:"Section deleted" }
// ============================================================================
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

    const parsedParams = sectionIdParamSchema.safeParse(await params);

    if (!parsedParams.success) {
      return NextResponse.json(
        fail("Invalid input", "VALIDATION_ERROR"),
        {
          status: 400,
        }
      );
    }

    const sectionId = parsedParams.data.id;

    const existing = await prisma.section.findFirst({
      where: {
        id: sectionId,
        tenantId: tenant.id,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return NextResponse.json(
        fail("Section not found", "NOT_FOUND"),
        {
          status: 404,
        }
      );
    }

    await prisma.section.delete({
      where: {
        id: sectionId,
      },
    });

    return NextResponse.json(
      ok(null, "Section deleted")
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (isRecordNotFound(err)) {
        return NextResponse.json(
          fail("Section not found", "NOT_FOUND"),
          {
            status: 404,
          }
        );
      }

      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail(
            "Cannot delete section because it is referenced by other records",
            "CONFLICT"
          ),
          {
            status: 409,
          }
        );
      }
    }

    console.error("[DELETE /api/sections/[id]]", err);

    return NextResponse.json(
      fail("Internal server error", "SERVER_ERROR"),
      {
        status: 500,
      }
    );
  }
}