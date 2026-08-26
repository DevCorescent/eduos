import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Eye } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { prisma } from "@/lib/db/prisma";
import { parseStoredBlocks } from "@/lib/domain/cms/blocks";
import { findPage } from "@/lib/repositories/cms.repository";
import { TenantPageEditor } from "./TenantPageEditor";

export const metadata: Metadata = { title: "University website" };

/**
 * PRD §5.1 — the platform operator editing one university's landing page,
 * as onboarding requires before a university has an administrator of its own.
 *
 * The layout above has already established a PlatformUser session; this page
 * reads through the repository for the same reason the university's own editor
 * does, and every write goes through the guarded route.
 */
export default async function PlatformTenantCmsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: { id: true, slug: true, name: true },
  });

  // notFound() rather than an error state: an id that names no university is a
  // bad URL, and 404 is what a bad URL means.
  if (!tenant) notFound();

  const page = await findPage(tenant.id);
  const blocks = parseStoredBlocks(page?.draftBlocks);

  // The platform console runs on the root host, so the institution's address
  // has to be constructed rather than read from this request's own headers.
  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost:3000";
  const previewUrl = `http://${tenant.slug}.${rootDomain}/`;

  return (
    <>
      <Link
        href="/platform/cms"
        className="mb-4 inline-flex items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All university websites
      </Link>

      <PageHeader
        title={tenant.name}
        subtitle={`Public landing page · ${tenant.slug}`}
        action={
          <div className="flex items-center gap-3">
            {/* The DRAFT. `previewUrl` on the editor below opens the live site,
                which is a different question — and the one an operator midway
                through an edit is not asking. */}
            <a
              href={`/cms-preview?tenant=${tenant.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Eye className="size-4" aria-hidden="true" />
              Preview draft
            </a>

            <StatusBadge
              label={
                !page
                  ? "No page"
                  : page.status === "PUBLISHED"
                    ? "Live"
                    : page.status === "ARCHIVED"
                      ? "Taken down"
                      : "Draft"
              }
              variant={page?.status === "PUBLISHED" ? "success" : "neutral"}
              size="md"
            />
          </div>
        }
      />

      <Alert variant="warning" title="You are editing an institution's own website" className="mb-6">
        Publishing here changes what visitors see on {tenant.name}&apos;s public
        address. Their administrators can edit the same page from their portal.
      </Alert>

      <TenantPageEditor
        tenantId={tenant.id}
        tenantName={tenant.name}
        initialBlocks={blocks}
        previewUrl={previewUrl}
      />
    </>
  );
}
