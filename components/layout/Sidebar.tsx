// components/layout/Sidebar.tsx

"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface SidebarNavItem {
  label: string;
  href: string;
  icon: ReactNode;
  /** Small numeric badge, e.g. unread count. */
  badge?: number;
}

export interface SidebarSection {
  /** Optional section heading, e.g. "Academics", "Administration". Omit for an unlabeled group. */
  label?: string;
  items: SidebarNavItem[];
}

export interface SidebarProps {
  sections: SidebarSection[];
  /**
   * Rendered at the top, e.g. product logo + name.
   *
   * Accepts a function so a brand can drop its wordmark when the rail is
   * collapsed and show only the mark. `collapsed` is owned by this component,
   * so a plain ReactNode header has no way to read it.
   */
  header?: ReactNode | ((state: { collapsed: boolean }) => ReactNode);
  /** Rendered pinned at the bottom, e.g. a "Help" or "Settings" link. */
  footer?: ReactNode;
  /** Uncontrolled initial collapsed state. Desktop only. @default false */
  defaultCollapsed?: boolean;
  /**
   * Whether the off-canvas panel is showing on small screens. Controlled by the
   * shell, which also owns the hamburger that sets it.
   */
  isMobileOpen?: boolean;
  /** Called when the mobile panel should close — backdrop, Escape, or a link tap. */
  onMobileClose?: () => void;
}

/**
 * Persistent left navigation, shared across every portal (platform, university,
 * faculty, student — each just passes different `sections`).
 *
 * Active-route highlighting is computed from the real URL via `usePathname`
 * rather than from an `isActive` flag passed per item, so the highlight cannot
 * drift out of sync with the page actually rendered.
 *
 * Responsive behaviour is two distinct modes, not one element being resized.
 * At `lg` and up it is a static column that can collapse to an icon rail. Below
 * `lg` it leaves the document flow entirely and becomes an off-canvas panel
 * over a backdrop — a 256px column on a 375px screen leaves nothing for
 * content, and a 64px icon rail is unusable on a device with no hover to reveal
 * labels.
 *
 * `"use client"` is required for the collapse state, the Escape handler, and
 * `usePathname`.
 *
 * @example
 * ```tsx
 * <Sidebar
 *   header={<Logo />}
 *   sections={filterNav(UNIVERSITY_NAV, session.roles)}
 *   isMobileOpen={isOpen}
 *   onMobileClose={close}
 * />
 * ```
 */
export function Sidebar({
  sections,
  header,
  footer,
  defaultCollapsed = false,
  isMobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  // Collapsing is a desktop-only affordance: the mobile panel is always full
  // width, so an icon rail there would be a second, conflicting mode. Every
  // consequence of this flag is therefore written as an `lg:` variant.
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const pathname = usePathname();

  useEffect(() => {
    if (!isMobileOpen || !onMobileClose) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onMobileClose?.();
    }
    document.addEventListener("keydown", onKeyDown);

    // The page behind must not scroll while the panel covers it, or a swipe
    // over the backdrop moves the wrong content.
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isMobileOpen, onMobileClose]);

  return (
    <>
      {isMobileOpen && (
        <div
          aria-hidden="true"
          onClick={onMobileClose}
          className="fixed inset-0 z-40 bg-overlay backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={cn(
          // glass-plain rather than glass: the sidebar supplies its own single
          // right border, and the full `glass` class would add a box on all
          // four sides plus a shadow that fights the content area.
          "glass-plain z-50 flex h-dvh shrink-0 flex-col border-r border-border",
          "transition-transform duration-200 lg:transition-[width]",
          // Mobile: fixed panel, slid off-screen until opened.
          "fixed inset-y-0 left-0 w-64",
          isMobileOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: back in the flow, always visible, width driven by collapse.
          "lg:static lg:translate-x-0",
          collapsed ? "lg:w-16" : "lg:w-64"
        )}
      >
        {header && (
          <div
            className={cn(
              "flex h-14 shrink-0 items-center border-b border-border px-4",
              collapsed && "lg:justify-center lg:px-2"
            )}
          >
            {typeof header === "function" ? header({ collapsed }) : header}
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-2 py-4">
          {sections.map((section, i) => (
            <div key={section.label ?? i} className={cn(i > 0 && "mt-6")}>
              {section.label && (
                <p
                  className={cn(
                    "px-2.5 pb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground",
                    collapsed && "lg:hidden"
                  )}
                >
                  {section.label}
                </p>
              )}

              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  // Prefix match so a detail page (/students/abc) keeps its
                  // parent link lit. The trailing slash is load-bearing:
                  // without it "/faculty" would also light up on
                  // "/faculty-development".
                  const isActive =
                    pathname === item.href || pathname?.startsWith(`${item.href}/`);

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        // Tapping a link on mobile navigates *and* dismisses the
                        // panel — leaving it open would cover the page just
                        // navigated to. Harmless on desktop, where it is undefined.
                        onClick={onMobileClose}
                        aria-current={isActive ? "page" : undefined}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          collapsed && "lg:justify-center",
                          isActive
                            ? "bg-primary-bg text-primary-bg-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <span className="shrink-0 [&>svg]:size-5" aria-hidden="true">
                          {item.icon}
                        </span>

                        <span className={cn("flex-1 truncate", collapsed && "lg:hidden")}>
                          {item.label}
                        </span>

                        {item.badge !== undefined && (
                          <span
                            className={cn(
                              "rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground",
                              collapsed && "lg:hidden"
                            )}
                          >
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {footer && (
          <div className={cn("shrink-0 border-t border-border p-3", collapsed && "lg:hidden")}>
            {footer}
          </div>
        )}

        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="hidden h-10 shrink-0 items-center justify-center border-t border-border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset lg:flex"
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className={cn("size-4 transition-transform", collapsed && "rotate-180")}
          >
            <path
              fillRule="evenodd"
              d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </aside>
    </>
  );
}
