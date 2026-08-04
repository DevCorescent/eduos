import { Card } from "@/components/ui/Card";
import { Skeleton, StatCardSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

/** Streamed while the subscriptions page fetches. Mirrors its real layout. */
export default function SubscriptionsLoading() {
  return (
    <>
      <div className="flex flex-col gap-4 pb-6">
        <Skeleton height="2rem" width="14rem" />
        <Skeleton height="1rem" width="22rem" />
      </div>

      <StatCardSkeleton count={3} />

      <div className="mb-4 mt-6 flex gap-3">
        <Skeleton height="2.5rem" width="9rem" />
        <Skeleton height="2.5rem" width="9rem" />
      </div>

      <Card noPadding>
        <TableSkeleton rows={8} columns={6} />
      </Card>
    </>
  );
}
