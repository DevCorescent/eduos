// ============================================================================
// OWNER  : Gauransh
// MODULE : Tenant Domains (WP-3, PRD §5.2)
// FLOW   : Guard → params → tenant exists → validate → write + audit → response.
// ACCESS : PLATFORM_ADMIN only (platform session — W1.2).
// BACKEND: Prisma
// PURPOSE: List and add the hostnames one university is served on.
//
// WHY SUPER_ADMIN AND NOT THE UNIVERSITY
//   PRD §2.1 lists "Domain configuration" among the things the platform owner
//   controls, and §5.2 places domain management inside the Super Admin panel.
//   That is also the only reading that is operationally safe: a hostname is a
//   platform-wide resource — Domain.domain is globally unique — so one
//   university claiming a hostname denies it to every other. Branding, which
//   §45 gives to each university, is a separate endpoint with a different
//   guard.
//
//   requireTenant is deliberately NOT used. Platform routes act ACROSS tenants
//   by design and take their subject from the [id] segment, which is verified
//   to exist before anything is written.
//
// DNS VERIFICATION IS NOT IMPLEMENTED, AND THE FLAG SAYS SO HONESTLY
//   PRD §5.2 asks for "Automated DNS verification" but names no mechanism, no
//   token format, no schedule — and this stack has no worker to poll with.
//   `verified` is therefore set by the operator here, and an unverified domain
//   does not resolve. Recorded as a pending requirement rather than guessed at;
//   whichever mechanism is chosen later needs no schema change.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { createDomainSchema } from "@/lib/validations/domain";
import { tenantIdParamSchema } from "@/lib/validations/platform";
import { recordAudit } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

const UNIQUE_VIOLATION = "P2002";

const DOMAIN_SELECT = {
  id: true,
  tenantId: true,
  domain: true,
  type: true,
  verified: true,
  isPrimary: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

// GET
// ACCESS   : SUPER_ADMIN
// RESPONSE : { success: true, data: { domains } }
//            Unpaginated — a university has a handful of hostnames, and a
//            pagination envelope over four rows is a contract to maintain for
//            no benefit.
// STATUS   : 200 · 401 · 403 · 404 · 500
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsed = tenantIdParamSchema.safeParse(await context.params);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const domains = await prisma.domain.findMany({
      where: { tenantId: parsed.data.id },
      select: DOMAIN_SELECT,
      // Primary first, then oldest — the canonical hostname is what an operator
      // is looking for, and it should not move as others are added.
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });

    return NextResponse.json(ok({ domains }));
  } catch (err) {
    console.error("[GET /api/platform/tenants/[id]/domains]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : PLATFORM_ADMIN (platform session — W1.2)
// VALIDATION : createDomainSchema — the hostname is NORMALISED by the schema,
//              so it is stored exactly as resolution will look it up. Storing
//              the raw value would produce a domain that looks configured and
//              never resolves, and the unique index would miss the duplicate.
// FLOW       : The tenant is confirmed to exist first, so a bad [id] answers
//              404 rather than a foreign-key error surfacing as a 500.
//              The insert and its audit entry share one transaction.
// RESPONSE   : { success: true, data: <domain>, message }
// STATUS     : 201 · 400 · 401 · 403 · 404 · 409 · 500
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsedParam = tenantIdParamSchema.safeParse(await context.params);
    if (!parsedParam.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = createDomainSchema.safeParse(body);
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

    const tenant = await prisma.tenant.findUnique({
      where: { id: parsedParam.data.id },
      select: { id: true },
    });
    if (!tenant) {
      return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
    }

    const domain = await prisma.$transaction(async (tx) => {
      const created = await tx.domain.create({
        data: { ...parsed.data, tenantId: tenant.id },
        select: DOMAIN_SELECT,
      });

      await recordAudit(
        {
          tenantId: tenant.id,
          actor: { userId: guard.session.sub, ...readRequestOrigin(request.headers) },
          action: AUDIT_ACTIONS.DOMAIN_ADDED,
          resource: AUDIT_RESOURCES.DOMAIN,
          resourceId: created.id,
          after: {
            domain: created.domain,
            type: created.type,
            verified: created.verified,
            isPrimary: created.isPrimary,
            isActive: created.isActive,
          },
        },
        tx
      );

      return created;
    });

    return NextResponse.json(ok(domain, "Domain added"), { status: 201 });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === UNIQUE_VIOLATION
    ) {
      // Two constraints can produce this, and the message must not confirm
      // which — "already in use" would tell a caller that another institution
      // holds a hostname they were probing for.
      //
      //   Domain_domain_key         — the hostname is taken, possibly by
      //                               another tenant
      //   Domain_tenantId_primary_key — this tenant already has a canonical
      //                               domain
      const target = String(err.meta?.target ?? "");
      return NextResponse.json(
        target.includes("primary")
          ? fail("This university already has a canonical domain", "CONFLICT")
          : fail("That hostname is not available", "CONFLICT"),
        { status: 409 }
      );
    }

    console.error("[POST /api/platform/tenants/[id]/domains]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
