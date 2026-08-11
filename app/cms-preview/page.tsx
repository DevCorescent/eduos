import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { parseStoredBlocks, type CmsBlocks } from "@/lib/domain/cms/blocks";
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
} from "@/lib/domain/cms/site";
import {
  defaultEnquireRail,
  defaultFooterColumns,
  defaultNavItems,
  defaultSocialLinks,
} from "@/lib/domain/cms/defaults";
import { typographyCssVars, type Typography } from "@/lib/domain/cms/typography";
import type { TenantBranding } from "@/lib/domain/tenant/branding";
import { applyInstitutionName } from "@/lib/domain/cms/institution";
import { findPage, findSite, findTemplate } from "@/lib/repositories/cms.repository";
import { requirePlatformAdmin } from "@/lib/middleware/requirePlatformAdmin";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { BlockRenderer } from "@/components/site/BlockRenderer";
import { EnquireDock } from "@/components/site/EnquireDock";

export const metadata: Metadata = { title: "Preview" };

/**
 * PRD §5.1, §7 — what the platform operator is about to hand a university.
 *
 * WHY THIS ROUTE IS NOT UNDER /platform
 *   Everything in the (platform) route group is wrapped in the console shell —
 *   a sidebar, a header, a content column. A landing page rendered inside a
 *   600px column is not a preview of a landing page. This route sits at the top
 *   level so it gets the ROOT layout and the full viewport, which is the only
 *   way the thing being previewed looks like the thing being shipped.
 *
 *   It therefore carries its OWN guard rather than inheriting the group's. The
 *   guard is the same function the console layout and every /api/platform route
 *   run, so the screen and the data agree by construction.
 *
 * TWO THINGS IT CAN PREVIEW, ONE MECHANISM
 *   With no parameter it renders the shared TEMPLATE, with a placeholder
 *   institution name substituted for the token the template stores. With
 *   ?tenant=<id> it renders that university's DRAFT — which is the preview the
 *   live "View site" button cannot give, because that one shows what is
 *   published.
 *
 * NOTHING HERE IS PUBLIC. A visitor without a platform session is redirected to
 * the platform sign-in, so an unpublished draft cannot be read by sharing a URL.
 */

/** The name substituted into the template's `{{institution}}` token. */
const PLACEHOLDER_INSTITUTION = "Your University";

export default async function CmsPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const guard = await requirePlatformAdmin();
  if (!guard.authorized) {
    if (guard.reason === "PASSWORD_CHANGE_REQUIRED") redirect("/super-admin/change-password");
    redirect("/super-admin/login");
  }

  const { tenant: tenantId } = await searchParams;

  const preview = tenantId
    ? await loadTenantPreview(tenantId)
    : await loadTemplatePreview();

  if (!preview) redirect("/platform/cms");

  return (
    <div
      className="site-scope flex min-h-dvh flex-col bg-background"
      style={typographyCssVars(preview.typography) as React.CSSProperties}
    >
      <PreviewBanner label={preview.label} backHref={preview.backHref} />

      <SiteHeader
        branding={preview.branding}
        navItems={preview.navItems}
        // The sign-in button is inert in a preview — there is no tenant host to
        // sign in to when previewing a template. It points back at the console
        // so a mis-click does not end the operator's session.
        action={{ label: "Sign in", href: preview.backHref }}
      />

      <main className="flex-1">
        {/* tenantId is null for the template, which makes the programmes block
            draw labelled sample rows rather than query an institution that does
            not exist. See its own note. */}
        <BlockRenderer blocks={preview.blocks} tenantId={preview.tenantId} />
      </main>

      <SiteFooter
        branding={preview.branding}
        chrome={{
          navItems: preview.navItems,
          footerColumns: preview.footerColumns,
          socialLinks: preview.socialLinks,
          enquireRail: preview.enquireRail,
          contactAddress: preview.contactAddress,
          contactPhone: preview.contactPhone,
          contactEmail: preview.contactEmail,
          typography: preview.typography,
        }}
        year={new Date().getFullYear()}
      />

      <EnquireDock rail={preview.enquireRail} />
    </div>
  );
}

