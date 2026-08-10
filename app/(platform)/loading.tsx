import { PageSkeleton } from "@/components/shared/PageSkeleton";

/**
 * Default loading state for the platform console.
 *
 * Sits inside the portal layout, so the sidebar and top bar stay interactive
 * while only the content area waits. Added for parity: every other portal had
 * one, and without it a slow platform page showed the previous screen frozen
 * with no indication that anything was happening.
 */
export default function Loading() {
  return <PageSkeleton />;
}
