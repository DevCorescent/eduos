import { Card } from "@/components/ui/Card";
import { Skeleton, StatCardSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

export interface PageSkeletonProps {
  /** Number of stat cards to reserve. 0 omits the row. @default 0 */
  stats?: number;
  /** Reserve space for a search/filter toolbar. @default true */
  toolbar?: boolean;
  rows?: number;
  columns?: number;
}

/**
 * The default loading state for a list page.
 *
 * Placed at route-group level, this renders *inside* the portal layout — the
 * sidebar and top bar stay interactive while only the content area waits, which
 * is the whole point of a boundary there rather than one per page.
 *
 * It mirrors the real page's rhythm (header, toolbar, table) so nothing jumps
 * when data lands. A centred spinner would reserve no space and let the layout
 * snap into place on arrival.
 */
export function PageSkeleton({
  stats = 0,
  toolbar = true,
  rows = 8,
  columns = 5,
}: PageSkeletonProps) {
  return (
    <div role="status" aria-label="Loading page">
      <div className="flex flex-col gap-4 pb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Skeleton height="2rem" width="14rem" />
            <Skeleton height="1rem" width="22rem" className="mt-2" />
          </div>
          <Skeleton height="2.5rem" width="10rem" />
        </div>
      </div>

      {stats > 0 && <StatCardSkeleton count={stats} />}

      {toolbar && (
        <div className={stats > 0 ? "mb-4 mt-6 flex flex-col gap-3 sm:flex-row" : "mb-4 flex flex-col gap-3 sm:flex-row"}>
          <Skeleton height="2.5rem" className="sm:max-w-xs sm:flex-1" />
          <Skeleton height="2.5rem" width="9rem" />
        </div>
      )}

      <Card noPadding>
        <TableSkeleton rows={rows} columns={columns} />
      </Card>
    </div>
  );
}
