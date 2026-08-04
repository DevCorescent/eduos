"use client";

import { RouteError } from "@/components/shared/RouteError";

/**
 * Error boundary for the faculty portal.
 *
 * Next.js requires this file to be a Client Component with this exact
 * signature, so it cannot itself be shared — the body is, via RouteError.
 */
export default function FacultyPortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError scope="faculty-portal" error={error} reset={reset} />;
}
