import { Card } from "@/components/ui/Card";
import { Skeleton, StatCardSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

/** Streamed while the platform dashboard fetches. */
export default function DashboardLoading() {
  return (
    <>
      <div className="flex flex-col gap-4 pb-6">
        <Skeleton height="2rem" width="10rem" />
        <Skeleton height="1rem" width="20rem" />
      </div>

      <StatCardSkeleton count={4} />

      <Card className="mt-6" noPadding header={<Skeleton height="1rem" width="10rem" />}>
        <TableSkeleton rows={6} columns={5} />
      </Card>
    </>
  );
}
