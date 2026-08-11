"use client";

// ============================================================================
// OWNER  : Gauransh
// MODULE : Public Website — Hero Carousel (W4c, PRD §7.2)
// LAYER  : Presentation (client)
// PURPOSE: Rotate through several hero panels on a timer, with controls.
//
// THE ONLY CLIENT COMPONENT ON THE PUBLIC PAGE, AND ONLY WHEN IT IS NEEDED
//   HeroBlock renders a plain Server Component when there is one panel. This
//   file is reached only when an institution has actually configured a
//   carousel, so a university with a single hero ships no JavaScript for it.
//
// A CAROUSEL IS AN ACCESSIBILITY LIABILITY UNLESS IT IS BUILT AS ONE
//   Four things are non-negotiable and all four are here:
//     · it stops on hover and on keyboard focus, so nobody loses a sentence
//       half-read or a button mid-click;
//     · it does not autoplay at all under prefers-reduced-motion;
//     · hidden panels are `visibility: hidden`, which takes their links out of
//       the tab order — an invisible focusable link is how a keyboard user ends
//       up navigating somewhere they cannot see;
//     · every control is a real <button> with a label.
//
// STACKED IN A GRID, NOT ABSOLUTELY POSITIONED
//   All panels occupy row 1 / column 1. The container is therefore as tall as
//   the TALLEST panel and never collapses, which absolute positioning would do
//   the moment the first panel is the short one — and the page below would jump
//   on every rotation.
// ============================================================================

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { HeroSlide } from "@/lib/domain/cms/blocks";
import { HeroPanel, type HeroAlign, type HeroHeight } from "./HeroPanel";
import { cn } from "@/lib/utils";

export interface HeroCarouselProps {
  slides: readonly HeroSlide[];
  align: HeroAlign;
  height: HeroHeight;
  /** Validated to 3–20 by the block schema. */
  autoplaySeconds: number;
}

export function HeroCarousel({ slides, align, height, autoplaySeconds }: HeroCarouselProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const count = slides.length;

  const go = useCallback(
    (next: number) => {
      // Modulo both ways so "previous" from the first panel lands on the last
      // rather than on -1.
      setIndex(((next % count) + count) % count);
    },
    [count]
  );

  // A setTimeout re-armed on every change, NOT a setInterval.
  //
  // That is what makes a manual click reset the countdown: the effect re-runs
  // when `index` changes, clearing the pending timer and starting a fresh one.
  // A single long-lived interval would advance a second after a click that
  // happened to land near the end of a tick — the most common complaint about
  // carousels built on one.
  useEffect(() => {
    if (paused || reducedMotion || count < 2) return;

    const id = window.setTimeout(() => go(index + 1), autoplaySeconds * 1000);
    return () => window.clearTimeout(id);
  }, [go, index, paused, reducedMotion, count, autoplaySeconds]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Highlights"
      className="relative isolate"
      // Pause covers pointer AND keyboard: focusWithin is what stops the panel
      // sliding out from under someone tabbing towards its button.
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") go(index + 1);
        if (event.key === "ArrowLeft") go(index - 1);
      }}
    >
      <div className="grid">
        {slides.map((slide, i) => {
          const active = i === index;

          return (
            <div
              key={`${slide.heading}-${i}`}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              // Both properties transition, so the panel fades out and only
              // then leaves the tab order — rather than vanishing from the
              // keyboard while it is still visible on screen.
              style={{
                opacity: active ? 1 : 0,
                visibility: active ? "visible" : "hidden",
                transition: "opacity 600ms ease, visibility 600ms ease",
              }}
              className="col-start-1 row-start-1"
            >
              <HeroPanel slide={slide} align={align} height={height} playVideo={active} />
            </div>
          );
        })}
      </div>

      {/* Controls sit above the stack. Rendered outside the panel loop so there
          is one set of buttons rather than one per hidden panel. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 pb-8 sm:px-6 lg:px-8">
          <ul className="pointer-events-auto flex items-center gap-2.5">
            {slides.map((slide, i) => (
              <li key={`dot-${slide.heading}-${i}`}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Show panel ${i + 1}`}
                  aria-current={i === index}
                  className={cn(
                    "h-1.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2",
                    i === index ? "w-8 bg-white" : "w-3 bg-white/45 hover:bg-white/70"
                  )}
                />
              </li>
            ))}
          </ul>

          <div className="pointer-events-auto flex items-center gap-2">
            <CarouselButton label="Previous panel" onClick={() => go(index - 1)}>
              <ChevronLeft className="size-5" aria-hidden="true" />
            </CarouselButton>
            <CarouselButton label="Next panel" onClick={() => go(index + 1)}>
              <ChevronRight className="size-5" aria-hidden="true" />
            </CarouselButton>
          </div>
        </div>
      </div>

      {/* Announced to screen readers on change; invisible to everyone else.
          Without it, a rotating hero is silent to a screen reader and the
          controls appear to do nothing. */}
      <p aria-live="polite" className="sr-only">
        Panel {index + 1} of {count}: {slides[index]?.heading}
      </p>
    </section>
  );
}

function CarouselButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-11 items-center justify-center rounded-full border border-white/40 bg-black/25 text-white backdrop-blur-sm transition-colors hover:bg-black/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
    >
      {children}
    </button>
  );
}

/**
 * Whether the visitor has asked for reduced motion.
 *
 * useSyncExternalStore rather than an effect that calls setState: a media query
 * IS an external store, and subscribing to it directly means the first client
 * render already has the right answer instead of rendering "false" and then
 * correcting itself. The third argument is the SERVER snapshot — false, because
 * the server cannot know, and a hero that autoplays for a moment before
 * stopping is better than one that never starts for everyone.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  );
}
