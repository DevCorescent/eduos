// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Default Landing Template (W4, PRD §5.1, §7)
// LAYER  : Route
// FLOW   : requirePlatformAdmin() → Zod → repository.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2). NOT a tenant role: this
//          row belongs to the platform owner and exists before any university
//          does, so requireTenant would have no tenant to resolve.
// BACKEND: cms.repository → CmsTemplate.
// PURPOSE: Edit the starting point that onboarding copies into a new
//          university's website.
//
// EDITING THIS CHANGES NOTHING THAT ALREADY EXISTS
//   Tenants hold COPIES. A university whose landing page was seeded last month
//   is unaffected by a template edit today, and that is the agreed model: a
//   published homepage must never change because somebody edited a platform
//   row. The UI says so, because an operator who believed otherwise would edit
//   here expecting a fleet-wide change and get none.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { findTemplate, saveTemplate } from "@/lib/repositories/cms.repository";
import { saveCmsTemplateSchema } from "@/lib/validations/cms";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

/** The one template this work package defines. Others are a later concern. */
const DEFAULT_KEY = "default-landing";

// GET
// ACCESS   : PLATFORM_ADMIN
// RESPONSE : { success: true, data: <template | null> }
// STATUS   : 200 · 401 · 403 · 500
export async function GET() {
  const SCOPE = "GET /api/platform/cms/template";

  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    return NextResponse.json(ok(await findTemplate(DEFAULT_KEY)));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

// PUT
// ACCESS     : PLATFORM_ADMIN
// VALIDATION : saveCmsTemplateSchema, .strict() — the SAME block schema a page
//              uses, which is what guarantees a template can always be copied
//              into a tenant page without a second validation disagreeing.
// FLOW       : Guard → parse → validate → upsert.
// RESPONSE   : { success: true, data: <template>, message }
// STATUS     : 200 · 400 · 401 · 403 · 500
export async function PUT(request: NextRequest) {
  const SCOPE = "PUT /api/platform/cms/template";

  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsed = saveCmsTemplateSchema.safeParse(body);
    if (!parsed.success) return validationFailure(parsed.error);

    const template = await saveTemplate(DEFAULT_KEY, parsed.data, guard.platformUserId);

    return NextResponse.json(
      ok(template, "Template saved. Existing universities are unaffected.")
    );
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
