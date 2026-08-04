// components/ui/Avatar.tsx

"use client";

import { useState, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  /** Image URL. Falls back to initials if omitted or if it fails to load. */
  src?: string;
  /** Full name used to derive initials and the accessible label. */
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  /** Small colored dot indicating online/offline/away status. */
  status?: "online" | "offline" | "away";
}

const sizeStyles = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
  xl: "size-14 text-base",
};

const statusDotSize = {
  sm: "size-1.5",
  md: "size-2",
  lg: "size-2.5",
  xl: "size-3",
};

const statusStyles = {
  online: "bg-success",
  offline: "bg-muted-foreground",
  away: "bg-warning",
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Small deterministic palette so the same name always gets the same
// background color across renders/pages, without storing a color per user.
//
// Drawn from the theme's own status and brand hues rather than Tailwind's
// stock palette: a directory of avatars in rose, amber and sky reads as a
// different product from the indigo/cyan brand around it. Each entry is a
// tint plus its matching foreground, so contrast holds at every size.
const palette = [
  "bg-primary-bg text-primary-bg-foreground",
  "bg-info-bg text-info-bg-foreground",
  "bg-success-bg text-success-bg-foreground",
  "bg-warning-bg text-warning-bg-foreground",
  "bg-surface-active text-heading",
];

function getColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

/**
 * Circular user avatar with automatic initials fallback. Tracks image
 * load failure in state and switches to the initials branch when it
 * happens — not just hiding the broken `<img>` into empty space, which
 * was the bug in the earlier version of this component.
 *
 * `"use client"` is required for that state (`onError`/`onLoad` handlers
 * only run in the browser).
 *
 * Also resets the failure state if `src` changes to a new URL — so a
 * stale "broken" state doesn't stick around after a parent passes a
 * fresh, working image URL for the same avatar (e.g. after a user
 * uploads a new profile photo).
 *
 * @example
 * ```tsx
 * <Avatar name="Priya Sharma" src={user.avatarUrl} size="md" status="online" />
 * ```
 *
 * @example Fallback only
 * ```tsx
 * <Avatar name="Rahul Verma" size="lg" />
 * ```
 */
export function Avatar({ src, name, size = "md", status, className, ...props }: AvatarProps) {
  // Records *which* URL failed, rather than a bare "did it fail" flag.
  //
  // That distinction removes the need for an effect: a flag would stay true
  // after `src` changed and had to be reset on every change, costing an extra
  // render pass and briefly showing the fallback for a URL that was never
  // tried. Comparing against the current src derives the same answer during
  // render, so a new upload replacing a broken URL gets a fresh chance for
  // free.
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);

  const showImage = Boolean(src) && erroredSrc !== src;

  return (
    <span
      className={cn("relative inline-flex shrink-0 rounded-full", sizeStyles[size], className)}
      {...props}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar sources are arbitrary user-uploaded URLs, not known at build time
        <img
          src={src}
          alt={name}
          className="size-full rounded-full object-cover"
          onError={() => setErroredSrc(src ?? null)}
        />
      ) : (
        <span
          role="img"
          aria-label={name}
          className={cn(
            "flex size-full items-center justify-center rounded-full font-medium",
            getColorFromName(name)
          )}
        >
          {getInitials(name)}
        </span>
      )}

      {status && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute right-0 bottom-0 rounded-full ring-2 ring-background",
            statusDotSize[size],
            statusStyles[status]
          )}
        />
      )}
    </span>
  );
}