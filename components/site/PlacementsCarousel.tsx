"use client";

// ============================================================================
// OWNER  : Gauransh
// MODULE : Public Website — Placements Student Carousel (W4d)
// LAYER  : Presentation (client)
// PURPOSE: Rotate placed-student tiles in pairs, matching the reference's
//          photo + name/company layout.
// ============================================================================

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PlacementStudent {
  name: string;
  company: string;
  imageUrl?: string;
  companyLogoUrl?: string;
  programme?: string;
}

export interface PlacementsCarouselProps {
  students: readonly PlacementStudent[];
  autoplaySeconds: number;
}

/** Chunk students into pairs so each slide mirrors the reference's 2-up layout. */
function pairsOf(students: readonly PlacementStudent[]): PlacementStudent[][] {
  const pairs: PlacementStudent[][] = [];
  for (let i = 0; i < students.length; i += 2) {
    pairs.push(students.slice(i, i + 2));
  }
  return pairs;
}

export function PlacementsCarousel({ students, autoplaySeconds }: PlacementsCarouselProps) {
  const pairs = pairsOf(students);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const count = pairs.length;

  const go = useCallback(
    (next: number) => {
      if (count < 1) return;
      setIndex(((next % count) + count) % count);
    },
    [count]
  );

  useEffect(() => {
    if (paused || reducedMotion || count < 2) return;
    const id = window.setTimeout(() => go(index + 1), autoplaySeconds * 1000);
    return () => window.clearTimeout(id);
  }, [go, index, paused, reducedMotion, count, autoplaySeconds]);

  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="Placed students"
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="grid">
        {pairs.map((pair, i) => {
          const active = i === index;
          return (
            <div
              key={`pair-${i}`}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              style={{
                opacity: active ? 1 : 0,
                visibility: active ? "visible" : "hidden",
                transition: "opacity 500ms ease, visibility 500ms ease",
              }}
              className="col-start-1 row-start-1 grid grid-cols-1 gap-4 sm:grid-cols-2"
            >
              {pair.map((student, slot) => (
                <StudentTile
                  key={`${student.name}-${slot}`}
                  student={student}
                  accent={slot % 2 === 1}
                />
              ))}
            </div>
          );
        })}
      </div>

      {count > 1 && (
        <div className="mt-5 flex items-center justify-end gap-2">
          <CarouselButton label="Previous students" onClick={() => go(index - 1)}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </CarouselButton>
          <CarouselButton label="Next students" onClick={() => go(index + 1)}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </CarouselButton>
        </div>
      )}

      <p aria-live="polite" className="sr-only">
        Slide {index + 1} of {count}
      </p>
    </div>
  );
}

function StudentTile({
  student,
  accent,
}: {
  student: PlacementStudent;
  /** Alternate tile uses the brand fill, as in the reference. */
  accent: boolean;
}) {
  return (
    <article className="grid grid-cols-2 overflow-hidden rounded-xl shadow-soft">
      <div className="relative aspect-square bg-primary-bg">
        {student.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- tenant CDN URL
          <img src={student.imageUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-sm font-medium text-primary">
            {student.name
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0])
              .join("")
              .toUpperCase()}
          </div>
        )}
      </div>

      <div
        className={cn(
          "flex flex-col justify-center gap-2 px-4 py-5",
          accent ? "bg-primary text-primary-foreground" : "bg-surface text-foreground"
        )}
      >
        <div>
          <p className={cn("text-sm font-semibold", accent ? "text-primary-foreground" : "site-ink")}>
            {student.name}
          </p>
          {student.programme && (
            <p
              className={cn(
                "mt-0.5 text-xs",
                accent ? "text-primary-foreground/75" : "site-ink-muted"
              )}
            >
              {student.programme}
            </p>
          )}
          <p
            className={cn(
              "mt-1 text-xs font-medium",
              accent ? "text-primary-foreground/90" : "text-primary"
            )}
          >
            {student.company}
          </p>
        </div>

        {student.companyLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={student.companyLogoUrl}
            alt=""
            className={cn(
              "mt-auto h-6 w-auto max-w-20 object-contain",
              accent && "brightness-0 invert"
            )}
          />
        ) : null}
      </div>
    </article>
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
      className="flex size-9 items-center justify-center rounded-full border border-border bg-surface text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

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
