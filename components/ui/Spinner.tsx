// components/ui/Spinner.tsx

import type { SVGAttributes } from "react";
import { cn } from "@/lib/utils";

export interface SpinnerProps extends SVGAttributes<SVGSVGElement> {
  /** Physical size. @default "md" */
  size?: "sm" | "md" | "lg";
  /** Accessible label announced to screen readers. @default "Loading" */
  label?: string;
}

const sizeStyles = {
  sm: "size-4",
  md: "size-6",
  lg: "size-8",
};

/**
 * Indeterminate loading indicator. Used standalone (page/section loading)
 * or embedded inside other components (Button, Input, Table) for inline
 * busy states — those components import this rather than redrawing their
 * own spinner markup.
 *
 * @example Standalone
 * ```tsx
 * <Spinner size="lg" label="Loading students..." />
 * ```
 */
export function Spinner({ size = "md", label = "Loading", className, ...props }: SpinnerProps) {
  return (
    <svg
      role="status"
      aria-label={label}
      viewBox="0 0 24 24"
      fill="none"
      className={cn("animate-spin text-current", sizeStyles[size], className)}
      {...props}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}