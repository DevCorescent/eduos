import "server-only";

// ============================================================================
// OWNER  : Gauransh
// MODULE : Public Website — Read Path (W4, PRD §7)
// LAYER  : Service (server-only)
// PURPOSE: Everything the anonymous public site reads, in one place.
//
// WHY THIS TALKS TO PRISMA DIRECTLY AND NOT THROUGH services/client.ts
//   Every other read in this product goes over HTTP to a route, because every
//   other read is authenticated and the route is where the guard lives. This
//   one has NO caller identity by definition: an anonymous visitor on a
//   university's domain has no session and must not need one.
//
//   Routing it through an API route would mean either an unauthenticated public
//   endpoint — a second, weaker door onto tenant data — or a self-call carrying
//   no cookie that the guard would reject. Reading directly, with the tenant id
//   resolved from the HOSTNAME rather than from user input, is both simpler and
//   narrower: the only rows these functions can return are ones already
//   published for public view.
//
// THE TENANT ID IS NEVER A PARAMETER FROM THE CLIENT
//   Callers pass a tenantId that came from resolveTenantForRequest, which reads
//   the Host header. Nothing in a query string or a path segment reaches these
//   functions, so there is no parameter an anonymous visitor could change to
//   read another university's rows.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { parseStoredBlocks, type CmsBlocks } from "@/lib/domain/cms/blocks";
import { publicSiteOrigin } from "@/lib/domain/tenant/publicUrl";
import {
  parseEnquireRail,
  parseFooterColumns,
  parseNavItems,
  parseSocialLinks,
  parseTypography,
  type EnquireRail,
  type FooterColumn,
  type NavItem,
  type SocialLink,
  type Typography,
} from "@/lib/domain/cms/site";

/** A page as the public renderer needs it. */
export interface PublishedPage {
  title: string;
  blocks: CmsBlocks;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
}

/**
 * The published version of one page, or null.
 *
 * ONLY `PUBLISHED`, AND ONLY `publishedBlocks`.
 *   A DRAFT page returns null and its URL 404s — that is what "draft" means and
 *   it is the entire safety property of this function. It never reads
 *   draftBlocks, so no amount of unfinished editing can appear on a live
 *   domain, and an ARCHIVED page stops resolving without being deleted.
 */
export async function getPublishedPage(
  tenantId: string,
  path: string
): Promise<PublishedPage | null> {
  const page = await prisma.cmsPage.findUnique({
    where: { tenantId_path: { tenantId, path } },
    select: {
      title: true,
      status: true,
      publishedBlocks: true,
      seoTitle: true,
      seoDescription: true,
      ogImageUrl: true,
    },
  });

  if (!page || page.status !== "PUBLISHED" || page.publishedBlocks === null) {
    return null;
  }

  return {
    title: page.title,
    // parseStoredBlocks returns [] rather than throwing on unparseable JSON.
    // An empty homepage is a bad day; a 500 on a university's public domain is
    // a worse one. See its own note.
    blocks: parseStoredBlocks(page.publishedBlocks),
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    ogImageUrl: page.ogImageUrl,
  };
}

/** The header and footer around every page of one university's site. */
export interface SiteChrome {
  navItems: NavItem[];
  footerColumns: FooterColumn[];
  socialLinks: SocialLink[];
  enquireRail: EnquireRail;
  contactAddress: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  /**
   * The institution's site-wide type. Emitted as custom properties on the page
   * wrapper; a block's own `style` overrides it for one section through the
   * cascade. `{}` means the design system's own, which is the correct default.
   */
  typography: Typography;
}

/**
 * Navigation, footer and contact details for one tenant.
 *
 * RETURNS AN EMPTY CHROME RATHER THAN NULL when no CmsSite row exists.
 *   A university that has published a landing page but never configured its
 *   menu should get a page with no menu, not a page that fails to render. The
 *   header falls back to the institution's name and the action button, which is
 *   a complete, if minimal, header.
 */
export async function getSiteChrome(tenantId: string): Promise<SiteChrome> {
  const site = await prisma.cmsSite.findUnique({
    where: { tenantId },
    select: {
      navItems: true,
      footerColumns: true,
      socialLinks: true,
      enquireRail: true,
      contactAddress: true,
      contactPhone: true,
      contactEmail: true,
      typography: true,
    },
  });

  return {
    navItems: parseNavItems(site?.navItems),
    footerColumns: parseFooterColumns(site?.footerColumns),
    socialLinks: parseSocialLinks(site?.socialLinks),
    enquireRail: parseEnquireRail(site?.enquireRail),
    contactAddress: site?.contactAddress ?? null,
    contactPhone: site?.contactPhone ?? null,
    contactEmail: site?.contactEmail ?? null,
    typography: parseTypography(site?.typography),
  };
}

/** A programme as the public programmes block shows it. */
export interface PublicProgramme {
  id: string;
  name: string;
  code: string;
  type: string;
  durationValue: number;
  durationUnit: string;
  description: string | null;
  departmentName: string;
}

/**
 * Live programmes for the programmes block.
 *
 * THIS IS THE POINT OF PUTTING THE CMS INSIDE THE ERP
 *   The block stores no programme content — only a heading and a limit. The
 *   rows come from the same Programme table the admin portal writes, so adding
 *   a programme updates the public website with no second edit and no chance of
 *   the two disagreeing. A bolted-on website cannot do this; it can only hold a
 *   copy that goes stale.
 *
 * `isActive` is the publication rule. A programme an institution has retired
 * must stop being advertised the moment it is deactivated, without anybody
 * remembering to edit the homepage.
 */
export async function listPublicProgrammes(
  tenantId: string,
  limit: number
): Promise<PublicProgramme[]> {
  const rows = await prisma.programme.findMany({
    where: { tenantId, isActive: true },
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
      durationValue: true,
      durationUnit: true,
      description: true,
      department: { select: { name: true } },
    },
    orderBy: { name: "asc" },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    type: row.type,
    durationValue: row.durationValue,
    durationUnit: row.durationUnit,
    description: row.description,
    departmentName: row.department.name,
  }));
}

/**
 * The address at which this university's public website is served.
 *
 * INPUT   : a tenant id and slug the CALLER has already established belong to
 *           the authenticated session. Nothing here is taken from the request.
 * RETURNS : an absolute URL, or null when the institution has no public address
 *           configured — which the caller must show as "no address yet" rather
 *           than papering over with the host it happens to be running on.
 *
 * WHY IT ASKS THE DATABASE
 *   A custom domain only counts once it is verified AND active: an unverified
 *   row is a domain somebody typed, not one that resolves to us, and linking to
 *   it would send the administrator to whatever currently answers there. The
 *   primary domain wins when an institution has several, which is what
 *   `isPrimary` is for.
 */
export async function publicSiteUrl(tenant: {
  id: string;
  slug: string;
}): Promise<string | null> {
  const domain = await prisma.domain.findFirst({
    where: { tenantId: tenant.id, verified: true, isActive: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { domain: true },
  });

  const origin = publicSiteOrigin({
    slug: tenant.slug,
    customDomain: domain?.domain,
    rootDomain: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
  });

  return origin === null ? null : `${origin}/`;
}
