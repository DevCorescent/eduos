// ============================================================================
// OWNER  : Gauransh
// MODULE : Public Website — Section Shell (W4c, PRD §7.2)
// LAYER  : Presentation (shared — imports nothing server-only)
// PURPOSE: The one container every block on the public site sits in, and the
//          one heading treatment every section uses.
//
// ITS OWN FILE, NOT A HELPER INSIDE blocks.tsx
//   blocks.tsx imports lib/services/site, which is "server-only" — anything
//   defined in it is therefore unreachable from a client component, and the
//   hero's client-side carousel already had to pull HeroPanel out for exactly
//   that reason. Keeping the section shell here means the same fate does not
//   have to be discovered a second time the next block that needs interaction.
//
// SEPARATION AND UNIFORMITY ARE THE SAME PROBLEM
//   Sections must read as distinct without reading as different pages. So the
//   vertical rhythm, the container width and the heading scale are FIXED here
//   and not passed in; what varies is the background tone, which is the one
//   axis that separates a band from its neighbours without changing its shape.
//
// TONE IS ASSIGNED BY THE RENDERER, NOT CHOSEN BY THE EDITOR
//   BlockRenderer alternates it down the page. An editor who could pick per
//   section would eventually produce three grey bands in a row, and the fix
//   would be a rule they have to remember instead of one the code applies.
// ============================================================================

import type { Typography } from "@/lib/domain/cms/typography";
import { typographyCssVars } from "@/lib/domain/cms/typography";
import { cn } from "@/lib/utils";

export type SectionTone = "plain" | "muted";

export interface SectionProps {
  children: React.ReactNode;
  className?: string;
  tone?: SectionTone;
  /**
   * This section's typography override.
   *
   * Emitted as custom properties on the <section> itself, so everything inside
   * it — including a nested card's title — picks the values up through the
   * cascade with no prop threading. See lib/domain/cms/typography.ts.
   */
  style?: Typography;
  /** Anchor target, so a nav item can link to "#programmes". */
  id?: string;
}

export function Section({ children, className, tone = "plain", style, id }: SectionProps) {
  return (
    <section
      id={id}
      // Cast because React's CSSProperties does not admit custom properties.
      // The values are hex, enum-mapped multipliers and enum-mapped weights —
      // never free text — so nothing arbitrary reaches the attribute.
      style={typographyCssVars(style) as React.CSSProperties}
      className={cn(
        "w-full scroll-mt-24 py-16 sm:py-24",
        tone === "muted" && "bg-muted/50",
        className
      )}
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  );
}

export interface SectionHeadingProps {
  heading: string;
  subheading?: string;
  /** The small capitalised line above the heading. */
  eyebrow?: string;
  align?: "center" | "left";
  className?: string;
}

/**
 * The heading every section wears.
 *
 * A short rule sits under the eyebrow rather than a coloured pill: it repeats
 * down a long page without eleven pills competing with the actual content, and
 * it takes the tenant's brand colour so the page reads as theirs.
 */
export function SectionHeading({
  heading,
  subheading,
  eyebrow,
  align = "center",
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" ? "mx-auto text-center" : "text-left",
        className
      )}
    >
      {eyebrow && (
        <p className="site-eyebrow mb-3 text-primary">
          {eyebrow}
        </p>
      )}

      <h2 className="site-h2 site-ink">{heading}</h2>

      <span
        aria-hidden="true"
        className={cn(
          "mt-5 block h-1 w-14 rounded-full bg-primary",
          align === "center" && "mx-auto"
        )}
      />

      {subheading && (
        <p className="site-lead site-ink-muted mt-5">{subheading}</p>
      )}
    </div>
  );
}
