// components/layout/EmptyState.tsx

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** Icon or illustration, rendered above the title. */
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Typically a Button — "Add Student", "Create Class", etc. */
  action?: ReactNode;
  className?: string;
}

/**
 * Placeholder shown in place of a list/table/grid when there's no data —
 * distinct from a loading state (use Spinner/skeletons for that) and
 * from an error state (use Alert for that). This is specifically "the
 * request succeeded and there's genuinely nothing here yet."
 *
 * @example In a Table's emptyState slot
 * ```tsx
 * <Table
 *   columns={columns}
 *   data={students}
 *   rowKey={(s) => s.id}
 *   emptyState={
 *     <EmptyState
 *       icon={<UsersIcon className="size-10" />}
 *       title="No students yet"
 *       description="Students you add will show up here."
 *       action={<Button size="sm">Add Student</Button>}
 *     />
 *   }
 * />
 * ```
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && (
        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground [&>svg]:size-7">
          {icon}
        </div>
      )}

      <h3 className="text-sm font-semibold text-heading">{title}</h3>

      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}

      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}