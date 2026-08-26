// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — Header, Footer and Contact (W4b, PRD §7.1)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate → repository → audit.
// ACCESS : UNIVERSITY_ADMIN.
// BACKEND: cms.repository → CmsSite.
// PURPOSE: Read and save the navigation bar, footer columns, social links and
//          contact details that wrap every page of this institution's site.
//
// NO DRAFT HERE, UNLIKE A PAGE
//   A menu is navigation rather than content. Staging it would mean a published
//   page could link through a menu nobody approved, and the branding screen —
//   the closest existing analogue — likewise goes live on save. The trade is
//   deliberate and recorded in the repository.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { findSite, saveSite } from "@/lib/repositories/cms.repository";
import { saveCmsSiteSchema } from "@/lib/validations/cms";
import { recordAudit } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

// GET
// ACCESS   : UNIVERSITY_ADMIN
// RESPONSE : { success: true, data: <site | null> } — null before first save.
// STATUS   : 200 · 401 · 403 · 500
export async function GET() {
  const SCOPE = "GET /api/tenant/cms/site";

  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, "/api/tenant/cms/site");
    if (!moduleGuard.allowed) return moduleGuard.response;

    return NextResponse.json(ok(await findSite(tenantGuard.tenant.id)));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

// PUT
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : saveCmsSiteSchema, .strict(). Every href must be a relative
//              path, https or mailto — the menu is rendered on the anonymous
//              public site, so an unvalidated link is a stored-XSS vector.
// FLOW       : Guard → parse → validate → upsert → audit.
// RESPONSE   : { success: true, data: <site>, message }
// STATUS     : 200 · 400 · 401 · 403 · 500
export async function PUT(request: NextRequest) {
  const SCOPE = "PUT /api/tenant/cms/site";

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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsed = saveCmsSiteSchema.safeParse(body);
    if (!parsed.success) return validationFailure(parsed.error);

    const site = await saveSite(tenantGuard.tenant.id, parsed.data);

    await recordAudit({
      tenantId: tenantGuard.tenant.id,
      actor: { userId: guard.session.sub, ...readRequestOrigin(request.headers) },
      action: AUDIT_ACTIONS.CMS_SITE_UPDATED,
      resource: AUDIT_RESOURCES.CMS_SITE,
      after: { navItemCount: parsed.data.navItems.length },
    });

    return NextResponse.json(ok(site, "Navigation and footer updated"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
