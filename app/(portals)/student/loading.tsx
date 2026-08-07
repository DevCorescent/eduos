/* eslint-disable react-hooks/purity, react-hooks/refs -- TEMPORARY DIAGNOSTIC
   INSTRUMENTATION. console.log and Date.now() are impure, and the React
   Compiler is right to refuse them during render. They are here to trace a
   reported "dashboard never loads" and are meant to be removed with the rest of
   the tracing once the cause is settled. Nothing below changes behaviour. */
import { PageSkeleton } from "@/components/shared/PageSkeleton";

/**
 * Default loading state for this portal.
 *
 * Sits inside the portal layout, so the sidebar and top bar stay interactive
 * while only the content area waits. A page with a materially different shape
 * (a dashboard, a week grid) overrides this with its own loading.tsx.
 */
export default function Loading() {
  console.log("[SUSPENSE] fallback START for (portals)/student");
  return <PageSkeleton />;
}
