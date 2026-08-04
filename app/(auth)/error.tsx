"use client";

import { RouteError } from "@/components/shared/RouteError";

/**
 * Error boundary for the sign-in pages.
 *
 * Next.js requires this file to be a Client Component with this exact
 * signature, so it cannot itself be shared — the body is, via RouteError.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError scope="auth" error={error} reset={reset} />;
}
