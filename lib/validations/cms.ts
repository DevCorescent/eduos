// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — Request Validation (W4, PRD §7.3)
// FLOW   : Validates every CMS write before it reaches a route.
// ACCESS : Not decided here. requireRole and requirePlatformAdmin do that; this
//          module never inspects a caller.
// BACKEND: CmsPage, CmsSite, CmsTemplate.
// PURPOSE: Keep the block array and the site chrome from ever being stored in a
//          shape the public renderer cannot handle.
//
// THE SCHEMAS ARE REUSED, NOT REDECLARED
//   blocksSchema and the CmsSite schemas live in lib/domain/cms, because the
//   RENDERER needs them too. Redeclaring request shapes here would create two
//   definitions of a block that could drift, and the drift would only show up
//   as a broken public homepage.
// ============================================================================

import { z } from "zod";
import { blocksSchema } from "@/lib/domain/cms/blocks";
import {
  footerColumnsSchema,
  navItemsSchema,
  socialLinksSchema,
} from "@/lib/domain/cms/site";

/** A page title or SEO string. Bounded; empty means "clear this field". */
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

/**
 * Save the draft of a page.
 *
 * `blocks` is required and replaces the array wholesale. There is no per-block
 * patch endpoint: the editor holds the whole page in state, and a partial
 * update API would need the client to send an ordering intent alongside its
 * change, which is more moving parts than replacing an array of at most fifty
 * items is worth.
 */
export const saveCmsPageSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    blocks: blocksSchema,
    seoTitle: optionalText(200),
    seoDescription: optionalText(400),
    ogImageUrl: optionalText(2048),
  })
  .strict();

export type SaveCmsPageInput = z.infer<typeof saveCmsPageSchema>;

/**
 * Publish what is currently in the draft.
 *
 * CARRIES NO BLOCKS, DELIBERATELY. Publishing takes whatever the draft holds
 * server-side, so a client cannot publish content it never saved — which is the
 * difference between "publish what I am looking at" and "publish whatever this
 * request happens to contain".
 */
export const publishCmsPageSchema = z
  .object({ note: z.string().trim().max(300).optional() })
  .strict();

export type PublishCmsPageInput = z.infer<typeof publishCmsPageSchema>;

/** Take a published page offline without deleting it. */
export const unpublishCmsPageSchema = z.object({}).strict();

/** Save the header, footer and contact details. */
export const saveCmsSiteSchema = z
  .object({
    navItems: navItemsSchema,
    footerColumns: footerColumnsSchema,
    socialLinks: socialLinksSchema,
    contactAddress: optionalText(300),
    contactPhone: optionalText(40),
    contactEmail: optionalText(200),
  })
  .strict();

export type SaveCmsSiteInput = z.infer<typeof saveCmsSiteSchema>;

/**
 * Save the platform-owned template.
 *
 * Same block schema as a page, because a template IS a page body with no
 * tenant. Sharing the schema is what guarantees a template can always be copied
 * into a page without a second validation pass disagreeing.
 */
export const saveCmsTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: optionalText(400),
    blocks: blocksSchema,
  })
  .strict();

export type SaveCmsTemplateInput = z.infer<typeof saveCmsTemplateSchema>;

/**
 * Copy the platform template into a tenant's page.
 *
 * `confirmOverwrite` is required to be `true` when the tenant already has a
 * page. A template copy REPLACES a draft an institution may have been working
 * on, and a destructive default is how somebody loses an afternoon's editing to
 * a mis-click.
 */
export const applyTemplateSchema = z
  .object({ confirmOverwrite: z.literal(true).optional() })
  .strict();
