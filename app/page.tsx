import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/services/session";
import { homeRouteForRoles } from "@/constants/roles";
import { resolveTenantForRequest } from "@/lib/services/tenant";
import { getPublishedPage, getSiteChrome } from "@/lib/services/site";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { BlockRenderer } from "@/components/site/BlockRenderer";

/**
 * Root route — a public website on a university's hostname, a router on the
 * platform's own.
 *
 * WHAT CHANGED, AND WHY IT HAD TO
 *   This route used to redirect every visitor to /login. On a tenant domain
 *   that meant a prospective student who typed the university's address was
 *   shown a staff login form — the institution had no public presence at all,
 *   which is PRD §7.1's entire subject.
 *
 *   The platform root keeps the old behaviour exactly. eduos.com is not an
 *   institution and has no landing page to serve; sending its visitors to the
 *   console they were looking for remains right.
 *
 * THE PAGE IS THE SAME FOR EVERYONE
 *   A signed-in visitor sees the landing page with "My dashboard" in the header
 *   instead of "Sign in". It does NOT redirect them: a landing page that
 *   bounces anyone with a session cannot be opened by the staff member who
 *   wrote it, or by an alumnus who happens to still be signed in — and a URL
 *   that shows different pages to different people is not a URL anybody can
 *   share.
 *
 * DYNAMIC BY DEPENDENCY, NOT BY DIRECTIVE
 *   resolveTenantForRequest reads headers(), which opts this segment out of
 *   static rendering on its own. Nothing here disables caching explicitly —
 *   the dependency on the hostname is what makes per-tenant output correct,
 *   and it is the same mechanism app/layout.tsx already relies on for
 *   per-tenant metadata.
 */

/** The landing page's own path in the CMS. */
const LANDING_PATH = "/";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await resolveTenantForRequest();
  if (!tenant) return {};

  const page = await getPublishedPage(tenant.id, LANDING_PATH);
  if (!page) return {};

  // §7.3 "SEO metadata". The institution's own values win; the root layout's
  // per-tenant title template supplies the fallback.
  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription ?? undefined,
    openGraph: {
      title: page.seoTitle ?? page.title,
      description: page.seoDescription ?? undefined,
      images: page.ogImageUrl ? [page.ogImageUrl] : undefined,
    },
  };
}

export default async function RootPage() {
  const tenant = await resolveTenantForRequest();

  // The platform root, or a hostname naming no institution. Unchanged
  // behaviour: route the visitor to wherever their session belongs.
  if (!tenant) {
    const session = await getPortalSession();
    if (!session) redirect("/login");
    redirect(homeRouteForRoles(session.roles));
  }

  const page = await getPublishedPage(tenant.id, LANDING_PATH);

  // A university whose landing page has never been published. Falling back to
  // the old redirect keeps every existing tenant working exactly as before —
  // this route gains a public website only for institutions that have actually
  // published one, so shipping it changes nothing for the rest.
  if (!page) {
    const session = await getPortalSession();
    if (!session) redirect("/login");
    redirect(homeRouteForRoles(session.roles));
  }

  // Started together: the session decides one button's label and the chrome
  // fills the header and footer. Neither depends on the other, so serialising
  // them would put a database round trip on the critical path for nothing.
  const [session, chrome] = await Promise.all([getPortalSession(), getSiteChrome(tenant.id)]);

  const action = session
    ? { label: "My dashboard", href: homeRouteForRoles(session.roles) }
    : { label: "Sign in", href: `/login?tenant=${tenant.slug}` };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader branding={tenant.branding} navItems={chrome.navItems} action={action} />

      <main id="main-content" className="flex-1">
        <BlockRenderer blocks={page.blocks} tenantId={tenant.id} />
      </main>

      {/* The clock is read here, in the Server Component, and passed down —
          calling new Date() inside a child during render is the impurity the
          rest of this codebase avoids by the same means. */}
      <SiteFooter branding={tenant.branding} chrome={chrome} year={new Date().getFullYear()} />
    </div>
  );
}
