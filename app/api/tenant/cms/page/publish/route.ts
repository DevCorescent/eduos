// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — Publish (W4, PRD §7.3)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate → repository transaction → audit.
// ACCESS : UNIVERSITY_ADMIN.
// BACKEND: cms.repository.publish → CmsPage + CmsPageVersion, one transaction.
// PURPOSE: Make the saved draft the live page, and record what was published.
//
// A SEPARATE ROUTE FROM SAVING, WHICH IS THE WHOLE POINT
//   Saving writes draftBlocks and can never change what a visitor sees.
//   Publishing copies the draft across. Two verbs on one endpoint would mean
//   one bug — a missing flag, a defaulted parameter — puts unfinished content
//   on a university's public domain.
//
// THE REQUEST CARRIES NO CONTENT
//   Only an optional note. The blocks come from the row, so this route cannot
//   publish anything the institution did not already save and look at.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { publish } from "@/lib/repositories/cms.repository";
import { publishCmsPageSchema } from "@/lib/validations/cms";
import { recordAudit } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { fail, ok } from "@/types";

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : publishCmsPageSchema, .strict() — an optional note only.
// FLOW       : Guard → validate → publish (transaction) → audit.
//
//              The audit entry is written AFTER the transaction and awaited.
//              Publishing is the moment a university's public statement
//              changes, so §47 wants it logged; but a failure to log must not
//              roll back a publish that succeeded, which is the same order the
//              login route uses for the same reason.
// RESPONSE   : { success: true, data: <page>, message }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function POST(request: NextRequest) {
  const SCOPE = "POST /api/tenant/cms/page/publish";

  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    let body: unknown = {};
    if (request.headers.get("content-length") !== "0") {
      try {
        body = await request.json();
      } catch {
        return malformedBody();
      }
    }

    const parsed = publishCmsPageSchema.safeParse(body);
    if (!parsed.success) return validationFailure(parsed.error);

    const page = await publish(
      tenantGuard.tenant.id,
      guard.session.sub,
      parsed.data.note
    );

    if (!page) {
      return NextResponse.json(
        fail("There is no page to publish yet. Save a draft first.", "NOT_FOUND"),
        { status: 404 }
      );
    }

    await recordAudit({
      tenantId: tenantGuard.tenant.id,
      actor: { userId: guard.session.sub, ...readRequestOrigin(request.headers) },
      action: AUDIT_ACTIONS.CMS_PAGE_PUBLISHED,
      resource: AUDIT_RESOURCES.CMS_PAGE,
      resourceId: page.id,
      after: { path: page.path, publishedAt: page.publishedAt },
    });

    return NextResponse.json(ok(page, "Your website is live"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
