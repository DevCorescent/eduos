// ============================================================================
// MODULE : Student Portal — Template UI (PRD §57)
// LAYER  : Presentation
// PURPOSE: The dashboard's headline metric, in the tile form the reference
//          designs use: a tinted disc, a large figure, a supporting line, and
//          an optional ring on the right.
//
// WHY THIS IS NOT components/ui/StatCard
//   StatCard is shared by the university, faculty, parent and platform
//   consoles — 71 pages render it. This tile is taller, tinted per tone and
//   carries a ring slot; pushing those into StatCard would repaint every one of
//   those pages in a change whose purpose was the student portal. It lives here
//   until the look is settled, and promoting it later is a file move.
//
// EVERY COLOUR IS A SEMANTIC TOKEN, NEVER A HEX
//   That is the constraint that keeps PRD §45 per-tenant theming reachable
//   without touching this file again: a tenant re-points --primary and the
//   tiles follow. A literal `bg-orange-100` here would be a tile that stays
//   orange for an institution whose brand is not.
// ============================================================================

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ProgressRing } from "./ProgressRing";

/** Which semantic pair the tinted disc and the ring draw from. */
export type StatTone = "primary" | "success" | "warning" | "danger" | "info";

const TONE_DISC: Record<StatTone, string> = {
  primary: "bg-primary-bg text-primary-bg-foreground",
  success: "bg-success-bg text-success-bg-foreground",
  warning: "bg-warning-bg text-warning-bg-foreground",
  danger: "bg-danger-bg text-danger-bg-foreground",
  info: "bg-info-bg text-info-bg-foreground",
};

/** The ring's own stroke, which it inherits through `currentColor`. */
const TONE_RING: Record<StatTone, string> = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

export interface StatTileProps {
  label: string;
  /** Pre-formatted. The caller owns currency, locale and decimal places. */
  value: string;
  icon?: ReactNode;
  /** Neutral supporting line under the figure. */
  caption?: ReactNode;
  /** @default "primary" */
  tone?: StatTone;
  /**
   * Draws a ring at 0–100 on the right-hand side.
   *
   * Separate from `value` because the two are not always the same quantity:
   * a tile can read "18 / 20 credits" while the ring shows 90.
   */
  ring?: { percent: number; label?: string; srLabel: string };
  className?: string;
}

export function StatTile({
  label,
  value,
  icon,
  caption,
  tone = "primary",
  ring,
  className,
}: StatTileProps) {
  return (
    <div
      className={cn(
        // `glass` carries the frosted fill, border and shadow as one look — the
        // same surface treatment every other card on the page uses, so a tile
        // reads as part of the set rather than as a pasted-in widget.
        "glass hover-lift flex flex-col gap-4 rounded-xl p-5",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-3xl font-semibold leading-tight tracking-tight text-heading">
            {value}
          </p>
        </div>

        {icon && (
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full",
              TONE_DISC[tone]
            )}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
      </div>

      {(caption || ring) && (
        <div className="flex items-end justify-between gap-3">
          {caption ? (
            <p className="min-w-0 text-xs leading-5 text-muted-foreground">{caption}</p>
          ) : (
            <span />
          )}

          {ring && (
            <ProgressRingSlot tone={tone} {...ring} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The ring, wrapped so the tone class lands on a parent rather than on the ring
 * itself — ProgressRing draws with `currentColor` precisely so that the colour
 * decision stays with whoever placed it.
 */
function ProgressRingSlot({
  tone,
  percent,
  label,
  srLabel,
}: { tone: StatTone } & NonNullable<StatTileProps["ring"]>) {
  return (
    <span className={cn("shrink-0", TONE_RING[tone])}>
      <ProgressRing value={percent} size={56} thickness={6} label={label} srLabel={srLabel} />
    </span>
  );
}
