// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Campus Management
// FLOW   : requireRole authorises the caller, requireTenant resolves and
//          validates the active tenant, then GET returns one page of that
//          tenant's campuses and POST creates a new one under it.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Reads and writes ONLY the existing Campus model via lib/db/prisma,
//          always filtered by the tenant resolved from the request. No schema
//          change, no related model touched.
// PURPOSE: Back the campus level of the institutional hierarchy, the root of
//          Campus -> School -> Department -> Programme in README Phase 3.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { createCampusSchema, listCampusesQuerySchema } from "@/lib/validations/campus";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

// Campus holds no BigInt or Decimal column — only strings, a boolean, a Json
// field and timestamps — so the shared serialize() helper is not applied here.
// The schema is immutable, so that cannot change beneath this route.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : listCampusesQuerySchema — ?page (default 1) and ?limit
//              (default 20, max 100), from the shared pagination contract.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              campuses alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable.
// RESPONSE   : { success: true, data: { campuses, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = listCampusesQuerySchema.safeParse(
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

    const { page, limit, q } = parsed.data;

    // The tenant predicate is never optional and never overridable: it comes
    // from requireTenant, and the search is composed INSIDE it. So ?q can only
    // ever remove rows from an already tenant-scoped set — there is no value of
    // q that reaches another institution's campuses.
    //
    // `mode: "insensitive"` is what makes "DELHI", "Delhi" and "delhi" one
    // search; `contains` is what makes "delhi" match "New Delhi Campus" rather
    // than only a name equal to it.
    const where: Prisma.CampusWhereInput = {
      tenantId: tenant.id,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { code: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    // Paired in one transaction so the total cannot shift between the two
    // reads. The explicit ordering is required for correctness, not
    // presentation: offset pagination over an unordered result can repeat or
    // skip rows.
    //
    // The SAME `where` on both: a count taken over a wider predicate than the
    // page would report a total the list cannot fill, and pagination would
    // offer pages that come back empty.
    const [campuses, total] = await prisma.$transaction([
      prisma.campus.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.campus.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        campuses,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/campuses]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createCampusSchema — name and code required, the rest optional.
//              tenantId is never accepted from the client.
// FLOW       : Authorise → resolve tenant → parse body → reject a code already
//              used within this tenant → create the campus under the resolved
//              tenant. Campus.code is unique per tenant via
//              @@unique([tenantId, code]), so the same code may legitimately
//              exist under a different tenant.
// RESPONSE   : { success: true, data: <Campus>, message: "Campus created" }
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

    const parsed = createCampusSchema.safeParse(body);
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

    const { address, ...scalars } = parsed.data;

    const existing = await prisma.campus.findUnique({
      where: { tenantId_code: { tenantId: tenant.id, code: scalars.code } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(fail("Campus code already in use", "CONFLICT"), { status: 409 });
    }

    // Single write — already atomic, so no transaction is warranted. The JSON
    // column is cast at this boundary because Zod infers an unknown-valued
    // record, which Prisma's InputJsonValue does not accept directly.
    const campus = await prisma.campus.create({
      data: {
        ...scalars,
        tenantId: tenant.id,
        address: address as Prisma.InputJsonValue | undefined,
      },
    });

    return NextResponse.json(ok(campus, "Campus created"), { status: 201 });
  } catch (err) {
    // The uniqueness pre-check above narrows the common case; this covers the
    // race where a concurrent request inserted the same code in between.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
      return NextResponse.json(fail("Campus code already in use", "CONFLICT"), { status: 409 });
    }

    console.error("[POST /api/campuses]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
