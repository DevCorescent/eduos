// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Batch Collection
// FLOW   : List and create tenant-owned batches.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma Batch model.
// PURPOSE: Manage batches within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { createBatchSchema, listBatchesQuerySchema } from "@/lib/validations/batch";
import { ok, fail } from "@/types";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

// Batch holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : listBatchesQuerySchema — ?page and ?limit from the shared
//              pagination contract.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              batches alongside the total in a single transaction. Both
//              queries are filtered by the resolved tenant id, so no
//              cross-tenant row is reachable. No relation is expanded.
// RESPONSE   : { success: true, data: { batches, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = listBatchesQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const { page, limit } = parsed.data;

    const [batches, total] = await prisma.$transaction([
      prisma.batch.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.batch.count({ where: { tenantId: tenant.id } }),
    ]);

    return NextResponse.json(
      ok({
        batches,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/batches]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createBatchSchema — programmeId, academicYearId, name and code
//              required; maxStrength optional. tenantId is never accepted from
//              the client.
// FLOW       : Authorise → resolve tenant → parse body → verify programme
//              ownership, academic year ownership and code uniqueness as three
//              independent reads issued together → apply in fixed precedence →
//              create the batch under the resolved tenant.
//              Both ownership checks are scoped by tenantId, so a row owned by
//              another tenant is reported as NOT_FOUND exactly like a
//              nonexistent one. The database's foreign keys cannot achieve this
//              alone — they verify only that the referenced row exists.
//              Batch.code is unique per tenant via @@unique([tenantId, code]).
// RESPONSE   : { success: true, data: <Batch>, message: "Batch created" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = createBatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const input = parsed.data;

    // Three independent reads, issued together rather than in sequence.
    const [programme, academicYear, duplicate] = await Promise.all([
      prisma.programme.findFirst({
        where: { id: input.programmeId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.academicYear.findFirst({
        where: { id: input.academicYearId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.batch.findUnique({
        where: { tenantId_code: { tenantId: tenant.id, code: input.code } },
        select: { id: true },
      }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: invalid references before constraint clashes.
    if (!programme) {
      return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
    }

    if (!academicYear) {
      return NextResponse.json(fail("Academic year not found", "NOT_FOUND"), { status: 404 });
    }

    if (duplicate) {
      return NextResponse.json(fail("Batch code already in use", "CONFLICT"), { status: 409 });
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context, never from the request body.
    const batch = await prisma.batch.create({
      data: {
        ...input,
        tenantId: tenant.id,
      },
    });

    return NextResponse.json(ok(batch, "Batch created"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the code between the check and the insert.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(fail("Batch code already in use", "CONFLICT"), { status: 409 });
      }
      // The programme or academic year was deleted between the ownership check
      // and the insert. Which of the two is not reliably recoverable from the
      // error, so both are reported together rather than guessed at.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced programme or academic year not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[POST /api/batches]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
