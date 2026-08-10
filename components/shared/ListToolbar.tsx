// components/shared/ListToolbar.tsx

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ListToolbarProps {
  /** Search field, typically <ListSearch />. Given the flexible width. */
  search?: ReactNode;
  /** Filter dropdowns, typically one or more <ListFilter />. */
  filters?: ReactNode;
  /** Right-aligned primary action, e.g. an "Onboard university" button. */
  action?: ReactNode;
  className?: string;
}

/**
 * The row of controls above a list: search, filters, primary action.
 *
 * A Server Component holding only layout — the interactive parts are passed in
 * as children and carry their own client boundaries. That keeps the client
 * bundle to the fields that genuinely need it rather than the whole toolbar.
 *
 * The responsive rule is that search takes the remaining width while filters
 * keep their intrinsic size, and below `sm` everything stacks: three controls
 * side by side on a phone leaves each too narrow to read its own label.
 *
 * @example
 * ```tsx
 * <ListToolbar
 *   search={<ListSearch placeholder="Search tenants…" />}
 *   filters={<ListFilter paramKey="status" label="Status" options={statusOptions} hideLabel />}
 *   action={<ProvisionUniversityLink />}
 * />
 * ```
 */
export function ListToolbar({ search, filters, action, className }: ListToolbarProps) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-1 sm:flex-row sm:items-center">
        {search && <div className="sm:max-w-xs sm:flex-1">{search}</div>}
        {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
      </div>

      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
