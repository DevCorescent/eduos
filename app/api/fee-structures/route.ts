// ============================================================================
// OWNER  : Gauransh
// MODULE : Finance — Fee Structure Collection
// FLOW   : Guard → tenant → query/body → tenant-scoped reference checks →
//          list / atomic create with nested components → response.
// ACCESS : GET  — UNIVERSITY_ADMIN · FACULTY
//          POST — UNIVERSITY_ADMIN
//          STUDENT and PARENT have no access to fee structures.
// BACKEND: Prisma
// PURPOSE: List the authenticated tenant's fee structures and create new ones
//          together with their fee components.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { createFeeStructureSchema } from "@/lib/validations/fee-structure";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a fee structure. Declared once so both handlers answer
 * with the same shape.
 *
 * Scalars only — the components relation is not expanded. This follows the
 * project's collection-route convention exactly: CURRICULUM_SELECT in
 * app/api/curricula/route.ts omits its subjects for the same reason, and the
 * curriculum detail route is what nests them. The README describes
 * GET/PATCH /api/fee-structures/[id] as managing "structure + components", so
 * that endpoint is where a component list belongs; a collection page would
 * otherwise carry an unbounded child array per row.
 *
 * The consequence is that POST creates components without echoing them. The
 * response reports the structure as this select defines it, and the caller reads
 * the components back from the detail route. That is the same trade
 * POST /api/attendance and POST /api/examinations/[id]/results already make in
 * reporting a count rather than the rows they wrote.
 *
 * FeeStructure declares no relation for programmeId, batchId or academicYearId,
 * so those three could not be expanded here even if the convention allowed it —
 * the response carries the ids and the client resolves them through their own
 * endpoints.
 */
