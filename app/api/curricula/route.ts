// ============================================================================
// OWNER  : Gauransh
// MODULE : Curriculum — Curriculum Collection
// FLOW   : Guard → tenant → query/body → programme ownership check → duplicate
//          version check → list/create → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: List and create curriculum versions within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { createCurriculumSchema, curriculumQuerySchema } from "@/lib/validations/curriculum";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a curriculum. Declared once so both handlers answer with
 * the same shape.
 *
 * No relation is expanded. The programme is not joined, so the response carries
 * programmeId rather than the programme's name or code, and subjects are not
 * included: the README reaches those through GET /api/curricula/[id], which is
 * defined as "Curriculum with all subjects". Nesting them into every list row
 * would make an unbounded query out of a paginated one.
 */
const CURRICULUM_SELECT = {
  id: true,
  tenantId: true,
  programmeId: true,
  name: true,
  version: true,
  effectiveFrom: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Curriculum holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here. effectiveFrom is a DateTime and carries its own
// toJSON, so it needs no special handling.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : curriculumQuerySchema — ?page (default 1) and ?limit (default 20,
//              max 100), from the shared pagination contract. No search or filter
//              parameter is defined: the project implements none on any existing
//              collection endpoint. In particular there is no ?programmeId and no
//              ?isActive filter, so every curriculum in the tenant lists together
//              and the client reads the flags.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              curricula alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable.
// RESPONSE   : { success: true, data: { curricula, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
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

    const parsed = curriculumQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
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

    const { page, limit } = parsed.data;
    const where = { tenantId: tenant.id };

    // Paired in one transaction so the total cannot shift between the two reads.
    // The ordering is required for correctness, not presentation: offset
    // pagination over an unordered result can repeat or skip rows, and the id
    // tiebreaker matters because several versions created in one sitting can
    // share a createdAt timestamp, leaving createdAt alone non-deterministic.
    const [curricula, total] = await prisma.$transaction([
      prisma.curriculum.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: CURRICULUM_SELECT,
      }),
      prisma.curriculum.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        curricula,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/curricula]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createCurriculumSchema — programmeId, name, version and
//              effectiveFrom required; only isActive optional. tenantId, id,
//              createdAt and updatedAt are absent from the schema and so are
//              stripped from any body that supplies them.
// FLOW       : Authorise → resolve tenant → parse body → run both lookups
//              together → apply them in a fixed precedence → create.
//
//              The programme is verified to exist AND to belong to this tenant.
//              Curriculum.programmeId does carry a foreign key, but a foreign key
//              proves existence rather than ownership, so a programme owned by
//              another tenant would satisfy the database while breaking tenant
//              isolation. Curriculum.tenantId itself carries no foreign key at
//              all, so nothing in the schema ties the two together — this lookup
//              is what keeps them consistent. An unknown programme and one owned
//              by another tenant return the identical 404, so no id is ever
//              confirmed to exist elsewhere.
//
//              @@unique([programmeId, version]) is the model's only uniqueness
//              rule. Note that it is not tenant-scoped, unlike the tenant-scoped
//              keys elsewhere in the project: the pair is unique globally. That is
//              equivalent in practice because the programme is proven tenant-owned
//              first, so any row sharing the pair belongs to this tenant too.
//
//              Multiple curricula with isActive true are permitted for the same
//              programme, per the approved Phase 8 decisions. No current-flag rule
//              is enforced, unlike AcademicYear and Semester in Phase 4 where
//              exactly one current record was specified — the schema declares no
//              such constraint for Curriculum. name is not part of any key either,
//              so two curricula under one programme may share a name.
// RESPONSE   : { success: true, data: <Curriculum>,
//                message: "Curriculum created" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              Unlike the course routes, a foreign-key branch is reachable here
//              and so is handled: programmeId has a real foreign key with ON
//              DELETE RESTRICT, so a programme deleted between its check and the
//              insert makes the write fail rather than leaving a dangling id.
export async function POST(request: NextRequest) {
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

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = createCurriculumSchema.safeParse(body);
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

    const input = parsed.data;

    // Two independent reads, so they are issued together rather than in sequence.
    const [programme, duplicateVersion] = await Promise.all([
      prisma.programme.findFirst({
        where: { id: input.programmeId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.curriculum.findUnique({
        where: {
          programmeId_version: { programmeId: input.programmeId, version: input.version },
        },
        select: { id: true },
      }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: an invalid reference before the constraint clash. It also
    // matters for isolation — a foreign programmeId must report 404 rather than
    // disclosing, through a 409, that some version of it already exists.
    if (!programme) {
      return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
    }

    if (duplicateVersion) {
      return NextResponse.json(
        fail("Curriculum version already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context, never from the request body.
    const curriculum = await prisma.curriculum.create({
      data: {
        ...input,
        tenantId: tenant.id,
      },
      select: CURRICULUM_SELECT,
    });

    return NextResponse.json(ok(curriculum, "Curriculum created"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the version between the pre-check and the
      // insert. The programme/version pair is the model's only unique
      // constraint, so it is the only cause this branch can have.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Curriculum version already in use", "CONFLICT"),
          { status: 409 }
        );
      }
      // The programme was deleted between its check and the insert, so the
      // foreign key rejected the reference.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[POST /api/curricula]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
