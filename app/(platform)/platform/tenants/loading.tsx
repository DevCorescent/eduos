/* eslint-disable react-hooks/purity, react-hooks/refs -- TEMPORARY DIAGNOSTIC
   INSTRUMENTATION. console.log and Date.now() are impure, and the React
   Compiler is right to refuse them during render. They are here to trace a
   reported "dashboard never loads" and are meant to be removed with the rest of
   the tracing once the cause is settled. Nothing below changes behaviour. */
import { Card } from "@/components/ui/Card";
import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";

/**
 * Streamed while the tenants page fetches on the server.
 *
 * Next.js renders this instantly from the route's Suspense boundary, so the
 * shell and navigation are interactive before any data arrives. The skeleton
 * mirrors the real layout — header, toolbar, five-column table — so the page
 * does not jump when rows land.
 */
export default function TenantsLoading() {
  console.log("[SUSPENSE] fallback START for (platform)/platform/tenants");
  return (
    <>
      <div className="flex flex-col gap-4 pb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Skeleton height="2rem" width="12rem" />
            <Skeleton height="1rem" width="20rem" className="mt-2" />
          </div>
          <Skeleton height="2.5rem" width="11rem" />
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Skeleton height="2.5rem" className="sm:max-w-xs sm:flex-1" />
        <Skeleton height="2.5rem" width="9rem" />
        <Skeleton height="2.5rem" width="9rem" />
      </div>

      <Card noPadding>
        <TableSkeleton rows={8} columns={5} />
      </Card>
    </>
  );
}
