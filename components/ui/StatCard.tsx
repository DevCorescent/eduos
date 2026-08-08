// components/ui/StatCard.tsx

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  /** The headline number — pass a formatted string so the caller controls locale/commas/currency. */
  value: string;
  /** Optional icon shown top-right, e.g. a subject/category glyph. */
  icon?: ReactNode;
  trend?: {
    /** Signed or unsigned percentage/number — component adds the arrow and color. */
    value: string;
    direction: "up" | "down";
    /** Whether "up" is good news. @default true — flip for metrics like "dropout rate". */
    positiveIsUp?: boolean;
  };
  /**
   * Neutral supporting line under the value, e.g. "142 active".
   *
   * Distinct from `trend`, which is a change over time and carries an arrow and
   * a good/bad colour. A breakdown of the current figure is neither, so
   * expressing it as a trend would claim movement that has not happened.
   * Ignored when `trend` is set — two lines under one number compete.
   */
  caption?: ReactNode;
  isLoading?: boolean;
}

function TrendArrow({ direction }: { direction: "up" | "down" }) {
  return direction === "up" ? (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5">
      <path fillRule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clipRule="evenodd" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5">
      <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z" clipRule="evenodd" />
    </svg>
  );
}

/**
 * Dashboard summary metric — big number, label, optional trend delta.
 * Skeleton-loads in place when `isLoading` so the grid layout doesn't
 * shift once real numbers arrive.
 *
 * `value` is a pre-formatted string, not a raw number: formatting
 * (currency, locale thousands separators, percentages, truncation like
 * "1.2k") varies per metric and belongs to the caller, not this component.
 *
 * @example
 * ```tsx
 * <StatCard label="Active Students" value="1,284" trend={{ value: "4.2%", direction: "up" }} />
 * ```
 *
 * @example Where "up" is bad news
 * ```tsx
 * <StatCard
 *   label="Dropout Rate"
 *   value="3.1%"
 *   trend={{ value: "0.4%", direction: "up", positiveIsUp: false }}
 * />
 * ```
 *
 * @example Loading
 * ```tsx
 * <StatCard label="Active Students" value="" isLoading />
 * ```
 */
export function StatCard({ label, value, icon, trend, caption, isLoading = false, className, ...props }: StatCardProps) {
  if (isLoading) {
    return (
      <div className={cn("glass rounded-lg p-5 transition-shadow hover:shadow-hover", className)} {...props}>
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-8 w-16 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const isGood = trend ? (trend.positiveIsUp ?? true) === (trend.direction === "up") : null;

  return (
    <div className={cn("glass rounded-lg p-5 transition-shadow hover:shadow-hover", className)} {...props}>
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {icon && (
          // A tinted disc rather than a bare glyph: it gives the icon a
          // footprint that matches the card's roundedness, which is what the
          // reference does and what stops the corner looking unfinished.
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-bg text-primary-bg-foreground">
            {icon}
          </span>
        )}
      </div>

      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>

      {trend && (
        <p
          className={cn(
            "mt-2 flex items-center gap-1 text-xs font-medium",
            isGood ? "text-success" : "text-danger"
          )}
        >
          <TrendArrow direction={trend.direction} />
          {trend.value}
          <span className="font-normal text-muted-foreground">vs last period</span>
        </p>
      )}

      {!trend && caption && (
        <p className="mt-2 text-xs text-muted-foreground">{caption}</p>
      )}
    </div>
  );
}