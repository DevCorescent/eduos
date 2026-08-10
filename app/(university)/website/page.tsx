import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { parseStoredBlocks } from "@/lib/domain/cms/blocks";
import { findPage } from "@/lib/repositories/cms.repository";
import { resolveTenantForRequest } from "@/lib/services/tenant";
import { WebsiteEditor } from "./WebsiteEditor";

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

  const page = await findPage(tenant.id);

  // The draft is what an editor edits. An institution that has never opened
  // this screen has no row at all, which is an ordinary starting state: the
  // editor renders an empty canvas and the row appears on first save.
  const blocks = parseStoredBlocks(page?.draftBlocks);

  // The institution's own hostname, so "View site" opens the page as a visitor
  // sees it rather than as the portal does. Built from the request's own host
  // because that is the address this administrator actually reached us on.
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const previewUrl = host ? `${proto}://${host}/` : "/";

  return (
    <>
      <PageHeader
        title="Website"
        subtitle="Your public landing page — what visitors see at your own address."
        action={
          page ? (
            <StatusBadge
              label={
                page.status === "PUBLISHED"
                  ? "Live"
                  : page.status === "ARCHIVED"
                    ? "Taken down"
                    : "Draft"
              }
              variant={page.status === "PUBLISHED" ? "success" : "neutral"}
              size="md"
            />
          ) : undefined
        }
      />

      {!page && (
        <Alert variant="info" title="Your website is not published yet" className="mb-6">
          Build your page below and press Publish. Until then, your address sends
          visitors to the sign-in screen.
        </Alert>
      )}

      {page?.status === "PUBLISHED" && (
        <Alert variant="info" title="Editing a live page" className="mb-6">
          Changes are saved as a draft and stay private until you publish them.{" "}
          <Link href={previewUrl} className="font-medium underline" target="_blank">
            See what is live now
          </Link>
        </Alert>
      )}

      <WebsiteEditor initialBlocks={blocks} previewUrl={previewUrl} />
    </>
  );
}
