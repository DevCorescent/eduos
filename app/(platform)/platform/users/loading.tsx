import { Card } from "@/components/ui/Card";
import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";

/**
 * Streamed while the platform users page fetches on the server.
 *
 * Next.js renders this instantly from the route's Suspense boundary, so the
 * shell and navigation are interactive before any data arrives. The skeleton
 * mirrors the real layout — header, search box, six-column table — so the page
 * does not jump when rows land.
 */
export default function PlatformUsersLoading() {
  return (
    <>
      <div className="flex flex-col gap-4 pb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Skeleton height="2rem" width="12rem" />
            <Skeleton height="1rem" width="22rem" className="mt-2" />
          </div>
          <Skeleton height="2.5rem" width="9rem" />
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Skeleton height="2.5rem" className="sm:max-w-xs sm:flex-1" />
      </div>

      <Card noPadding>
        <TableSkeleton rows={8} columns={6} />
      </Card>
    </>
  );
}
