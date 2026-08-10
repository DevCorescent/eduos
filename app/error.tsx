"use client";

import { RouteError } from "@/components/shared/RouteError";

/**
 * Error boundary for the routes that sit outside every route group — "/" and
 * the root not-found.
 *
 * Without it, a failure in the root router (a session read that throws before
 * it can redirect) had nothing between it and global-error.tsx, which replaces
 * the whole document and cannot use the design tokens. This keeps that last
 * resort for what it is actually for: a root LAYOUT failure.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError scope="root" error={error} reset={reset} />;
}
