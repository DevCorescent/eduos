// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — This University's Landing Page (W4, PRD §7.3)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate → repository → response.
// ACCESS : UNIVERSITY_ADMIN. §45 opens "Each university can configure:", so the
//          website belongs to the institution, not to the platform. The
//          platform's own route for the same data lives under
//          /api/platform/tenants/[id]/cms/page and is guarded separately.
// BACKEND: cms.repository → CmsPage.
// PURPOSE: Read and save the draft of this institution's landing page.
//
// NO TENANT ID ANYWHERE IN THE REQUEST
//   The tenant comes from requireTenant, which resolves it from the host and
//   checks it against the session. There is no path segment, query parameter or
//   body field naming a tenant — so there is nothing an administrator of one
//   university could change to edit another's website.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import { findPage, saveDraft } from "@/lib/repositories/cms.repository";
import { saveCmsPageSchema } from "@/lib/validations/cms";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

// GET
// ACCESS   : UNIVERSITY_ADMIN
// RESPONSE : { success: true, data: <page | null> }
//
//            null rather than 404 when no page exists yet. A university that
//            has never opened this screen has no page, and that is an ordinary
//            starting state the editor renders as an empty canvas — not an
//            error it has to handle.
// STATUS   : 200 · 401 · 403 · 500
export async function GET() {
  const SCOPE = "GET /api/tenant/cms/page";

  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, "/api/tenant/cms/page");
    if (!moduleGuard.allowed) return moduleGuard.response;

    const page = await findPage(tenantGuard.tenant.id);
    return NextResponse.json(ok(page));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

// PUT
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : saveCmsPageSchema, .strict(). Every block is parsed against its
//              own schema, so a block that could not render cannot be stored.
// FLOW       : Guard → parse → validate → upsert draft.
//
//              PUT rather than PATCH because the block array is REPLACED. The
//              editor holds the whole page and sends the whole page; a partial
//              update would need the client to express an ordering intent
//              separately, which is more to get wrong than resending fifty
//              items.
//
//              Writes the DRAFT only. Nothing here can change what the public
//              sees — that needs the publish route.
// RESPONSE   : { success: true, data: <page>, message }
// STATUS     : 200 · 400 · 401 · 403 · 500
export async function PUT(request: NextRequest) {
  const SCOPE = "PUT /api/tenant/cms/page";

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

    const parsed = saveCmsPageSchema.safeParse(body);
    if (!parsed.success) return validationFailure(parsed.error);

    const page = await saveDraft(
      tenantGuard.tenant.id,
      parsed.data,
      // The institution's own name, used only when the page row is created and
      // the editor sent no title.
      tenantGuard.tenant.name ?? "Home"
    );

    return NextResponse.json(ok(page, "Draft saved"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
