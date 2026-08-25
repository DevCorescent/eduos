// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — One University's Landing Page (W4, PRD §5.1, §7)
// LAYER  : Route
// FLOW   : requirePlatformAdmin() → Zod (params + body) → repository.
// ACCESS : PLATFORM_ADMIN (platform session — W1.2).
// BACKEND: cms.repository — the SAME functions /api/tenant/cms/page uses.
// PURPOSE: Let the platform operator read, edit and publish any university's
//          landing page, as §5.1 onboarding requires.
//
// WHY THE TENANT ID IS A PATH SEGMENT HERE AND NOWHERE ELSE
//   On the tenant route the id comes from the host and a parameter would be a
//   hole. Here the id IS the request: a platform operator legitimately acts on
//   an institution that is not their own, and requirePlatformAdmin — a
//   different session type entirely, backed by PlatformUser — is what makes
//   that a decision rather than a leak.
//
// SAME REPOSITORY, DIFFERENT DOOR
//   Both surfaces call findPage/saveDraft/publish. The publish rule, the
//   version numbering and the draft split therefore cannot diverge between an
//   operator and an administrator editing the same page.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { prisma } from "@/lib/db/prisma";
import { findPage, publish, saveDraft } from "@/lib/repositories/cms.repository";
import { publishCmsPageSchema, saveCmsPageSchema } from "@/lib/validations/cms";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { fail, ok } from "@/types";

const paramsSchema = z.object({ id: z.string().min(1) });

/** Resolve the tenant named by the path, or the 404 to return instead. */
async function resolveTenant(id: string) {
  return prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true } });
}

// GET
// ACCESS   : PLATFORM_ADMIN
// RESPONSE : { success: true, data: { tenant, page } } — page null before first
//            save, which the editor renders as an empty canvas.
// STATUS   : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const SCOPE = "GET /api/platform/tenants/[id]/cms/page";

  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return validationFailure(parsedParams.error);

    const tenant = await resolveTenant(parsedParams.data.id);
    if (!tenant) {
      return NextResponse.json(fail("University not found", "NOT_FOUND"), { status: 404 });
    }

    const page = await findPage(tenant.id);
    return NextResponse.json(ok({ tenant, page }));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

// PUT
// ACCESS     : PLATFORM_ADMIN
// VALIDATION : saveCmsPageSchema, .strict(). Writes the DRAFT only — an
//              operator saving a page they are configuring during onboarding
//              must not put it on the institution's public domain by accident.
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const SCOPE = "PUT /api/platform/tenants/[id]/cms/page";

  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return validationFailure(parsedParams.error);

    const tenant = await resolveTenant(parsedParams.data.id);
    if (!tenant) {
      return NextResponse.json(fail("University not found", "NOT_FOUND"), { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsed = saveCmsPageSchema.safeParse(body);
    if (!parsed.success) return validationFailure(parsed.error);

    const page = await saveDraft(tenant.id, parsed.data, tenant.name);
    return NextResponse.json(ok(page, "Draft saved"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

// POST
// ACCESS     : PLATFORM_ADMIN
// PURPOSE    : Publish that university's draft — the last step of §49.1's
//              onboarding chain, performed by the operator who configured it.
// AUDIT      : Written against the TENANT, with a null actor userId: the actor
//              is a PlatformUser, and AuditLog.userId is a FK to User. Recording
//              a platform operator's id in a tenant-scoped column would be a
//              dangling reference; the action name is what identifies it as a
//              platform-originated publish.
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const SCOPE = "POST /api/platform/tenants/[id]/cms/page";

  try {
    const guard = await requirePlatformAdmin();
    if (!guard.authorized) return guard.response;

    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return validationFailure(parsedParams.error);

    const tenant = await resolveTenant(parsedParams.data.id);
    if (!tenant) {
      return NextResponse.json(fail("University not found", "NOT_FOUND"), { status: 404 });
    }

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

    const page = await publish(tenant.id, null, parsed.data.note ?? "Published by platform");
    if (!page) {
      return NextResponse.json(
        fail("There is no page to publish yet. Save a draft first.", "NOT_FOUND"),
        { status: 404 }
      );
    }

    return NextResponse.json(ok(page, `${tenant.name}'s website is live`));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
