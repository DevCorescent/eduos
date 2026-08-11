// ============================================================================
// OWNER  : Gauransh
// MODULE : Public Website — Footer (W4b, PRD §7.1, §45)
// LAYER  : Presentation (Server Component)
// PURPOSE: The institution's identity, its link columns, its contact details
//          and its social accounts — all from CmsSite, none hardcoded.
//
// "POWERED BY" IS NOT HERE
//   §45 is a WHITE-LABEL specification: the institution's public website is
//   theirs, and stamping the vendor's name on the footer of every university's
//   homepage is the one thing white-labelling exists to prevent.
//
// EVERY SECTION IS CONDITIONAL
//   A university with no columns, no socials and no phone number gets a footer
//   with its name and a copyright line. Rendering empty headings for absent
//   data is how a new tenant's site looks broken rather than new.
// ============================================================================

import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";
import type { SocialPlatform } from "@/lib/domain/cms/site";
import type { SiteChrome } from "@/lib/services/site";
import type { TenantBranding } from "@/lib/domain/tenant/branding";

// ---------------------------------------------------------------------------
// Brand glyphs, drawn inline.
//
// lucide-react v1 REMOVED its brand icons — Facebook, Instagram, Linkedin and
// Youtube are no longer exported, and importing them is a build error rather
// than a missing picture. Upstream's reasoning is that third-party logos are
// trademarks and not lucide's to ship.
//
// So they are drawn here as paths. Each is a single filled path at 24×24 taking
// `currentColor`, which is what lets the footer tint them with the tenant's
// own palette rather than each brand's.
// ---------------------------------------------------------------------------

type GlyphProps = { className?: string };

function FacebookGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 3.926 23.094 9.101 24v-8.437H6.627v-3.49h2.474V9.9c0-3.51 2.075-5.45 5.24-5.45 1.518 0 3.106.274 3.106.274v3.43h-1.75c-1.723 0-2.26 1.078-2.26 2.183v2.62h3.847l-.615 3.49h-3.232V24C20.074 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}

function InstagramGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}

function LinkedinGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function YoutubeGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function XGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/**
 * Platform → glyph. Total over SOCIAL_PLATFORMS, enforced by `satisfies`, for
 * the same reason the block icon map is: adding a platform to the enum without
 * drawing it becomes a compile error, not a blank circle on a live page.
 */
const SOCIAL_ICONS = {
  facebook: FacebookGlyph,
  instagram: InstagramGlyph,
  linkedin: LinkedinGlyph,
  youtube: YoutubeGlyph,
  x: XGlyph,
} satisfies Record<SocialPlatform, React.ComponentType<GlyphProps>>;

const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  x: "X",
};

export interface SiteFooterProps {
  branding: TenantBranding;
  chrome: SiteChrome;
  /** Rendered as the copyright year. Passed in — reading the clock during a
   *  render is impure, and the page above already knows the date. */
  year: number;
}

export function SiteFooter({ branding, chrome, year }: SiteFooterProps) {
  const { footerColumns, socialLinks, contactAddress, contactPhone, contactEmail } = chrome;
  const hasContact = Boolean(contactAddress || contactPhone || contactEmail);

  return (
    // The brand gradient rather than a grey band, as in the reference designs —
    // it reads as the institution's own sign-off rather than as page furniture.
    <footer className="gradient-primary mt-auto text-white">
      <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <p className="site-h3 text-white">{branding.name}</p>
            <p className="site-small mt-3 text-white/70">
              Programmes, admissions and publicly verifiable credentials.
            </p>

            {socialLinks.length > 0 && (
              <ul className="mt-6 flex flex-wrap items-center gap-3">
                {socialLinks.map((social) => {
                  const Glyph = SOCIAL_ICONS[social.platform];
                  return (
                    <li key={social.platform}>
                      <a
                        href={social.href}
                        // Third-party destinations. noreferrer alongside
                        // noopener because the target should not be told which
                        // institution's site sent the visitor.
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex size-9 items-center justify-center rounded-full border border-white/25 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      >
                        <Glyph className="size-4" />
                        <span className="sr-only">{SOCIAL_LABELS[social.platform]}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {footerColumns.map((column) => (
            <nav key={column.heading} aria-label={column.heading} className="min-w-0">
              <p className="site-eyebrow text-white/60">{column.heading}</p>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={`${link.label}-${link.href}`}>
                    <Link
                      href={link.href}
                      className="site-small rounded text-white/85 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          {hasContact && (
            <address className="min-w-0 not-italic">
              <p className="site-eyebrow text-white/60">Contact</p>
              <ul className="site-small mt-4 space-y-3 text-white/85">
                {contactAddress && (
                  <li className="flex gap-2.5">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-white/60" aria-hidden="true" />
                    <span className="leading-6">{contactAddress}</span>
                  </li>
                )}
                {contactPhone && (
                  <li className="flex gap-2.5">
                    <Phone className="mt-0.5 size-4 shrink-0 text-white/60" aria-hidden="true" />
                    <a href={`tel:${contactPhone}`} className="rounded hover:text-white">
                      {contactPhone}
                    </a>
                  </li>
                )}
                {contactEmail && (
                  <li className="flex gap-2.5">
                    <Mail className="mt-0.5 size-4 shrink-0 text-white/60" aria-hidden="true" />
                    <a href={`mailto:${contactEmail}`} className="rounded break-all hover:text-white">
                      {contactEmail}
                    </a>
                  </li>
                )}
              </ul>
            </address>
          )}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/20 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-white/60">
            © {year} {branding.name}. All rights reserved.
          </p>
          <Link
            href="/verify"
            className="rounded text-xs text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Verify a certificate
          </Link>
        </div>
      </div>
    </footer>
  );
}
