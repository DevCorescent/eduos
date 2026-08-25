// ============================================================================
// MODULE : Student Portal — Template UI (PRD §57)
// LAYER  : Presentation
// PURPOSE: One labelled row carrying a percentage as both a bar and a figure —
//          the per-semester attendance rows in the reference design.
//
// THE THRESHOLD COLOURS ARE THE POINT
//   A bar that is the same colour at 42% and at 96% tells a student nothing
//   they could not read from the number. The tone is derived from the value
//   against the same examination-eligibility threshold the attendance report
//   uses, so the colour carries the consequence: red means "you may be barred
//   from this examination", not "this number is smallish".
//
//   The thresholds are props with defaults rather than constants, because a
//   meter is also useful for credits and course completion, where 75 means
//   nothing in particular.
// ============================================================================

import { cn } from "@/lib/utils";

export interface MeterRowProps {
  label: string;
  /** Secondary line under the label, e.g. a course code. */
  sublabel?: string;
  /** 0–100. Clamped for the bar; the caller's own `display` is shown as given. */
  percent: number;
  /** Pre-formatted figure shown at the right, e.g. "92.4%". */
  display: string;
  /** Below this the row reads danger. @default 75 */
  dangerBelow?: number;
  /** Below this (and at or above `dangerBelow`) the row reads warning. @default 85 */
  warningBelow?: number;
  className?: string;
}

export function MeterRow({
  label,
  sublabel,
  percent,
  display,
  dangerBelow = 75,
  warningBelow = 85,
  className,
}: MeterRowProps) {
  const safe = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));

  const tone =
    safe < dangerBelow ? "danger" : safe < warningBelow ? "warning" : "success";

  const barClass =
    tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-success";
  const textClass =
    tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-success";

  return (
    <div className={cn("px-5 py-3.5", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{label}</p>
          {sublabel && (
            <p className="truncate font-mono text-xs text-muted-foreground">{sublabel}</p>
          )}
        </div>
        <span className={cn("shrink-0 text-sm font-semibold tabular-nums", textClass)}>
          {display}
        </span>
      </div>

      {/* Presentation only, hidden from assistive technology: the figure beside
          it is the same information in a form a screen reader can actually
          convey, and announcing both would say it twice. */}
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        aria-hidden="true"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", barClass)}
          style={{ width: `${safe}%` }}
        />
      </div>
    </div>
  );
}
