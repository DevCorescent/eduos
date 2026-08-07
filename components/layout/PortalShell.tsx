// components/layout/PortalShell.tsx

"use client";

import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GraduationCap, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sidebar, type SidebarSection } from "./Sidebar";
import { Topbar, type TopbarUser } from "./Topbar";
import { PortalBreadcrumb } from "./PortalBreadcrumb";
import { useToast } from "@/providers/ToastProvider";
import { logout } from "@/services/auth";

export interface PortalShellProps {
  /** Nav tree, already filtered to the signed-in user's roles by the layout. */
  sections: SidebarSection[];
  user: TopbarUser;
  /** Shown beside the mark in the sidebar header, e.g. "Platform" or a tenant name. */
  portalName: string;
  /** Where the brand and the breadcrumb root point. */
  homeHref: string;
  /** Label for the breadcrumb's first entry. @default "Dashboard" */
  homeLabel?: string;
  children: ReactNode;
}

/**
 * The chrome every portal shares: sidebar, top bar, breadcrumb, content area.
 *
 * This is the single client boundary in a portal. The layout above it stays a
 * Server Component — it verifies the session, filters the nav by role, and
 * passes the result down as props — so nothing about who may see what is
 * decided in the browser, and `children` (the pages) remain Server Components
 * rendered on the server and slotted in.
 *
 * It is a client component only because three things need the browser: the
 * mobile sidebar toggle, the user menu, and logging out.
 *
 * @example
 * ```tsx
 * // app/(university)/layout.tsx — a Server Component
 * const session = await requireSession()
 * return (
 *   <PortalShell
 *     sections={filterNav(UNIVERSITY_NAV, session.roles)}
 *     user={{ name: session.email, email: session.email }}
 *     portalName="University"
 *     homeHref="/dashboard"
 *   >
 *     {children}
 *   </PortalShell>
 * )
 * ```
 */
export function PortalShell({
  sections,
  user,
  portalName,
  homeHref,
  homeLabel = "Dashboard",
  children,
}: PortalShellProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isMobileNavOpen, setMobileNavOpen] = useState(false);

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  const handleLogout = useCallback(async () => {
    // Goes through the service rather than fetch() directly, so signing out
    // clears the development mock identity as well as the real session cookies.
    // The service never throws — transport failures come back as an envelope.
    const result = await logout();

    if (!result.success) {
      toast({
        variant: "error",
        title: "Could not sign out",
        description: result.error,
      });
      return;
    }

    // replace(), not push(): the signed-in page must not be reachable with the
    // back button after signing out. refresh() then discards the cached Server
    // Component payload, which still holds the previous session's rendered data.
    router.replace("/login");
    router.refresh();
  }, [router, toast]);

  return (
    // h-dvh, not h-screen: on mobile browsers 100vh includes the address bar
    // that is not actually visible, pushing the bottom of the page off-screen.
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Skip link. Visually hidden until focused, so it costs sighted users
          nothing — but without it a keyboard user tabs through seventeen
          sidebar links to reach the content on every single page. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Skip to content
      </a>

      <Sidebar
        sections={sections}
        isMobileOpen={isMobileNavOpen}
        onMobileClose={closeMobileNav}
        header={({ collapsed }) => (
          <Link
            href={homeHref}
            className="flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GraduationCap className="size-6 shrink-0 text-primary" aria-hidden="true" />
            <span className={cn("min-w-0 truncate", collapsed && "lg:hidden")}>
              <span className="font-semibold text-foreground">eduOS</span>
              <span className="ml-1.5 text-sm text-muted-foreground">{portalName}</span>
            </span>
          </Link>
        )}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          // Settings lives here rather than in the sidebar so every portal gets
          // it: the four nav trees differ, but "my own account" belongs to
          // whoever is signed in, whatever they are signed in as.
          menuItems={[
            { label: "Settings", href: "/settings" },
            { label: "Sign out", onClick: handleLogout, destructive: true },
          ]}
          center={<PortalBreadcrumb root={{ label: homeLabel, href: homeHref }} />}
          leading={
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              aria-expanded={isMobileNavOpen}
              className="-ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
          }
        />

        {/* Only this element scrolls, so the sidebar and top bar stay fixed
            while a long table moves under them.
            tabIndex={-1} makes it a valid target for the skip link — without
            it, focus would move but keyboard navigation would resume from the
            top of the document anyway. */}
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto focus:outline-none">
          <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
