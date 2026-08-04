"use client";

import { RouteError } from "@/components/shared/RouteError";

/**
 * Error boundary for every screen in the platform portal.
 *
 * Next.js requires this file to be a Client Component with this exact
 * signature, so it cannot itself be shared — the body is, via RouteError.
 */
export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError scope="platform" error={error} reset={reset} />;
}
