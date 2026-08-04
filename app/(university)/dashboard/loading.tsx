import { Card } from "@/components/ui/Card";
import { Skeleton, StatCardSkeleton } from "@/components/ui/Skeleton";

/** Streamed while the dashboard summary is fetched. Mirrors the real layout. */
export default function DashboardLoading() {
  return (
    <>
      <div className="flex flex-col gap-4 pb-6">
        <Skeleton height="2rem" width="18rem" />
        <Skeleton height="1rem" width="14rem" />
      </div>

      <Skeleton height="1.25rem" width="16rem" className="mb-6" />

      <StatCardSkeleton count={4} />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" noPadding header={<Skeleton height="1rem" width="9rem" />}>
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="flex-1">
                  <Skeleton height="1rem" width="40%" />
                  <Skeleton height="0.75rem" width="60%" className="mt-1.5" />
                </div>
                <Skeleton height="1.5rem" width="2.5rem" />
              </div>
            ))}
          </div>
        </Card>

        <Card noPadding header={<Skeleton height="1rem" width="5rem" />}>
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="px-5 py-3">
                <Skeleton height="1rem" width="55%" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
