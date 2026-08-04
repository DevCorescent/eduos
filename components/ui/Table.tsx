// components/ui/Table.tsx

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./Spinner";

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  /** Custom cell renderer. Defaults to `String(row[key])`. */
  render?: (row: T) => ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  /** Unique key extractor for each row. */
  rowKey: (row: T) => string | number;
  /** Alternates row background color for readability on wide tables. @default true */
  striped?: boolean;
  /** Shows a spinner overlay in place of rows. */
  isLoading?: boolean;
  /** Rendered when `data` is empty and not loading. */
  emptyState?: ReactNode;
  /** Fires when a row is clicked — rows become keyboard-focusable buttons when set. */
  onRowClick?: (row: T) => void;
}

const alignStyles = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/**
 * Data table built on native `<table>` markup — gets correct semantics
 * (row/column relationships) for screen readers for free, which a div-grid
 * table would have to reconstruct with ARIA roles.
 *
 * Generic over row type `T`: `columns` and `rowKey` are typed against it,
 * so consumers get full autocomplete and type-checking on `row[key]`
 * without casting.
 *
 * @example
 * ```tsx
 * <Table
 *   columns={[
 *     { key: "name", header: "Name" },
 *     { key: "status", header: "Status", render: (s) => <Badge variant={statusVariant(s.status)}>{s.status}</Badge> },
 *   ]}
 *   data={students}
 *   rowKey={(s) => s.id}
 *   emptyState={<EmptyState title="No students yet" />}
 * />
 * ```
 */
export function Table<T>({
  columns,
  data,
  rowKey,
  striped = true,
  isLoading = false,
  emptyState,
  onRowClick,
}: TableProps<T>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  "px-4 py-3 font-medium text-muted-foreground",
                  alignStyles[col.align ?? "left"],
                  col.className
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center">
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Spinner size="sm" />
                  <span>Loading...</span>
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10">
                {emptyState ?? (
                  <p className="text-center text-muted-foreground">No data available</p>
                )}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                className={cn(
                  "border-b border-border last:border-0",
                  striped && i % 2 === 1 && "bg-muted/40",
                  onRowClick &&
                    "cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn("px-4 py-3 text-foreground", alignStyles[col.align ?? "left"], col.className)}
                  >
                    {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}