// ============================================================================
// MODULE : Student Portal — Template UI (PRD §57)
// LAYER  : Presentation
// PURPOSE: A titled section with an optional link on the right — the repeating
//          container in both reference designs ("Attendance … View Schedule",
//          "Recent Activities", "Fees & Finance").
//
// WHY NOT JUST components/ui/Card WITH A HEADER
//   Card takes a `header` ReactNode, so every caller hand-rolls the same
//   flex row with the same heading size and the same right-aligned link. Six
//   copies of that on one page is six chances for one of them to drift. This
//   names the pattern once and takes `title` and `action` as data.
//
//   It composes Card rather than replacing it, so the surface treatment stays
//   identical to every other panel in the product.
// ============================================================================

import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";

export interface PanelProps {
  title: string;
  /** Optional right-aligned link, e.g. "Full report". */
  action?: { label: string; href: string };
  /**
   * Removes body padding, for a panel filled edge-to-edge by a list or table.
   * @default false
   */
  noPadding?: boolean;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, action, noPadding = false, children, className }: PanelProps) {
  return (
    <Card
      className={className}
      noPadding={noPadding}
      header={
        <div className="flex items-center justify-between gap-3">
          {/* h2 because a portal page's own <h1> is the PageHeader title. The
              heading level is what a screen-reader user navigates by, so it is
              a structural decision, not a size one. */}
          <h2 className="truncate text-sm font-semibold text-heading">{title}</h2>

          {action && (
            <Link
              href={action.href}
              className="shrink-0 rounded-md text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {action.label}
            </Link>
          )}
        </div>
      }
    >
      {children}
    </Card>
  );
}
