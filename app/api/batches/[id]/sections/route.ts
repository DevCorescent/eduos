// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Batch Sections
// FLOW   : List and create sections for a tenant-owned batch.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma Section model.
// PURPOSE: Manage sections within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { batchIdParamSchema } from "@/lib/validations/batch";
import {
  createSectionSchema,
  listSectionsQuerySchema,
} from "@/lib/validations/section";
import { ok, fail } from "@/types";

/** Prisma unique constraint violation. */
const UNIQUE_VIOLATION = "P2002";

// Section contains only scalar values and createdAt. No serializer is required.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : batchIdParamSchema + listSectionsQuerySchema
// FLOW       :
// Authorise
// → resolve tenant
// → validate route
// → validate query
// → verify batch belongs to tenant
// → return paginated sections
// RESPONSE   : { success:true,data:{sections,pagination} }
export async function GET(
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
        fail("Invalid input", "VALIDATION_ERROR"),
        { status: 400 }
      );
    }

    const parsedQuery = listSectionsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );

    if (!parsedQuery.success) {
      return NextResponse.json(
        fail("Invalid input", "VALIDATION_ERROR"),
        { status: 400 }
      );
    }

    const batchId = parsedParams.data.id;

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
        { status: 404 }
      );
    }

    const { page, limit } = parsedQuery.data;

    const where = {
      tenantId: tenant.id,
      batchId,
    };

    const [sections, total] = await prisma.$transaction([
      prisma.section.findMany({
        where,
        orderBy: [
          {
            createdAt: "desc",
          },
          {
            id: "desc",
          },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.section.count({
        where,
      }),
    ]);

    return NextResponse.json(
      ok({
        sections,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/batches/[id]/sections]", err);

    return NextResponse.json(
      fail("Internal server error", "SERVER_ERROR"),
      {
        status: 500,
      }
    );
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : batchIdParamSchema + createSectionSchema
// FLOW       :
// Authorise
// → resolve tenant
// → validate
// → verify batch ownership
// → verify semester ownership
// → verify duplicate section name within batch
// → create section
// RESPONSE   : { success:true,data:<Section>,message:"Section created" }
export async function POST(
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
        fail("Invalid input", "VALIDATION_ERROR"),
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

    const parsedBody = createSectionSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        fail("Invalid input", "VALIDATION_ERROR"),
        { status: 400 }
      );
    }

    const batchId = parsedParams.data.id;
    const input = parsedBody.data;
        // Three independent reads executed together.
    const [batch, semester, duplicate] = await Promise.all([
      prisma.batch.findFirst({
        where: {
          id: batchId,
          tenantId: tenant.id,
        },
        select: {
          id: true,
        },
      }),

      prisma.semester.findFirst({
        where: {
          id: input.semesterId,
          tenantId: tenant.id,
        },
        select: {
          id: true,
        },
      }),

      prisma.section.findFirst({
        where: {
          batchId,
          name: input.name,
        },
        select: {
          id: true,
        },
      }),
    ]);

    // Fixed validation precedence.

    if (!batch) {
      return NextResponse.json(
        fail("Batch not found", "NOT_FOUND"),
        { status: 404 }
      );
    }

    if (!semester) {
      return NextResponse.json(
        fail("Semester not found", "NOT_FOUND"),
        { status: 404 }
      );
    }

    if (duplicate) {
      return NextResponse.json(
        fail("Section name already exists in this batch", "CONFLICT"),
        { status: 409 }
      );
    }

    const section = await prisma.section.create({
      data: {
        ...input,
        tenantId: tenant.id,
        batchId,
      },
    });

    return NextResponse.json(
      ok(section, "Section created"),
      {
        status: 201,
      }
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Concurrent duplicate insert.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Section name already exists in this batch", "CONFLICT"),
          {
            status: 409,
          }
        );
      }

      // Batch or semester deleted after validation.
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

    console.error("[POST /api/batches/[id]/sections]", err);

    return NextResponse.json(
      fail("Internal server error", "SERVER_ERROR"),
      {
        status: 500,
      }
    );
  }
}