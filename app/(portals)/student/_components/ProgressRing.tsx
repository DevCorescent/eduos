// ============================================================================
// MODULE : Student Portal — Template UI (PRD §57)
// LAYER  : Presentation
// PURPOSE: A percentage drawn as a ring rather than a bar.
//
// WHY A SERVER COMPONENT
//   There is no state, no event and no measurement here — the arc length is
//   arithmetic on a prop. Marking it "use client" would ship an SVG generator
//   to the browser to draw something the server already knows the shape of.
//
// WHY IT TAKES NO COLOUR PROP
//   The stroke comes from `currentColor`, so the ring inherits whatever the
//   surrounding tile has set. That is what keeps per-tenant theming (PRD §45)
//   possible later without revisiting this file: a tenant changes the brand
//   token, the token changes the text colour, and the ring follows.
// ============================================================================

import { cn } from "@/lib/utils";

export interface ProgressRingProps {
  /** 0–100. Values outside the range are clamped rather than drawn wrong. */
  value: number;
  /** Outer diameter in pixels. @default 72 */
  size?: number;
  /** Stroke width in pixels. @default 8 */
  thickness?: number;
  /**
   * Rendered in the middle. Pass a pre-formatted string so the caller owns
   * whether this reads "92%", "92.4%" or "A+".
   */
  label?: string;
  /** Announced to screen readers in place of the raw number. */
  srLabel: string;
  className?: string;
}

export function ProgressRing({
  value,
  size = 72,
  thickness = 8,
  label,
  srLabel,
  className,
}: ProgressRingProps) {
  // Clamped, not trusted. A percentage computed from a division can arrive as
  // 100.0000001 or as a negative when a denominator is stale, and either one
  // draws an arc that wraps past its own start.
  const safe = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));

  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (safe / 100) * circumference;

  return (
    <div
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={srLabel}
        // -90° so the arc starts at twelve o'clock. Without it every ring on
        // the page appears to begin a quarter turn late.
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          // The unfilled remainder. Deliberately a neutral border token rather
          // than a tinted one, so the filled arc is what the eye lands on.
          className="stroke-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          className="stroke-current"
        />
      </svg>

      {label && (
        <span
          className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-heading"
          // The ring already carries the accessible name; repeating the number
          // here would have a screen reader announce the figure twice.
          aria-hidden="true"
        >
          {label}
        </span>
      )}
    </div>
  );
}
