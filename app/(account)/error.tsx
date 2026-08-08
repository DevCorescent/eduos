"use client";

import { RouteError } from "@/components/shared/RouteError";

/**
 * Error boundary for the account screens.
 *
 * Next.js requires this file to be a Client Component with this exact
 * signature, so it cannot itself be shared — the body is, via RouteError.
 * Added for parity: a failure here previously escaped to the root, which had
 * no boundary of its own.
 */
export default function AccountError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError scope="account" error={error} reset={reset} />;
}
