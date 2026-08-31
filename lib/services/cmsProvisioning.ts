// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — Starting content for a new university
// LAYER  : Service (data access)
// PURPOSE: Give a newly provisioned university the platform's default landing
//          page, so its Website editor opens on a real site rather than on an
//          empty canvas.
//
// THE BUG THIS EXISTS TO FIX
//   provisionUniversity created a Tenant, a Subscription and an admin — and no
//   CmsPage. The only two writers of CmsPage were the SEED SCRIPT and the
//   editor's own first save, so every university created through the platform
//   UI opened its Website screen on "0 sections". The default-landing template
//   existed the whole time; nothing ever copied it into a tenant.
//
// A COPY, NOT A REFERENCE
//   The blocks are copied into the tenant's own draft rather than read through
//   to the template at render time. A university's page is ITS page: an
//   operator editing the platform template afterwards must not silently rewrite
//   the website of every institution that started from it. This is the model
//   prisma/seedCms.ts already states, and this module follows it exactly.
//
// NO "server-only" MARKER, DELIBERATELY
//   This sits in universityProvisioning.service's import graph, and that module
//   omits the marker so onboarding stays runnable from a script. Adding it here
//   would make the whole provisioning path unimportable outside a request. The
//   module is safe without it: it takes a Prisma client as a PARAMETER and
//   imports nothing but types and a pure parser, so it has no ambient server
//   dependency to protect.
//
// DRAFT ONLY. NOTHING BECOMES PUBLIC.
//   status stays DRAFT and publishedBlocks stays NULL, so provisioning a
//   university does not put a page live at its address. The institution
//   publishes when it has looked at what it is publishing.
// ============================================================================

import type { Prisma } from "@/app/generated/prisma/client";
import { parseStoredBlocks, type CmsBlocks } from "@/lib/domain/cms/blocks";

/** The platform template every new university's page starts as a copy of. */
export const DEFAULT_LANDING_KEY = "default-landing";

/**
 * The blocks a university's website should START as.
 *
 * RETURNS the default template's blocks, or an empty array when there is no
 * template or it holds nothing usable. Empty is a legitimate answer and never
 * an error: a platform that has not authored a template yet must still be able
 * to onboard a university, and the editor's empty canvas remains a valid state.
 *
 * Reads through the caller's transaction client when given one, so the copy is
 * taken inside the same transaction that creates the tenant.
 */
export async function defaultLandingBlocks(
  client: Prisma.TransactionClient
): Promise<CmsBlocks> {
  const template = await client.cmsTemplate.findUnique({
    where: { key: DEFAULT_LANDING_KEY },
    select: { blocks: true },
  });

  // parseStoredBlocks rather than a cast: the column is Json, and a template
  // saved before a schema change could hold a shape the editor cannot render.
  // It answers unparseable content with an empty array, which is savable.
  return parseStoredBlocks(template?.blocks);
}

/**
 * Give one newly created tenant its starting website.
 *
 * INPUT   : the transaction client, the tenant id, and the title to use — the
 *           institution's own name, so the page is not called "Home".
 * RETURNS : nothing. Provisioning must not fail because the CMS could not be
 *           seeded, so a missing template simply means no page is created and
 *           the tenant behaves exactly as tenants did before this existed.
 *
 * ONLY EVER CREATES. This is called from provisioning, where the tenant was
 * made moments earlier and cannot have a page yet — but it uses `create`
 * rather than `upsert` deliberately, so that if it were ever called against a
 * tenant that already has a website, the write would fail loudly rather than
 * quietly overwrite somebody's draft.
 */
export async function provisionDefaultWebsite(
  client: Prisma.TransactionClient,
  tenantId: string,
  title: string
): Promise<void> {
  const blocks = await defaultLandingBlocks(client);

  // Nothing to copy. Leaving the tenant with no page keeps the previous
  // behaviour, and the editor still opens — on an empty canvas, as before.
  if (blocks.length === 0) return;

  await client.cmsPage.create({
    data: {
      tenantId,
      path: "/",
      title,
      status: "DRAFT",
      draftBlocks: blocks as unknown as Prisma.InputJsonValue,
      // Explicitly NOT published. Provisioning a university does not put a
      // website live at its address.
    },
  });
}
