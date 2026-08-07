/* eslint-disable react-hooks/purity, react-hooks/refs -- TEMPORARY DIAGNOSTIC
   INSTRUMENTATION. console.log and Date.now() are impure, and the React
   Compiler is right to refuse them during render. They are here to trace a
   reported "dashboard never loads" and are meant to be removed with the rest of
   the tracing once the cause is settled. Nothing below changes behaviour. */
import { Card } from "@/components/ui/Card";
import { Skeleton, StatCardSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

/** Streamed while the subscriptions page fetches. Mirrors its real layout. */
export default function SubscriptionsLoading() {
  console.log("[SUSPENSE] fallback START for (platform)/platform/subscriptions");
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