const FEE_STRUCTURE_SELECT = {
  id: true,
  tenantId: true,
  programmeId: true,
  batchId: true,
  academicYearId: true,
  name: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

// FeeStructure holds no BigInt, Decimal or Json column, so the shared
// serialize() helper is not applied here. Its components do carry Decimal
// columns, but they are not part of this select.

// GET
// ACCESS     : UNIVERSITY_ADMIN · FACULTY. A single requireRole call decides
//              access — both roles read the same rows, so no two-tier logic is
//              needed. A fee structure carries no publication or visibility
//              concept in the schema, so nothing narrows either role's scope.
// VALIDATION : paginationQuerySchema — ?page (default 1) and ?limit (default 20,
//              max 100). The shared contract is consumed directly rather than
//              through a module-local alias, exactly as in the timetable,
//              attendance, assignment and examination routes;
//              lib/validations/fee-structure.ts declares no query alias.
//
//              No filter parameter is read. The README's Phase 11 table names
//              filters for two other endpoints — "filter by student/semester" on
//              /api/fee-demands, and "by programme/semester" on
//              /api/finance/report — and names none for this one. A supplied
//              ?programmeId or ?isActive is therefore ignored rather than
//              honoured or rejected, which is what a plain z.object() does with
//              an unknown key.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's fee
//              structures alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable. FeeStructure.tenantId carries no foreign key — the
//              model has no foreign key on any column — so that predicate is the
//              only record of ownership the read has.
//
//              Ordering is by createdAt then id, both descending — newest first,
//              matching every other collection route in the project. It is
//              required for correctness rather than presentation: offset
//              pagination over an unordered result can repeat or skip rows across
//              pages, and structures created in the same batch can share a
//              createdAt timestamp, leaving createdAt alone non-deterministic.
// RESPONSE   : { success: true, data: { feeStructures, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN", "FACULTY");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const { tenant } = tenantGuard;

    const parsed = paginationQuerySchema.safeParse(
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
    const [feeStructures, total] = await prisma.$transaction([
      prisma.feeStructure.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: FEE_STRUCTURE_SELECT,
      }),
      prisma.feeStructure.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        feeStructures,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/fee-structures]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN only. A caller holding FACULTY reads fee
//              structures but does not create them, so a faculty member receives
//              the guard's 403 — the same 403 any other unpermitted role
//              receives.
// VALIDATION : createFeeStructureSchema — name required; programmeId, batchId,
//              academicYearId, description, isActive and components optional.
//              Component amounts and tax percentages are bounded to the precision
//              their Decimal columns declare. id, tenantId, createdAt and
//              updatedAt are absent from the schema and so are stripped from any
//              body that supplies them, as are a component's id, feeStructureId
//              and createdAt.
// FLOW       : Authorise → resolve tenant → parse body → run the supplied
//              reference lookups together → apply them in a fixed precedence →
//              create the structure and its components in one statement.
//
//              Each of programmeId, batchId and academicYearId is verified
//              against this tenant when supplied, and skipped entirely when not,
//              since all three columns are nullable. That check is the only
//              protection any of them has: FeeStructure declares no relation for
//              them and the migration emits no foreign key for the model at all —
//              not on these three, and not on tenantId — so every column would
//              otherwise accept any string, including another tenant's id. This
//              is the same situation as Course.departmentId and
//              Assignment.sectionId, and a stronger case than either, because
//              here it applies to three columns at once.
//
//              An unknown id and one owned by another tenant return the identical
//              404 for each reference, so no id is ever confirmed to exist
//              elsewhere. Precedence follows the schema's column order —
//              programme, then batch, then academic year — so a body with several
//              bad references always reports the same one.
//
//              No duplicate check is performed. FeeStructure declares no unique
//              constraint in the schema — not one — so two structures with the
//              same name and scope are permitted, exactly as the database permits
//              them. FeeComponent declares none either, so a structure may carry
//              two components of the same name and type.
//
//              The structure and its components are written by a single nested
//              create. Prisma issues that as one atomic operation, so the
//              components can never exist without their parent and a failure
//              anywhere leaves nothing behind — no separate transaction is
//              needed, and no component is ever written outside it. When no
//              components are supplied the nested clause is omitted entirely and
//              the structure is created alone, which the schema permits.
// RESPONSE   : { success: true, data: <FeeStructure>,
//                message: "Fee structure created" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
//
//              The 409 branch is present but currently unreachable: neither
//              FeeStructure nor FeeComponent declares a unique constraint on any
//              column or combination, so Prisma cannot raise P2002 here. It is
//              mapped only from a real Prisma conflict, never from an application
//              rule, so a genuine constraint violation would surface as a
//              conflict rather than a 500 if the schema ever gains one.
//
//              No foreign-key branch is handled, and none is reachable.
//              FeeStructure has no foreign key on any column, so a programme,
//              batch or academic year deleted between its check and the insert
//              leaves a dangling id rather than raising anything — the same
//              silent outcome as Course.departmentId. The only foreign key
//              involved is FeeComponent.feeStructureId, which points at the row
//              being created in the same statement and therefore cannot dangle.
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

    const parsed = createFeeStructureSchema.safeParse(body);
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

    const { components, ...scalars } = parsed.data;

    // Three independent reads, so they are issued together rather than in
    // sequence. Each is skipped entirely when its column was not supplied, since
    // all three are nullable — a structure scoped to none of them costs no extra
    // reads at all.
    const [programme, batch, academicYear] = await Promise.all([
      scalars.programmeId === undefined
        ? Promise.resolve(null)
        : prisma.programme.findFirst({
            where: { id: scalars.programmeId, tenantId: tenant.id },
            select: { id: true },
          }),
      scalars.batchId === undefined
        ? Promise.resolve(null)
        : prisma.batch.findFirst({
            where: { id: scalars.batchId, tenantId: tenant.id },
            select: { id: true },
          }),
      scalars.academicYearId === undefined
        ? Promise.resolve(null)
        : prisma.academicYear.findFirst({
            where: { id: scalars.academicYearId, tenantId: tenant.id },
            select: { id: true },
          }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first. The order follows the schema's column order.
    if (scalars.programmeId !== undefined && !programme) {
      return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
    }

    if (scalars.batchId !== undefined && !batch) {
      return NextResponse.json(fail("Batch not found", "NOT_FOUND"), { status: 404 });
    }

    if (scalars.academicYearId !== undefined && !academicYear) {
      return NextResponse.json(fail("Academic year not found", "NOT_FOUND"), { status: 404 });
    }

    // A single nested create — atomic on its own, so no explicit transaction is
    // warranted and no component can be written outside it. tenantId comes from
    // the resolved tenant context, never from the request body. The nested clause
    // is omitted when no components were supplied, so an empty array and an
    // absent key both produce a structure with none.
    const feeStructure = await prisma.feeStructure.create({
      data: {
        ...scalars,
        tenantId: tenant.id,
        ...(components && components.length > 0
          ? { components: { create: components } }
          : {}),
      },
      select: FEE_STRUCTURE_SELECT,
    });

    return NextResponse.json(ok(feeStructure, "Fee structure created"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Currently unreachable — neither FeeStructure nor FeeComponent declares a
      // unique constraint — but mapped so a real constraint violation would never
      // surface as a 500.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(fail("Fee structure already exists", "CONFLICT"), { status: 409 });
      }
    }

    console.error("[POST /api/fee-structures]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
