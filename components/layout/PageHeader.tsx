// components/layout/PageHeader.tsx

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Rendered on the right, typically a primary action Button. */
  action?: ReactNode;
  /** Rendered above the title, typically a Breadcrumb. */
  breadcrumb?: ReactNode;
  className?: string;
}

/**
 * Standard page-top block: optional breadcrumb, title + subtitle, and an
 * optional right-aligned action slot. A plain Server Component — no
 * interactivity of its own, so no client boundary needed even though it's
 * typically used alongside client components (the action button itself
 * might be one).
 *
 * @example
 * ```tsx
 * <PageHeader
 *   breadcrumb={<Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "Students" }]} />}
 *   title="Students"
 *   subtitle="Manage enrollment, records, and class assignments."
 *   action={<Button>Add Student</Button>}
 * />
 * ```
 */
export function PageHeader({ title, subtitle, action, breadcrumb, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4 pb-6", className)}>
      {breadcrumb}

      {/* Stacked below `sm`, side by side above it. A title and an action on
          one row is right on a laptop and wrong on a phone, where a long title
          and a button called "Onboard University" leave each other a third of
          the width. `min-w-0` lets the heading shrink and wrap rather than
          pushing the action off the edge at intermediate sizes. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-heading sm:text-2xl">
            {title}
          </h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>

        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}