/**
 * A bar saying this is not a live site.
 *
 * A preview that is indistinguishable from production is how somebody reports a
 * bug against a draft, or reassures a university that their site is live when
 * it is not. It stays at the top of the document rather than floating over the
 * page, so it cannot cover the thing being reviewed.
 */
function PreviewBanner({ label, backHref }: { label: string; backHref: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-900 px-4 py-2.5 text-white sm:px-6">
      <p className="text-xs font-medium">
        <span className="mr-2 rounded-full bg-warning px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-900">
          Preview
        </span>
        {label}
      </p>

      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 rounded text-xs text-white/80 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to the CMS
      </Link>
    </div>
  );
}

/**
 * What the page needs, whichever of the two things it is showing.
 *
 * Declared rather than inferred from one of the loaders: the two differ in
 * whether a contact line can be null, and inferring from either would make the
 * other's return type an error for a reason that has nothing to do with the
 * page.
 */
interface Preview {
  label: string;
  backHref: string;
  /** Null for the template — see BlockRenderer on what that makes happen. */
  tenantId: string | null;
  branding: TenantBranding;
  blocks: CmsBlocks;
  navItems: NavItem[];
  footerColumns: FooterColumn[];
  socialLinks: SocialLink[];
  enquireRail: EnquireRail;
  typography: Typography;
  contactAddress: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

async function loadTemplatePreview(): Promise<Preview | null> {
  const template = await findTemplate("default-landing");
  if (!template) return null;

  // The template stores `{{institution}}`; substituting a placeholder is what
  // makes the preview read as a page rather than as a mail-merge source.
  const blocks = applyInstitutionName(
    parseStoredBlocks(template.blocks),
    PLACEHOLDER_INSTITUTION
  );

  // A template row seeded before the chrome columns existed holds null. Falling
  // back to the shared defaults shows what onboarding would ACTUALLY produce,
  // which is the question this screen exists to answer.
  const navItems = template.navItems ? parseNavItems(template.navItems) : defaultNavItems();
  const footerColumns = template.footerColumns
    ? parseFooterColumns(template.footerColumns)
    : defaultFooterColumns();
  const socialLinks = template.socialLinks
    ? parseSocialLinks(template.socialLinks)
    : defaultSocialLinks();
  const enquireRail = template.enquireRail
    ? parseEnquireRail(template.enquireRail)
    : defaultEnquireRail();

  return {
    label: "The default template — what a new university starts from.",
    backHref: "/platform/cms",
    tenantId: null,
    branding: {
      name: PLACEHOLDER_INSTITUTION,
      logoUrl: null,
      faviconUrl: null,
      primaryColor: null,
      accentColor: null,
    },
    blocks,
    navItems,
    footerColumns,
    socialLinks,
    enquireRail,
    typography: parseTypography(template.typography),
    contactAddress: "Main Campus, Jaipur — 302017",
    contactPhone: "+91 90000 00000",
    contactEmail: "admissions@example.edu",
  };
}

async function loadTenantPreview(tenantId: string): Promise<Preview | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      faviconUrl: true,
      primaryColor: true,
      accentColor: true,
    },
  });

  if (!tenant) return null;

  const [page, site] = await Promise.all([findPage(tenant.id), findSite(tenant.id)]);

  return {
    label: `${tenant.name} — the current DRAFT, not what is published.`,
    backHref: `/platform/cms/${tenant.id}`,
    tenantId: tenant.id,
    branding: {
      name: tenant.name,
      logoUrl: tenant.logoUrl,
      faviconUrl: tenant.faviconUrl,
      primaryColor: tenant.primaryColor,
      accentColor: tenant.accentColor,
    },
    // draftBlocks, deliberately. Previewing publishedBlocks would duplicate the
    // "View site" button and answer the wrong question.
    blocks: parseStoredBlocks(page?.draftBlocks),
    navItems: parseNavItems(site?.navItems),
    footerColumns: parseFooterColumns(site?.footerColumns),
    socialLinks: parseSocialLinks(site?.socialLinks),
    enquireRail: parseEnquireRail(site?.enquireRail),
    typography: parseTypography(site?.typography),
    contactAddress: site?.contactAddress ?? null,
    contactPhone: site?.contactPhone ?? null,
    contactEmail: site?.contactEmail ?? null,
  };
}
