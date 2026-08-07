import { PageSkeleton } from "@/components/shared/PageSkeleton";

/**
 * Default loading state for this portal.
 *
 * Sits inside the portal layout, so the sidebar and top bar stay interactive
 * while only the content area waits. A page with a materially different shape
 * (a dashboard, a week grid) overrides this with its own loading.tsx.
 */
export default function Loading() {
  return <PageSkeleton />;
}
