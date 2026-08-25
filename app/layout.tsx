import type { Metadata } from "next";
import { Inter, Geist_Mono, Poppins } from "next/font/google";
import { ToastProvider } from "@/providers/ToastProvider";
import { resolveTenantForRequest } from "@/lib/services/tenant";
import { brandingCssVariables, isSafeAssetUrl } from "@/lib/domain/tenant/branding";
import "./globals.css";

const interSans = Inter({
  variable: "--font-geist-sans",  // token name kept: globals.css maps it
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The public website's body face.
 *
 * LOADED HERE, APPLIED NOWHERE BY DEFAULT
 *   The variable is declared on <html> so the custom property exists, but only
 *   `.site-scope` in globals.css actually uses it. The five ERP portals keep
 *   Inter. A university's homepage and its attendance register are read by
 *   different people for different reasons, and there is no argument for
 *   restyling the second because somebody chose a face for the first.
 *
 * WEIGHTS ARE ENUMERATED because Poppins has no variable font on Google Fonts —
 * next/font requires the list, and these six are exactly the steps
 * lib/domain/cms/typography.ts lets an editor choose. Asking for a weight that
 * is not fetched is how a "Light" setting silently renders at 400.
 */
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

/**
 * PRD §5.2 "Custom favicon and social preview" and §45 white-label branding.
 *
 * A FUNCTION, NOT A CONSTANT, AND THAT MATTERS FOR CORRECTNESS
 *   A static `metadata` export is evaluated once and reused. On a multi-tenant
 *   product served from many hostnames that is not a performance detail — it is
 *   a correctness bug: AKTU's favicon and title would be served on IPU's
 *   domain, whichever tenant happened to render first.
 *
 *   generateMetadata reads the tenant per request. Because it calls
 *   resolveTenantForRequest, which reads headers(), this route segment is
 *   dynamic — which is what makes tenant-specific output correct rather than
 *   cached across tenants. Caching is not disabled anywhere; the dependency on
 *   headers() is what opts this segment out, and only this segment.
 *
 *   The tenant lookup itself is memoised per request by requestScoped, so the
 *   metadata generator and the layout body below share ONE database read.
 */
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await resolveTenantForRequest();

  // No tenant — the platform root, or an unrecognised host. The product's own
  // identity is the honest answer; borrowing a university's would be worse.
  if (!tenant) {
    return {
      title: { default: "eduOS", template: "%s | eduOS" },
      description: "Multi-University Digital Education Operating System",
    };
  }

  const { name, faviconUrl } = tenant.branding;

  return {
    // The institution's own name, so a bookmark and a browser tab read as
    // theirs rather than as their vendor's.
    title: { default: name, template: `%s | ${name}` },
    description: `${name} — powered by eduOS`,
    // Validated before it reaches a <link rel="icon">. An unvalidated value
    // here would let a stored javascript: or data: URL into the document head.
    ...(faviconUrl && isSafeAssetUrl(faviconUrl)
      ? { icons: { icon: faviconUrl } }
      : {}),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const tenant = await resolveTenantForRequest();

  // Two custom properties at most, both validated to a strict hex pattern that
  // cannot contain a brace, semicolon or parenthesis. The design system's forty
  // generated steps are untouched: a tenant accents the product, it does not
  // repaint it, so no combination of stored values can produce an unreadable
  // screen. See lib/domain/tenant/branding.ts for the injection this prevents.
  const brandVariables = tenant ? brandingCssVariables(tenant.branding) : "";

  return (
    <html
      lang="en"
      className={`${interSans.variable} ${geistMono.variable} ${poppins.variable} h-full antialiased`}
    >
      {brandVariables && (
        // Server-rendered, so the brand colours are present in the first paint
        // rather than applied by JavaScript after it. Scoped to :root so the
        // tokens cascade exactly like the design system's own.
        <style>{`:root{${brandVariables}}`}</style>
      )}
      {/* ToastProvider is the one client boundary in the root layout. It wraps
          `children` rather than replacing the tree, so every page below stays a
          Server Component — only the toast viewport itself ships JS. */}
      <body className="min-h-full flex flex-col">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
