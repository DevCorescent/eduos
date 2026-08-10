// ============================================================================
// MODULE : Student Portal — Template UI (PRD §57)
// LAYER  : Presentation
// PURPOSE: Icon · title · subtitle · right-hand meta — the row shape the
//          reference designs use for "Recent Activities" and for a deadline
//          list, and the one this portal repeats most.
//
// THE `meta` SLOT TAKES A NODE, NOT A STRING
//   An overdue deadline has to render in danger and a future one in muted
//   grey. Passing a formatted node lets the caller decide that with the domain
//   knowledge it already has, instead of this component growing a `variant`
//   prop for every meaning a right-hand value can carry.
// ============================================================================

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ActivityRowProps {
  icon?: ReactNode;
  title: string;
  /** Rendered in mono when it is an identifier — the caller passes the node. */
  subtitle?: ReactNode;
  /** Right-aligned value: a date, a status, an amount. */
  meta?: ReactNode;
  className?: string;
}

export function ActivityRow({ icon, title, subtitle, meta, className }: ActivityRowProps) {
  return (
    <li className={cn("flex items-center gap-3 px-5 py-3.5", className)}>
      {icon && (
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          {icon}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{title}</p>
        {subtitle && (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>

      {meta && <span className="shrink-0 text-xs">{meta}</span>}
    </li>
  );
}
