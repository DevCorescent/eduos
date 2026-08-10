// ============================================================================
// MODULE : Student Portal — Template UI (PRD §57)
// LAYER  : Presentation
// PURPOSE: Label-over-value pairs in a responsive grid — the "Enrollment
//          Details" block in the reference design (academic year, semester,
//          status, programme, department, batch).
//
// WHY A COMPONENT RATHER THAN A <dl> WRITTEN INLINE
//   Because the empty case has a rule. A field the backend could not answer
//   must render an em dash, not disappear and not read "null" — a student
//   looking at their own record needs to see that the row exists and is blank,
//   which is a different fact from the row not applying to them. Centralising
//   that here means no caller has to remember it.
// ============================================================================

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface DetailItem {
  label: string;
  /**
   * null and undefined both render as "—".
   *
   * Pass a formatted string; this component does no locale work, because the
   * caller is the only place that knows whether a number is a currency, a
   * count or a percentage.
   */
  value: ReactNode | null | undefined;
}

export interface DetailGridProps {
  items: readonly DetailItem[];
  /** Columns at the `sm` breakpoint and above. @default 2 */
  columns?: 2 | 3;
  className?: string;
}

export function DetailGrid({ items, columns = 2, className }: DetailGridProps) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1 gap-x-6 gap-y-4",
        columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {item.label}
          </dt>
          <dd className="mt-1 truncate text-sm font-medium text-foreground">
            {/* Empty string is treated as absent too: a backend that returns ""
                for an unset column is claiming a value it does not have. */}
            {item.value === null || item.value === undefined || item.value === ""
              ? "—"
              : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
