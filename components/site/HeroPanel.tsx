// ============================================================================
// OWNER  : Gauransh
// MODULE : Public Website — Hero Panel (W4c, PRD §7.2)
// LAYER  : Presentation (shared — no server-only imports, no hooks)
// PURPOSE: Draw ONE hero panel. A single hero and one slide of a carousel are
//          the same thing, so they are the same component.
//
// NO "use client" AND NO HOOKS
//   That is what lets a single-panel hero stay a Server Component and ship zero
//   JavaScript, while the carousel — which is a client component — imports the
//   very same markup. A file with neither directive is usable from both sides;
//   adding a hook here would quietly force the whole hero into the browser
//   bundle for every institution, including the ones with one panel.
//
// THE SCRIM IS A LEGIBILITY REQUIREMENT, NOT A STYLE CHOICE
//   An institution supplies its own photograph and nobody reviews it for
//   contrast. White text straight onto an arbitrary image is unreadable roughly
//   half the time, so a gradient sits between them — dense behind the text,
//   clearing where the picture shows. Any photograph works and none has to be
//   vetted.
// ============================================================================

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { HeroSlide } from "@/lib/domain/cms/blocks";
import { cn } from "@/lib/utils";

export type HeroHeight = "compact" | "standard" | "tall";
export type HeroAlign = "left" | "center";

/**
 * Vertical room, as padding rather than a fixed height.
 *
 * A `h-[600px]` hero clips its own headline the moment an institution writes a
 * long one, and long headlines are what institutions write. Padding grows with
 * the content instead; inside a carousel the grid stack makes every panel as
 * tall as the tallest, so they still line up.
 */
const HEIGHTS = {
  compact: "py-20 sm:py-24",
  standard: "py-28 sm:py-36",
  tall: "py-32 sm:py-48",
} satisfies Record<HeroHeight, string>;

export interface HeroPanelProps {
  slide: HeroSlide;
  align: HeroAlign;
  height: HeroHeight;
  /**
   * Whether to mount this panel's <video>.
   *
   * FALSE FOR EVERY HIDDEN CAROUSEL PANEL, deliberately. Four autoplaying
   * videos decoding at once behind three invisible panels is a phone battery
   * and a mobile data bill spent on frames nobody sees. The poster image still
   * renders, so a hidden panel looks identical the instant it becomes visible.
   */
  playVideo?: boolean;
}

export function HeroPanel({ slide, align, height, playVideo = true }: HeroPanelProps) {
  const { eyebrow, heading, subheading, primaryCta, secondaryCta, imageUrl, videoUrl } = slide;

  const hasBackground = Boolean(imageUrl || videoUrl);
  const centred = align === "center";

  return (
    <div className="relative isolate size-full overflow-hidden">
      {videoUrl && playVideo ? (
        // muted + playsInline are what let a browser autoplay at all; without
        // both, mobile Safari and Chrome refuse and the panel stays on its
        // poster. `poster` is the still, so there is never an empty frame while
        // the video buffers, and a visitor who blocks media keeps the image.
        <video
          className="absolute inset-0 -z-20 size-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={imageUrl}
          aria-hidden="true"
        >
          <source src={videoUrl} />
        </video>
      ) : imageUrl ? (
        // A tenant-supplied external URL. next/image would need every
        // institution's CDN listed in remotePatterns — configuration a
        // multi-tenant product cannot know ahead of time.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="absolute inset-0 -z-20 size-full object-cover" />
      ) : null}

      {hasBackground ? (
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 -z-10",
            centred
              ? "bg-linear-to-b from-neutral-950/70 via-neutral-950/55 to-neutral-950/70"
              : "bg-linear-to-r from-neutral-950/85 via-neutral-950/60 to-neutral-950/20"
          )}
        />
      ) : (
        <div aria-hidden="true" className="gradient-primary absolute inset-0 -z-10" />
      )}

      <div
        className={cn(
          "mx-auto flex w-full max-w-7xl flex-col justify-center px-4 sm:px-6 lg:px-8",
          HEIGHTS[height]
        )}
      >
        <div className={cn("max-w-2xl", centred && "mx-auto max-w-3xl text-center")}>
          {eyebrow && (
            <p className="site-eyebrow site-ink-on-dark mb-5 inline-block rounded-full bg-white/15 px-4 py-1.5 backdrop-blur-sm">
              {eyebrow}
            </p>
          )}

          <h1 className="site-display site-ink-on-dark">{heading}</h1>

          {subheading && (
            <p
              className={cn(
                "site-lead site-ink-on-dark-soft mt-6 max-w-xl",
                centred && "mx-auto"
              )}
            >
              {subheading}
            </p>
          )}

          {(primaryCta || secondaryCta) && (
            <div
              className={cn(
                "mt-9 flex flex-wrap items-center gap-4",
                centred && "justify-center"
              )}
            >
              {primaryCta && (
                <Link
                  href={primaryCta.href}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
                >
                  {primaryCta.label}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              )}
              {secondaryCta && (
                <Link
                  href={secondaryCta.href}
                  className="inline-flex items-center rounded-full border border-white/70 bg-white/10 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
                >
                  {secondaryCta.label}
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
