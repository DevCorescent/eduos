// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Tenant Listing / Create Tenant
// FLOW   : requireRole("SUPER_ADMIN") authorises the caller → the request is
//          validated by Zod → GET returns one transactional page + count,
//          POST checks slug uniqueness and creates the Tenant → both reply in
//          the existing ok() / fail() envelope.
// ACCESS : SUPER_ADMIN
// BACKEND: Reads and writes ONLY the existing Tenant model via lib/db/prisma.
//          No User, Role, Domain or Subscription is touched. No schema change.
// PURPOSE: Back the platform tenant directory and university onboarding
//          listed in README Phase 2.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { createTenantSchema, listTenantsQuerySchema } from "@/lib/validations/platform";
import { ok, fail } from "@/types";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

// GET
// ACCESS     : SUPER_ADMIN
// VALIDATION : listTenantsQuerySchema — ?page (default 1) and ?limit
//              (default 20, max 100), both coerced from search params.
// FLOW       : Authorise → validate query → read one page of tenants alongside
//              the total count in a single transaction → return both.
//              requireTenant is deliberately NOT used: platform routes are
//              served from the root domain, where tenant resolution yields no
//              tenant by design.
// RESPONSE   : { success: true, data: { tenants, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("SUPER_ADMIN");
    if (!guard.authorized) return guard.response;

    const parsed = listTenantsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const { page, limit } = parsed.data;

    // Paired in one transaction so the total cannot shift between the two
    // reads and leave the page metadata inconsistent with the rows returned.
    // The explicit ordering is required for correctness, not presentation:
    // offset pagination over an unordered result can repeat or skip rows.
    const [tenants, total] = await prisma.$transaction([
      prisma.tenant.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.tenant.count(),
    ]);

    return NextResponse.json(
      ok({
        tenants,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/platform/tenants]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : SUPER_ADMIN
// VALIDATION : createTenantSchema — slug and name required, every other Tenant
//              scalar optional. status is not accepted; the schema default
//              (TRIAL) applies and PATCH owns status changes.
// FLOW       : Authorise → parse body → validate → reject a slug already in
//              use → create the Tenant → return the created record.
//              Tenant.slug is the only uniqueness the schema exposes here:
//              Tenant has no code column, and Domain rows are out of scope, so
//              neither can collide.
// RESPONSE   : { success: true, data: <Tenant>, message: "Tenant created" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 409 CONFLICT · 500 SERVER_ERROR
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("SUPER_ADMIN");
    if (!guard.authorized) return guard.response;

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = createTenantSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const { address, settings, ...scalars } = parsed.data;

    const existing = await prisma.tenant.findUnique({
      where: { slug: scalars.slug },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(fail("Tenant slug already in use", "CONFLICT"), { status: 409 });
    }

    // Single write — already atomic, so no transaction is warranted. The JSON
    // columns are cast at this boundary because Zod infers unknown-valued
    // records, which Prisma's InputJsonValue does not accept directly. Omitted
    // keys stay undefined so the column default applies instead of a null.
    const tenant = await prisma.tenant.create({
      data: {
        ...scalars,
        address: address as Prisma.InputJsonValue | undefined,
        settings: settings as Prisma.InputJsonValue | undefined,
      },
    });

    return NextResponse.json(ok(tenant, "Tenant created"), { status: 201 });
  } catch (err) {
    // The uniqueness pre-check above narrows the common case; this covers the
    // race where a concurrent request inserted the same slug in between.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
      return NextResponse.json(fail("Tenant slug already in use", "CONFLICT"), { status: 409 });
    }

    console.error("[POST /api/platform/tenants]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
