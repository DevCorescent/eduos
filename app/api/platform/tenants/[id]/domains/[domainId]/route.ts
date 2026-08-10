// ============================================================================
// OWNER  : Gauransh
// MODULE : Tenant Domains — one row (WP-3, PRD §5.2)
// ACCESS : PLATFORM_ADMIN only (platform session — W1.2).
// PURPOSE: Change a hostname's status, or remove it.
//
// THE HOSTNAME ITSELF CANNOT BE EDITED
//   updateDomainSchema does not accept `domain`. Renaming a live hostname
//   silently breaks every bookmark, every emailed link and every certificate QR
//   code pointing at it. Adding the new one and retiring the old is the same
//   operation with none of that damage, and it leaves both rows in the trail.
//
// DELETE EXISTS, AND IS THE RIGHT CALL HERE — UNLIKE ELSEWHERE
//   Sequences and audit rows must never be deleted because they carry state
//   that cannot be reconstructed. A domain carries none: it is a pointer. But
//   deleting frees the hostname for another tenant to claim, so `isActive:
//   false` is offered first and the UI leads with it. Both are audited.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { domainParamSchema, updateDomainSchema } from "@/lib/validations/domain";
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

/** Both ids, parsed together so a bad segment answers 400 once. */
async function readParams(params: Promise<{ id: string; domainId: string }>) {
  const raw = await params;
  const tenant = tenantIdParamSchema.safeParse({ id: raw.id });
  const domain = domainParamSchema.safeParse({ id: raw.domainId });
  return tenant.success && domain.success
    ? { tenantId: tenant.data.id, domainId: domain.data.id }
    : null;
}

// PATCH
// ACCESS   : SUPER_ADMIN
// FLOW     : The row is read scoped by BOTH ids, so a domain belonging to a
//            different tenant answers 404 — the same answer an unknown id gets,
//            so the response confirms nothing about another institution.
//
//            Promoting a domain to primary DEMOTES the existing one first,
//            inside the same transaction. Without that the partial unique index
//            rejects the update and the operator sees a conflict for an action
//            that is entirely reasonable.
// RESPONSE : { success: true, data: <domain>, message }
// STATUS   : 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; domainId: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const ids = await readParams(context.params);
    if (!ids) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = updateDomainSchema.safeParse(body);
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

    const existing = await prisma.domain.findFirst({
      where: { id: ids.domainId, tenantId: ids.tenantId },
      select: DOMAIN_SELECT,
    });
    if (!existing) {
      return NextResponse.json(fail("Domain not found", "NOT_FOUND"), { status: 404 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Exactly one canonical domain per tenant. The database enforces it; this
      // makes the reasonable request succeed rather than collide with it.
      if (parsed.data.isPrimary === true && !existing.isPrimary) {
        await tx.domain.updateMany({
          where: { tenantId: ids.tenantId, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      const row = await tx.domain.update({
        where: { id: ids.domainId },
        data: parsed.data,
        select: DOMAIN_SELECT,
      });

      await recordAudit(
        {
          tenantId: ids.tenantId,
          actor: { userId: guard.session.sub, ...readRequestOrigin(request.headers) },
          action: AUDIT_ACTIONS.DOMAIN_UPDATED,
          resource: AUDIT_RESOURCES.DOMAIN,
          resourceId: row.id,
          // Both states, so the trail answers "what changed" rather than only
          // "what it is now" — the question asked after an incident.
          before: {
            verified: existing.verified,
            isPrimary: existing.isPrimary,
            isActive: existing.isActive,
            type: existing.type,
          },
          after: {
            domain: row.domain,
            verified: row.verified,
            isPrimary: row.isPrimary,
            isActive: row.isActive,
            type: row.type,
          },
        },
        tx
      );

      return row;
    });

    return NextResponse.json(ok(updated, "Domain updated"));
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === UNIQUE_VIOLATION
    ) {
      return NextResponse.json(
        fail("This university already has a canonical domain", "CONFLICT"),
        { status: 409 }
      );
    }

    console.error("[PATCH /api/platform/tenants/[id]/domains/[domainId]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// DELETE
// ACCESS   : SUPER_ADMIN
// FLOW     : deleteMany scoped by BOTH ids — a foreign domain deletes zero rows
//            and answers 404 without ever reading another tenant's data.
//            The audit entry is written in the same transaction, and carries the
//            hostname: after the row is gone, the trail is the only record that
//            it existed.
// STATUS   : 200 · 400 · 401 · 403 · 404 · 500
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; domainId: string }> }
) {
  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const ids = await readParams(context.params);
    if (!ids) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const existing = await prisma.domain.findFirst({
      where: { id: ids.domainId, tenantId: ids.tenantId },
      select: DOMAIN_SELECT,
    });
    if (!existing) {
      return NextResponse.json(fail("Domain not found", "NOT_FOUND"), { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.domain.delete({ where: { id: ids.domainId } });

      await recordAudit(
        {
          tenantId: ids.tenantId,
          actor: { userId: guard.session.sub, ...readRequestOrigin(request.headers) },
          action: AUDIT_ACTIONS.DOMAIN_REMOVED,
          resource: AUDIT_RESOURCES.DOMAIN,
          resourceId: existing.id,
          before: {
            domain: existing.domain,
            type: existing.type,
            verified: existing.verified,
            isPrimary: existing.isPrimary,
            isActive: existing.isActive,
          },
        },
        tx
      );
    });

    return NextResponse.json(ok({ id: existing.id }, "Domain removed"));
  } catch (err) {
    console.error("[DELETE /api/platform/tenants/[id]/domains/[domainId]]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
