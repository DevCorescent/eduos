// ============================================================================
// OWNER  : Gauransh
// MODULE : Public Website — Header (W4, PRD §7.1, §45)
// LAYER  : Presentation (Server Component)
// PURPOSE: The bar every public page wears: the institution's own mark, the
//          section links with their dropdowns, and one action.
//
// THIS IS THE UNIVERSITY'S HEADER, NOT eduOS's
//   §45 makes branding the institution's, so this header renders the tenant's
//   logo and name and never the product's.
//
// THE DROPDOWNS SHIP NO JAVASCRIPT, AND THAT IS NOT A COMPROMISE
//   `group-hover` opens them for a pointer and `group-focus-within` opens them
//   for a keyboard — both are CSS, so this stays a Server Component on the one
//   page of the product anonymous visitors load cold. A React dropdown would
//   buy a click-outside handler and an escape key, and cost every visitor a
//   hydration pass for a menu most of them will never open.
//
//   The gap between a menu item and its panel is PADDING ON THE PANEL, not a
//   margin. A margin leaves a dead strip the pointer crosses on the way down,
//   and the menu closes under it — the single most common way a CSS dropdown
//   is unusable.
//
// A PARENT ITEM IS STILL A LINK
//   There is no hover on a touch screen. A parent whose only job was to open a
//   menu would simply do nothing when tapped, so every parent goes somewhere and
//   the dropdown is an addition rather than the point. Below `lg` the whole menu
//   becomes a native <details> disclosure, which needs no JavaScript either.
// ============================================================================

import Link from "next/link";
import { ChevronDown, GraduationCap, Menu } from "lucide-react";
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
    // Sticky and lightly frosted so the hero reads through it. Stronger blur
    // compensates for the lower fill so links stay legible over any photograph.
    <header className="sticky top-0 z-50 border-b border-white/25 bg-white/30 backdrop-blur-xl">
      <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* Validated before it reaches an <img src>. An unchecked stored URL
              here would let a javascript: or data: value into the markup of the
              one page served to anonymous visitors. */}
          {logoUrl && isSafeAssetUrl(logoUrl) ? (
            // A tenant logo is an arbitrary external URL; next/image would need
            // every institution's CDN in remotePatterns.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-10 w-auto max-w-44 object-contain" />
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCap className="size-5" aria-hidden="true" />
            </span>
          )}
          <span className="site-h3 site-ink min-w-0 truncate tracking-tight">{name}</span>
        </Link>

        {navItems.length > 0 && (
          <nav aria-label="Site" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {navItems.map((item) => (
                <NavEntry key={`${item.label}-${item.href}`} item={item} />
              ))}
            </ul>
          </nav>
        )}

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={action.href}
            className="hidden shrink-0 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:inline-block"
          >
            {action.label}
          </Link>

          {navItems.length > 0 && <MobileMenu navItems={navItems} action={action} />}
        </div>
      </div>
    </header>
  );
}

// --- Desktop --------------------------------------------------------------

function NavEntry({ item }: { item: NavItem }) {
  const children = item.children ?? [];

  if (children.length === 0) {
    return (
      <li>
        <Link
          href={item.href}
          className="site-small block rounded-md px-3 py-2 font-medium uppercase tracking-wide text-foreground/75 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {item.label}
        </Link>
      </li>
    );
  }

  return (
    <li className="group relative">
      <Link
        href={item.href}
        // aria-expanded is deliberately absent: nothing here toggles, so a
        // state attribute would be a lie a screen reader repeats. The panel is
        // a plain list that reaches the tab order when this link is focused,
        // which is the behaviour the markup actually has.
        className="site-small flex items-center gap-1 rounded-md px-3 py-2 font-medium uppercase tracking-wide text-foreground/75 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {item.label}
        <ChevronDown
          className="size-3.5 transition-transform group-hover:rotate-180"
          aria-hidden="true"
        />
      </Link>

      {/* pt-2 is the bridge the pointer crosses — see the file note. */}
      <div className="invisible absolute left-0 top-full pt-2 opacity-0 transition-[opacity,visibility] duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <ul className="w-72 rounded-xl border border-border bg-surface p-2 shadow-hover">
          {children.map((child) => (
            <li key={`${child.label}-${child.href}`}>
              <Link
                href={child.href}
                className="block rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="site-small site-ink block font-medium">{child.label}</span>
                {child.description && (
                  <span className="site-ink-muted mt-0.5 block text-xs leading-5">
                    {child.description}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

// --- Below lg -------------------------------------------------------------

/**
 * The small-screen menu.
 *
 * A NATIVE <details>, for the same reason the FAQ block is one: open and close
 * is browser behaviour, keyboard-operable and screen-reader-announced, with no
 * JavaScript. The trade is that it pushes the page down rather than overlaying
 * it — which on a landing page is fine, and is what the reference sites do.
 */
function MobileMenu({
  navItems,
  action,
}: {
  navItems: readonly NavItem[];
  action: { label: string; href: string };
}) {
  return (
    <details className="group/menu lg:hidden">
      <summary
        aria-label="Menu"
        className="flex size-11 cursor-pointer items-center justify-center rounded-full border border-border text-foreground marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Menu className="size-5" aria-hidden="true" />
      </summary>

      {/* Pulled out to the full width of the viewport: a panel constrained to
          the button it hangs from would be 44px wide. */}
      <div className="absolute inset-x-0 top-full border-b border-border bg-surface shadow-hover">
        <nav aria-label="Site" className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
          <ul className="divide-y divide-border">
            {navItems.map((item) => (
              <li key={`m-${item.label}-${item.href}`} className="py-1">
                <Link
                  href={item.href}
                  className="site-small site-ink block rounded-md px-1 py-2.5 font-medium"
                >
                  {item.label}
                </Link>

                {item.children && item.children.length > 0 && (
                  <ul className="mb-2 ml-3 space-y-0.5 border-l border-border pl-3">
                    {item.children.map((child) => (
                      <li key={`m-${child.label}-${child.href}`}>
                        <Link
                          href={child.href}
                          className="site-ink-muted block rounded-md px-1 py-1.5 text-sm"
                        >
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          {/* The action repeats here because it is hidden below `sm` in the bar
              itself — without this a phone visitor has no way to sign in. */}
          <Link
            href={action.href}
            className="mt-4 block rounded-full bg-primary px-5 py-3 text-center text-sm font-semibold text-primary-foreground sm:hidden"
          >
            {action.label}
          </Link>
        </nav>
      </div>
    </details>
  );
}
