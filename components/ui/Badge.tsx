// components/ui/Badge.tsx

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "success"   // Active, Approved, Completed
  | "warning"   // Pending, In Review
  | "danger"    // Suspended, Failed, Rejected
  | "neutral"   // Inactive, Draft, Archived
  | "info";     // Invited, Processing

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Semantic status this badge represents. @default "neutral" */
  variant?: BadgeVariant;
  /** Physical size. @default "md" */
  size?: "sm" | "md";
  /** Shows a small status dot before the label. */
  withDot?: boolean;
  /** Badge content — typically short status text. */
  children: ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  success: "bg-success-bg text-success-bg-foreground",
  warning: "bg-warning-bg text-warning-bg-foreground",
  danger: "bg-danger-bg text-danger-bg-foreground",
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info-bg text-info-bg-foreground",
};

const dotStyles: Record<BadgeVariant, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-muted-foreground",
  info: "bg-info",
};

const sizeStyles = {
  sm: "h-5 px-1.5 text-[11px] gap-1",
  md: "h-6 px-2 text-xs gap-1.5",
};

/**
 * Small status chip for representing entity state — e.g. a student's
 * enrollment status (`Active`, `Suspended`), an assignment's state
 * (`Draft`, `Published`), or an invite's status (`Pending`, `Accepted`).
 *
 * Deliberately not a general-purpose color chip: `variant` maps to a
 * fixed semantic palette (success/warning/danger/neutral/info) rather
 * than accepting arbitrary colors. This keeps status meaning consistent
 * across the whole product — "danger" always reads as danger, everywhere,
 * instead of every screen picking its own red.
 *
 * Uses the dedicated `*-bg` / `*-bg-foreground` token pairs (not solid
 * color + opacity) because those pairs are specifically tuned for
 * dark-mode contrast — the solid semantic colors intentionally stay
 * unchanged in dark mode, so `bg-success/10` would wash out at night.
 *
 * @example Basic
 * ```tsx
 * <Badge variant="success">Active</Badge>
 * <Badge variant="neutral">Inactive</Badge>
 * <Badge variant="danger">Suspended</Badge>
 * ```
 *
 * @example With status dot
 * ```tsx
 * <Badge variant="warning" withDot>Pending Review</Badge>
 * ```
 *
 * @example In a table cell
 * ```tsx
 * <Badge variant={student.status === "active" ? "success" : "neutral"}>
 *   {student.status}
 * </Badge>
 * ```
 */
export function Badge({
  variant = "neutral",
  size = "md",
  withDot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium whitespace-nowrap",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {withDot && (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", dotStyles[variant])}
        />
      )}
      {children}
    </span>
  );
}