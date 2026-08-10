// ============================================================================
// OWNER  : Gauransh
// MODULE : Public Website — Header (W4, PRD §7.1, §45)
// LAYER  : Presentation (Server Component)
// PURPOSE: The bar every public page wears: the institution's own mark, the
//          section links, and one action.
//
// THIS IS THE UNIVERSITY'S HEADER, NOT eduOS's
//   app/(public)/layout.tsx hardcodes a graduation cap and the word "eduOS" on
//   the certificate-verification page, which means an employer verifying a
//   degree sees the VENDOR's name where the issuing institution's should be.
//   §45 makes branding the institution's, so this header renders the tenant's
//   logo and name and never the product's.
//
// THE ACTION CHANGES WITH THE SESSION, THE PAGE DOES NOT
//   A signed-in visitor gets "My dashboard"; everyone else gets "Sign in". The
//   PAGE is identical either way — a landing page that redirects a signed-in
//   user cannot be shared by the staff member who wrote it, which is the whole
//   purpose of a landing page.
// ============================================================================

import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { isSafeAssetUrl } from "@/lib/domain/tenant/branding";
import type { TenantBranding } from "@/lib/domain/tenant/branding";
import type { NavItem } from "@/lib/domain/cms/site";

export interface SiteHeaderProps {
  branding: TenantBranding;
  /**
   * The menu, from CmsSite. Editable per institution — §7.3's CMS-managed
   * navigation. An empty array renders no menu, which is the correct state for
   * a university that has published a page but not yet configured one.
   */
  navItems: readonly NavItem[];
  /** Where the action button goes, and what it says. Resolved by the page. */
  action: { label: string; href: string };
}

export function SiteHeader({ branding, navItems, action }: SiteHeaderProps) {
  const { name, logoUrl } = branding;

  return (
    // Sticky and translucent so the hero image scrolls under it, as in the
    // reference designs. `backdrop-blur` keeps the links legible over whatever
    // photograph the institution chose.
    <header className="sticky top-0 z-50 border-b border-white/15 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-18 w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* Validated before it reaches an <img src>. An unchecked stored URL
              here would let a javascript: or data: value into the markup of the
              one page served to anonymous visitors. */}
          {logoUrl && isSafeAssetUrl(logoUrl) ? (
            // A tenant logo is an arbitrary external URL. next/image would need
            // every institution's CDN listed in remotePatterns, which is
            // configuration a multi-tenant product cannot know ahead of time.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-9 w-auto max-w-40 object-contain" />
          ) : (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCap className="size-5" aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0 truncate text-base font-semibold tracking-tight text-heading">
            {name}
          </span>
        </Link>

        {navItems.length > 0 && (
          // Hidden below `lg` rather than given a burger menu: a drawer is
          // interaction, and this header is a Server Component that ships no
          // JavaScript. The menu returns as a client island when someone builds
          // it, and nothing else here has to change.
          <nav aria-label="Site" className="hidden items-center gap-7 lg:flex">
            {navItems.map((item) => (
              <Link
                key={`${item.label}-${item.href}`}
                href={item.href}
                className="rounded text-sm font-medium text-foreground/80 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}

        <Link
          href={action.href}
          className="shrink-0 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {action.label}
        </Link>
      </div>
    </header>
  );
}
