// ============================================================================
// OWNER  : Gauransh
// MODULE : Tenant Branding (WP-3, PRD §45)
// FLOW   : Guard → tenant → validate → write + audit → response.
// ACCESS : UNIVERSITY_ADMIN, and only for their own institution.
// BACKEND: Prisma
// PURPOSE: Read and change this university's logo, favicon and brand colours.
//
// WHY THIS GUARD DIFFERS FROM THE DOMAIN ROUTES
//   PRD §45 opens "Each university can configure:" and lists logo, favicon and
//   brand colours — so branding belongs to the institution. Domains do not:
//   §2.1 lists "Domain configuration" among the platform owner's controls, and
//   a hostname is globally unique, so one university claiming one denies it to
//   everyone else. Different ownership, different guard, different endpoint.
//
//   The tenant comes from requireTenant, never from the body or the URL, so
//   there is no parameter a caller could change to reach another institution's
//   branding. The route has no tenant id in its path at all.
//
// EVERY STORED VALUE IS ALREADY SAFE TO RENDER
//   updateBrandingSchema validates with the SAME predicates the layout uses —
//   hex-only colours, https-or-relative asset URLs. Nothing can be stored that
//   the renderer would later silently drop, and nothing can be stored that
//   escapes the <style> block those colours are interpolated into.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { updateBrandingSchema } from "@/lib/validations/domain";
import { recordAudit } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

const BRANDING_SELECT = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  faviconUrl: true,
  primaryColor: true,
  accentColor: true,
} as const;

// GET
// ACCESS   : UNIVERSITY_ADMIN
// RESPONSE : { success: true, data: <branding> }
// STATUS   : 200 · 401 · 403 · 404 · 500
export async function GET() {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const branding = await prisma.tenant.findUnique({
      where: { id: tenantGuard.tenant.id },
      select: BRANDING_SELECT,
    });

    if (!branding) {
      return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(ok(branding));
  } catch (err) {
    console.error("[GET /api/tenant/branding]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// PATCH
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : updateBrandingSchema — strict, at least one field, colours must
//              be hex and asset URLs https or same-origin. `null` clears a
//              field, which is how a university returns to the product's own
//              design system; that is different from omitting the key, which
//              leaves it unchanged.
// FLOW       : The update and its audit entry share one transaction, so a
//              branding change cannot be recorded without having happened.
// RESPONSE   : { success: true, data: <branding>, message }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function PATCH(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = updateBrandingSchema.safeParse(body);
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

    const before = await prisma.tenant.findUnique({
      where: { id: tenantGuard.tenant.id },
      select: BRANDING_SELECT,
    });
    if (!before) {
      return NextResponse.json(fail("Tenant not found", "NOT_FOUND"), { status: 404 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.tenant.update({
        where: { id: tenantGuard.tenant.id },
        data: parsed.data,
        select: BRANDING_SELECT,
      });

      await recordAudit(
        {
          tenantId: tenantGuard.tenant.id,
          actor: { userId: guard.session.sub, ...readRequestOrigin(request.headers) },
          action: AUDIT_ACTIONS.BRANDING_UPDATED,
          resource: AUDIT_RESOURCES.TENANT,
          resourceId: row.id,
          // Both states. Branding is what every student and parent sees, so
          // "what did it look like before" is the first question after an
          // unexpected change.
          before: {
            logoUrl: before.logoUrl,
            faviconUrl: before.faviconUrl,
            primaryColor: before.primaryColor,
            accentColor: before.accentColor,
          },
          after: {
            logoUrl: row.logoUrl,
            faviconUrl: row.faviconUrl,
            primaryColor: row.primaryColor,
            accentColor: row.accentColor,
          },
        },
        tx
      );

      return row;
    });

    return NextResponse.json(ok(updated, "Branding updated"));
  } catch (err) {
    console.error("[PATCH /api/tenant/branding]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
