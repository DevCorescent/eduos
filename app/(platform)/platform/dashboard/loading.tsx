/* eslint-disable react-hooks/purity, react-hooks/refs -- TEMPORARY DIAGNOSTIC
   INSTRUMENTATION. console.log and Date.now() are impure, and the React
   Compiler is right to refuse them during render. They are here to trace a
   reported "dashboard never loads" and are meant to be removed with the rest of
   the tracing once the cause is settled. Nothing below changes behaviour. */
import { Card } from "@/components/ui/Card";
import { Skeleton, StatCardSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

/** Streamed while the platform dashboard fetches. */
export default function DashboardLoading() {
  console.log("[SUSPENSE] fallback START for (platform)/platform/dashboard");
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
