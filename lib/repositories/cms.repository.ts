import "server-only";

// ============================================================================
// OWNER  : Gauransh
// MODULE : Website CMS — Repository (W4, PRD §7)
// LAYER  : Repository
// PURPOSE: Every CMS read and write, in one place, with tenantId always a
//          parameter rather than an assumption.
//
// WHY BOTH EDITORS SHARE THIS
//   A university admin edits their own page; a platform operator edits any
//   tenant's. Those are two different AUTHORIZATION decisions and exactly the
//   same DATA operation. Giving them one repository means the publish rule, the
//   version numbering and the draft/published split cannot diverge between the
//   two surfaces — which they would, eventually, if each route wrote its own.
//
//   The authorization difference stays where it belongs: in the guards on the
//   routes. Nothing in this file decides who may call it.
// ============================================================================

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type {
  SaveCmsPageInput,
  SaveCmsSiteInput,
  SaveCmsTemplateInput,
} from "@/lib/validations/cms";

/** The landing page every tenant gets. Other paths are a later work package. */
export const LANDING_PATH = "/";

const PAGE_SELECT = {
  id: true,
  path: true,
  title: true,
  status: true,
  draftBlocks: true,
  publishedBlocks: true,
  publishedAt: true,
  seoTitle: true,
  seoDescription: true,
  ogImageUrl: true,
  updatedAt: true,
} as const;

/** One tenant's landing page as an editor needs it, or null when none exists. */
export async function findPage(tenantId: string) {
  return prisma.cmsPage.findUnique({
    where: { tenantId_path: { tenantId, path: LANDING_PATH } },
    select: PAGE_SELECT,
  });
}

/**
 * Create the page if absent, then write the draft.
 *
 * AN UPSERT RATHER THAN A SEPARATE "CREATE PAGE" STEP
 *   A university's first visit to the editor should not require them to press
 *   "create page" before they can type. The row appears the first time they
 *   save, as a DRAFT — so nothing is public until they publish, and the editor
 *   has no empty state that needs its own button.
 */
export async function saveDraft(
  tenantId: string,
  input: SaveCmsPageInput,
  fallbackTitle: string
) {
  const { blocks, title, ...seo } = input;

  return prisma.cmsPage.upsert({
    where: { tenantId_path: { tenantId, path: LANDING_PATH } },
    update: {
      draftBlocks: blocks,
      ...(title !== undefined ? { title } : {}),
      ...seo,
    },
    create: {
      tenantId,
      path: LANDING_PATH,
      title: title ?? fallbackTitle,
      status: "DRAFT",
      draftBlocks: blocks,
      ...seo,
    },
    select: PAGE_SELECT,
  });
}

/**
 * Copy the draft to published, and record a version.
 *
 * ONE TRANSACTION, AND THE VERSION NUMBER IS COMPUTED INSIDE IT
 *   Two operators publishing at the same instant would otherwise both read
 *   "last version was 4" and both write 5, and the unique constraint on
 *   (pageId, versionNo) would reject the loser — after its page update had
 *   already committed. Inside the transaction the count and the insert are one
 *   atomic step, so a concurrent publish either wins cleanly or retries.
 *
 * RETURNS null when the page does not exist. Publishing a page nobody has
 * drafted is a 404 at the route, not an empty page going live.
 */
export async function publish(
  tenantId: string,
  publishedById: string | null,
  note?: string
) {
  return prisma.$transaction(async (tx) => {
    const page = await tx.cmsPage.findUnique({
      where: { tenantId_path: { tenantId, path: LANDING_PATH } },
      select: { id: true, draftBlocks: true },
    });

    if (!page) return null;

    const previous = await tx.cmsPageVersion.count({ where: { pageId: page.id } });

    await tx.cmsPageVersion.create({
      data: {
        pageId: page.id,
        tenantId,
        versionNo: previous + 1,
        blocks: page.draftBlocks as object,
        note,
        createdById: publishedById,
      },
    });

    return tx.cmsPage.update({
      where: { id: page.id },
      data: {
        // The draft becomes the published copy. Read from the row rather than
        // from the request, so publishing can only ever ship what was saved.
        publishedBlocks: page.draftBlocks as object,
        status: "PUBLISHED",
        publishedAt: new Date(),
        publishedById,
      },
      select: PAGE_SELECT,
    });
  });
}

/**
 * Take a page offline.
 *
 * ARCHIVED rather than deleting publishedBlocks: the institution may want it
 * back, and "what did our site say before we took it down" is a question the
 * version history should still be able to answer.
 */
