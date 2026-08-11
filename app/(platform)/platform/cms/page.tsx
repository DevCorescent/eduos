import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Eye } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { prisma } from "@/lib/db/prisma";
import { parseStoredBlocks } from "@/lib/domain/cms/blocks";
import {
  parseEnquireRail,
  parseFooterColumns,
  parseNavItems,
  parseSocialLinks,
  parseTypography,
} from "@/lib/domain/cms/site";
import {
  defaultEnquireRail,
  defaultFooterColumns,
  defaultNavItems,
  defaultSocialLinks,
} from "@/lib/domain/cms/defaults";
import { findTemplate } from "@/lib/repositories/cms.repository";
import { TemplateEditor } from "./TemplateEditor";

export const metadata: Metadata = { title: "Website CMS" };

/**
 * PRD §5.1 "Import initial university data" / §7 — the platform's CMS console.
 *
 * TWO THINGS ON ONE SCREEN, BECAUSE THEY ANSWER ONE QUESTION
 *   An operator arriving here wants to know either "what does a new university
 *   start with" or "what has this university actually published". The template
 *   editor answers the first; the table answers the second and links to each
 *   institution's own page editor.
 *
 * THE TEMPLATE IS A STARTING POINT, NOT A FLEET CONTROL
 *   Editing it changes nothing that already exists — tenants hold copies. The
 *   screen says so in as many words, because an operator who assumed otherwise
 *   would edit here expecting every university's site to change and get no
 *   feedback that it had not.
 */
export default async function PlatformCmsPage() {
  const [template, tenants] = await Promise.all([
    findTemplate("default-landing"),
    prisma.tenant.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        cmsPages: {
          where: { path: "/" },
          select: { status: true, publishedAt: true, updatedAt: true },
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const blocks = parseStoredBlocks(template?.blocks);

  // A template row seeded before the chrome columns existed holds null in all
  // four. Falling back to the shared defaults means the form opens showing what
  // onboarding would ACTUALLY produce, rather than an empty menu that implies a
  // new university would get none.
  const chrome = {
    navItems: template?.navItems ? parseNavItems(template.navItems) : defaultNavItems(),
    footerColumns: template?.footerColumns
      ? parseFooterColumns(template.footerColumns)
      : defaultFooterColumns(),
    socialLinks: template?.socialLinks
      ? parseSocialLinks(template.socialLinks)
      : defaultSocialLinks(),
    enquireRail: template?.enquireRail
      ? parseEnquireRail(template.enquireRail)
      : defaultEnquireRail(),
    typography: parseTypography(template?.typography),
  };

  return (
    <>
      <PageHeader
        title="Website CMS"
        subtitle="The landing page every new university starts from, and what each has published."
        action={
          <Link
            href="/cms-preview"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Eye className="size-4" aria-hidden="true" />
            Preview template
          </Link>
        }
      />

      <Alert variant="info" title="Editing the template does not change existing sites">
        A university receives a <strong>copy</strong> of this template when it is
        onboarded. From that moment the copy is theirs — editing here affects
        only universities onboarded afterwards.
      </Alert>

      <div className="mt-6">
        <TemplateEditor initialBlocks={blocks} initialChrome={chrome} />
      </div>

      <Card
        className="mt-8"
        noPadding
        header={
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-heading">University websites</h2>
            <span className="text-xs text-muted-foreground">{tenants.length} universities</span>
          </div>
        }
      >
        <ul className="divide-y divide-border">
          {tenants.map((tenant) => {
            const page = tenant.cmsPages[0];

            return (
              <li
                key={tenant.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{tenant.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {tenant.slug}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
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
                    size="sm"
                  />

                  <Link
                    href={`/platform/cms/${tenant.id}`}
                    className="rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Edit page
                  </Link>

                  {/* The DRAFT, which "View" below cannot show — that one opens
                      the institution's live address. */}
                  <a
                    href={`/cms-preview?tenant=${tenant.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Preview draft
                    <Eye className="size-3" aria-hidden="true" />
                  </a>

                  {page?.status === "PUBLISHED" && (
                    <a
                      href={`http://${tenant.slug}.localhost:3000/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      View
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
