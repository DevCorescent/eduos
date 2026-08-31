// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Tenant Listing / Create Tenant
// FLOW   : requireRole("SUPER_ADMIN") authorises the caller → the request is
//          validated by Zod → GET returns one transactional page + count,
//          POST checks slug uniqueness and creates the Tenant → both reply in
//          the existing ok() / fail() envelope.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2)
// BACKEND: Reads and writes ONLY the existing Tenant model via lib/db/prisma.
//          No User, Role, Domain or Subscription is touched. No schema change.
// PURPOSE: Back the platform tenant directory and university onboarding
//          listed in README Phase 2.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { provisionTenantSchema, listTenantsQuerySchema } from "@/lib/validations/platform";
import {
  logProvisioningEvent,
  provisionUniversity,
} from "@/lib/services/universityProvisioning.service";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

// GET
// ACCESS     : PLATFORM_ADMIN (platform session — W1.2)
// VALIDATION : listTenantsQuerySchema — ?page (default 1) and ?limit
//              (default 20, max 100), both coerced from search params, plus the
//              three filters the directory's controls send: ?q over name and
//              slug, ?status and ?type. Each is optional, and an empty value
//              means "no filter" rather than an invalid enum member.
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
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsed = listTenantsQuerySchema.safeParse(
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

    const { page, limit, q, status, type } = parsed.data;

    // `mode: "insensitive"` is what makes "AKTU", "Aktu" and "aktu" one search;
    // `contains` is what makes "tech" match "Technical University" rather than
    // only a name equal to it. The same shape GET /api/campuses and
    // GET /api/programmes already use, so the collections behave identically.
    //
    // An omitted status or type contributes NOTHING to the predicate, which is
    // exactly what "All statuses" and "All types" mean — the controls remove
    // their key from the URL, the schema turns an empty one into undefined, and
    // the spread below then adds no restriction at all.
    //
    // This is a PLATFORM collection: it deliberately spans every institution,
    // so there is no tenant predicate here and none is implied. requirePlatformAdmin
    // above is what makes that safe.
    const where: Prisma.TenantWhereInput = {
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { slug: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
    };

    // Paired in one transaction so the total cannot shift between the two
    // reads and leave the page metadata inconsistent with the rows returned.
    // The explicit ordering is required for correctness, not presentation:
    // offset pagination over an unordered result can repeat or skip rows.
    //
    // The SAME `where` on both: a count taken over a wider predicate than the
    // page would report a total the list cannot fill, and pagination would then
    // offer pages that come back empty.
    const [tenants, total] = await prisma.$transaction([
      prisma.tenant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.tenant.count({ where }),
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
  }
   catch (err) {
    console.error("[GET /api/platform/tenants]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST — university provisioning (W1.4)
// ACCESS     : PLATFORM_ADMIN (platform session — W1.2). This guard is the ONLY
//              actor check: a tenant session, whatever roles it claims, never
//              reaches this handler. Requirement "Super Admin must be the only
//              actor allowed to provision a university" is that guard, not a
//              role-name comparison.
// VALIDATION : provisionTenantSchema — slug and name required, every other
//              Tenant scalar optional, plus `status` (so a university can be
//              onboarded directly as ACTIVE) and an OPTIONAL `admin` block.
// FLOW       : Authorise → parse body → validate → the provisioning service
//              creates Tenant + Subscription + (Role, User, UserRole) in ONE
//              transaction → return the tenant, the administrator and the
//              administrator's one-time password.
//
//              Tenant.slug is the only tenant-level uniqueness the schema
//              exposes: Tenant has no separate code column — the slug IS the
//              university code — and no Domain row is written here.
//
// RESPONSE   : { success: true, data: { tenant, admin, temporaryPassword },
//                message } — `admin` and `temporaryPassword` are null when no
//              administrator was requested.
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 409 CONFLICT · 500 SERVER_ERROR
//
// THE ADMINISTRATOR'S PASSWORD IS IN THIS RESPONSE ONCE, AND NOWHERE ELSE
//   Same contract as W1.3: no mail transport exists, only the bcrypt hash is
//   stored, and the account is created with mustChangePassword so the credential
//   buys exactly one sign-in before its owner must replace it.
export async function POST(request: NextRequest) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = provisionTenantSchema.safeParse(body);
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

    const result = await provisionUniversity(parsed.data);

    if (!result.ok) {
      // SLUG_TAKEN is the only failure this path can produce: the tenant is new,
      // so its administrator's address cannot clash with an existing user.
      return NextResponse.json(fail("Tenant slug already in use", "CONFLICT"), { status: 409 });
    }

    const { tenant, admin, temporaryPassword } = result.value;

    logProvisioningEvent("university-provisioned", guard.platformUserId, tenant.id, admin?.id);

    return NextResponse.json(
      ok(
        { tenant, admin, temporaryPassword },
        admin ? "University and administrator provisioned" : "Tenant created"
      ),
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/platform/tenants]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