export async function unpublish(tenantId: string) {
  const page = await findPage(tenantId);
  if (!page) return null;

  return prisma.cmsPage.update({
    where: { id: page.id },
    data: { status: "ARCHIVED" },
    select: PAGE_SELECT,
  });
}

/** Published history, newest first. */
export async function listVersions(tenantId: string, limit = 20) {
  return prisma.cmsPageVersion.findMany({
    where: { tenantId },
    select: {
      id: true,
      versionNo: true,
      note: true,
      createdAt: true,
      createdBy: { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: { versionNo: "desc" },
    take: limit,
  });
}

/**
 * Restore a version into the DRAFT, never straight to live.
 *
 * A rollback that published itself would be an unreviewed publish — the
 * operator would not have seen what they restored. This loads it into the
 * editor and leaves the decision to publish where every other content change
 * leaves it.
 */
export async function restoreVersion(tenantId: string, versionId: string) {
  const version = await prisma.cmsPageVersion.findFirst({
    // tenantId in the WHERE, not just the id: a version id from another
    // institution must not be restorable into this one.
    where: { id: versionId, tenantId },
    select: { blocks: true, page: { select: { id: true } } },
  });

  if (!version) return null;

  return prisma.cmsPage.update({
    where: { id: version.page.id },
    data: { draftBlocks: version.blocks as object },
    select: PAGE_SELECT,
  });
}

// --- Site chrome ------------------------------------------------------------

const SITE_SELECT = {
  navItems: true,
  footerColumns: true,
  socialLinks: true,
  enquireRail: true,
  contactAddress: true,
  contactPhone: true,
  contactEmail: true,
  typography: true,
  updatedAt: true,
} as const;

export async function findSite(tenantId: string) {
  return prisma.cmsSite.findUnique({ where: { tenantId }, select: SITE_SELECT });
}

/**
 * Save the header and footer.
 *
 * No draft/published split here, unlike a page. A menu is navigation rather
 * than content: it is short, it is edited rarely, and staging it would mean a
 * published page could link through a menu nobody had approved. Changes go
 * live on save, which is also how the branding screen behaves.
 */
export async function saveSite(tenantId: string, input: SaveCmsSiteInput) {
  const { typography, ...rest } = input;

  // `typography: null` clears the column; `undefined` leaves it alone. Prisma
  // treats an explicit `null` on a nullable Json field as SQL NULL only when it
  // is passed as such, and omitting the key is how "don't touch this" is
  // expressed — so the two cases are separated here rather than spread blindly.
  const typographyWrite = typography === undefined ? {} : { typography: typography ?? Prisma.DbNull };

  return prisma.cmsSite.upsert({
    where: { tenantId },
    update: { ...rest, ...typographyWrite },
    create: { tenantId, ...rest, ...typographyWrite },
    select: SITE_SELECT,
  });
}

// --- Platform template ------------------------------------------------------

const TEMPLATE_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  blocks: true,
  navItems: true,
  footerColumns: true,
  socialLinks: true,
  enquireRail: true,
  typography: true,
  updatedAt: true,
} as const;

export async function findTemplate(key: string) {
  return prisma.cmsTemplate.findUnique({ where: { key }, select: TEMPLATE_SELECT });
}

/**
 * Write the template, touching ONLY the fields the caller supplied.
 *
 * The template is edited from two screens — sections on one, navigation and
 * typography on the other — so a save from either must leave the other's work
 * alone. Spreading the input wholesale would write `undefined` over a column
 * Prisma then leaves alone anyway, which happens to be correct; building the
 * update explicitly says so on purpose rather than by luck.
 */
export async function saveTemplate(
  key: string,
  input: SaveCmsTemplateInput,
  updatedById: string | null
) {
  const write = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.blocks !== undefined ? { blocks: input.blocks } : {}),
    ...(input.navItems !== undefined ? { navItems: input.navItems } : {}),
    ...(input.footerColumns !== undefined ? { footerColumns: input.footerColumns } : {}),
    ...(input.socialLinks !== undefined ? { socialLinks: input.socialLinks } : {}),
    ...(input.enquireRail !== undefined ? { enquireRail: input.enquireRail } : {}),
    ...(input.typography !== undefined
      ? { typography: input.typography ?? Prisma.DbNull }
      : {}),
  };

  return prisma.cmsTemplate.upsert({
    where: { key },
    update: { ...write, updatedById },
    create: {
      key,
      name: input.name ?? key,
      description: input.description ?? null,
      // A template created by a chrome-only save has no sections yet. An empty
      // array is valid content — see blocksSchema — so this is a real starting
      // state and not a placeholder that has to be cleaned up later.
      blocks: input.blocks ?? [],
      ...write,
      updatedById,
    },
    select: TEMPLATE_SELECT,
  });
}
