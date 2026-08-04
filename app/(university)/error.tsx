"use client";

import { RouteError } from "@/components/shared/RouteError";

/**
 * Error boundary for every screen in the university portal.
 *
 * Next.js requires this file to be a Client Component with this exact
 * signature, so it cannot itself be shared — the body is, via RouteError.
 */
export default function UniversityError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError scope="university" error={error} reset={reset} />;
}
