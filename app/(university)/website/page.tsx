import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { parseStoredBlocks } from "@/lib/domain/cms/blocks";
import {
  parseEnquireRail,
  parseFooterColumns,
  parseNavItems,
  parseSocialLinks,
  parseTypography,
} from "@/lib/domain/cms/site";
import { findPage, findSite } from "@/lib/repositories/cms.repository";
import { resolveTenantForRequest } from "@/lib/services/tenant";
import { publicSiteUrl } from "@/lib/services/site";
import {
  PUBLISH_STATE_LABEL,
  isPubliclyVisible,
  publishState,
} from "@/lib/domain/cms/publishState";
import { formatRelative } from "@/utils/format";
import { WebsiteEditor } from "./WebsiteEditor";
import { SiteChromeForm } from "./SiteChromeForm";

export const metadata: Metadata = { title: "Website" };

/**
 * PRD §7.3 — this university's public landing page, edited by the institution.
 *
 * IN (university), NOT (platform)
 *   §45 opens "Each university can configure:", so the website belongs to the
 *   institution. The platform's own view of the same page lives under
 *   /platform/cms and is guarded by a different session type entirely.
 *
 * READS THROUGH THE REPOSITORY, NOT OVER HTTP
 *   Server Components in this project usually call an API route so the guard
 *   runs once, in one place. Here the surrounding layout has already
 *   established that the caller is a UNIVERSITY_ADMIN of this tenant, and the
 *   repository takes the tenant id explicitly — so a direct read saves a round
 *   trip on a page that has to load a whole document before it can render.
 *   Every WRITE still goes through the guarded route.
 */
export default async function WebsitePage() {
  const tenant = await resolveTenantForRequest();

  if (!tenant) {
    return (
      <>
        <PageHeader title="Website" />
        <Alert variant="error" title="Could not identify your institution">
          This screen is served from your university&apos;s own hostname. Sign in
          through it and try again.
        </Alert>
      </>
    );
  }

  // Started together: the page body and the chrome around it are independent
  // rows, so serialising them would put a database round trip on the critical
  // path of a screen that cannot render until both have arrived.
  const [page, site] = await Promise.all([findPage(tenant.id), findSite(tenant.id)]);

  // The draft is what an editor edits. An institution that has never opened
  // this screen has no row at all, which is an ordinary starting state: the
  // editor renders an empty canvas and the row appears on first save.
  const blocks = parseStoredBlocks(page?.draftBlocks);

  // Parsed here rather than handed over raw. The chrome editor validates
  // against the route's own schema, and a Json column holding a shape that
  // predates a schema change would otherwise put the form into a state the
  // reader cannot save out of. Each parser answers unparseable stored JSON with
  // an empty list, which IS savable.
  const chromeValue = {
    navItems: parseNavItems(site?.navItems),
    footerColumns: parseFooterColumns(site?.footerColumns),
    socialLinks: parseSocialLinks(site?.socialLinks),
    enquireRail: parseEnquireRail(site?.enquireRail),
    contactAddress: site?.contactAddress ?? undefined,
    contactPhone: site?.contactPhone ?? undefined,
    contactEmail: site?.contactEmail ?? undefined,
    typography: parseTypography(site?.typography),
  };

  // WHERE "VIEW SITE" POINTS
  //   The institution's own public address — its verified custom domain, or its
  //   subdomain of the platform root — resolved from the TENANT, never from the
  //   host this administrator happens to be on. On the platform root host an
  //   anonymous visitor resolves to no tenant at all, so the old
  //   request-host link handed the admin a redirect to the staff sign-in form
  //   and called it their website.
  //
  //   The tenant comes from the session-backed resolver above, so a client
  //   cannot ask for another institution's address by any means.
  const siteUrl = await publicSiteUrl(tenant);

  const state = publishState(page);
  const live = isPubliclyVisible(state);

  // Offered only when there is something published to look at. A draft is
  // private by design, and "View site" must never be the thing that shows it.
  const previewUrl = live ? siteUrl : null;

  const previewUnavailable =
    siteUrl === null
      ? "No public address is configured for your institution yet."
      : "No published website is available yet. Press Publish to make this page live.";

  return (
    <>
      <PageHeader
        title="Website"
        subtitle="Your public landing page — what visitors see at your own address."
        action={
          <StatusBadge
            label={PUBLISH_STATE_LABEL[state]}
            // Amber for unpublished changes: it is neither a healthy "live and
            // current" nor a failure — it is work waiting to go out, and the
            // badge is the only place that distinction is visible.
            variant={
              state === "PUBLISHED"
                ? "success"
                : state === "UNPUBLISHED_CHANGES"
                  ? "warning"
                  : "neutral"
            }
            size="md"
          />
        }
      />

      {/* The two facts an editor needs before pressing anything: when this was
          last saved, and when visitors last saw a change. Rendered from the row
          rather than from client state, so they cannot drift from the truth. */}
      <p className="-mt-2 mb-6 text-sm text-muted-foreground">
        Last saved {page ? formatRelative(page.updatedAt.toISOString()) : "never"}
        {" · "}
        Last published{" "}
        {page?.publishedAt ? formatRelative(page.publishedAt.toISOString()) : "never"}
      </p>

      {state === "NEVER_PUBLISHED" && (
        <Alert variant="info" title="Your website is not published yet" className="mb-6">
          Build your page below and press Publish. Until then, your address sends
          visitors to the sign-in screen.
        </Alert>
      )}

      {state === "UNPUBLISHED_CHANGES" && (
        <Alert variant="warning" title="You have changes that visitors cannot see yet" className="mb-6">
          Your saved draft differs from the published website. Visitors still see
          the version you published{" "}
          {page?.publishedAt ? formatRelative(page.publishedAt.toISOString()) : "earlier"}.
          Press Publish to make these changes live.{" "}
          {previewUrl && (
            <Link href={previewUrl} className="font-medium underline" target="_blank" rel="noopener noreferrer">
              See what is live now
            </Link>
          )}
        </Alert>
      )}

      {state === "PUBLISHED" && previewUrl && (
        <Alert variant="info" title="Your website is live" className="mb-6">
          Everything you have saved is published.{" "}
          <Link href={previewUrl} className="font-medium underline" target="_blank" rel="noopener noreferrer">
            Open your website
          </Link>
        </Alert>
      )}

      {state === "ARCHIVED" && (
        <Alert variant="warning" title="Your website has been taken down" className="mb-6">
          Visitors to your address are sent to the sign-in screen. Press Publish
          to put it back online.
        </Alert>
      )}

      {live && siteUrl === null && (
        <Alert variant="warning" title="No public address is configured" className="mb-6">
          Your page is published, but your institution has no verified domain or
          platform subdomain, so there is no address to open it at.
        </Alert>
      )}

      <WebsiteEditor
        initialBlocks={blocks}
        previewUrl={previewUrl}
        previewUnavailable={previewUnavailable}
      />

      <div className="mt-8">
        <SiteChromeForm initialValue={chromeValue} />
      </div>
    </>
  );
}
