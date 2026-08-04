// components/ui/Skeleton.tsx

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Silhouette to draw. @default "rect" */
  variant?: "text" | "rect" | "circle";
  /** CSS width, e.g. "12rem" or "60%". Omit to fill the container. */
  width?: string | number;
  /** CSS height. Ignored for `text`, which derives its height from line count. */
  height?: string | number;
  /** Number of stacked lines. `text` only; the last line is shortened. @default 1 */
  lines?: number;
}

/**
 * Grey placeholder shown while content loads.
 *
 * Preferred over a centred spinner for content that has a known shape — a
 * table, a profile card, a stat row. It reserves the real layout, so the page
 * does not jump when data lands, and it communicates *what* is coming rather
 * than merely that something is.
 *
 * A Server Component: it is pure markup with a CSS animation and no state, so
 * it works inside `loading.tsx` and Suspense fallbacks with no client bundle.
 *
 * `aria-hidden` is deliberate. The skeleton is decorative — the loading state
 * is announced once by the live region on the container, and having a screen
 * reader also walk twelve empty boxes would be noise, not information.
 *
 * @example Stat row
 * ```tsx
 * <div className="grid grid-cols-4 gap-4">
 *   {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height="6rem" />)}
 * </div>
 * ```
 *
 * @example Paragraph
 * ```tsx
 * <Skeleton variant="text" lines={3} />
 * ```
 */
export function Skeleton({
  variant = "rect",
  width,
  height,
  lines = 1,
  className,
  style,
  ...props
}: SkeletonProps) {
  const base = "animate-pulse bg-muted";

  if (variant === "text") {
    return (
      <div
        aria-hidden="true"
        className={cn("flex flex-col gap-2", className)}
        style={{ width, ...style }}
        {...props}
      >
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className={cn(
              base,
              "h-4 rounded",
              // A ragged final line reads as prose rather than as a block, which
              // is the whole reason to use the text variant over a plain rect.
              i === lines - 1 && lines > 1 && "w-3/5"
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cn(base, variant === "circle" ? "rounded-full" : "rounded-md", className)}
      style={{ width, height, ...style }}
      {...props}
    />
  );
}

/**
 * Skeleton shaped like a populated table, for a list page's `loading.tsx`.
 *
 * Matches Table's `px-4 py-3` cell rhythm so the placeholder occupies the same
 * height as the real rows and the page does not shift when they arrive.
 */
export function TableSkeleton({
  rows = 5,
  columns = 4,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn("w-full", className)} role="status" aria-label="Loading table">
      <div className="flex border-b border-border">
        {Array.from({ length: columns }, (_, i) => (
          <div key={i} className="flex-1 px-4 py-3">
            <Skeleton height="0.875rem" width="60%" />
          </div>
        ))}
      </div>

      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex border-b border-border last:border-0">
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className="flex-1 px-4 py-3">
              <Skeleton height="1rem" width={c === 0 ? "80%" : "50%"} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Skeleton for a row of StatCards. */
export function StatCardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading statistics"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface p-5">
          <Skeleton height="0.875rem" width="50%" />
          <Skeleton height="2rem" width="40%" className="mt-3" />
        </div>
      ))}
    </div>
  );
}
