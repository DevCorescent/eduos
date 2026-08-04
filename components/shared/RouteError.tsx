"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "./ErrorState";

export interface RouteErrorProps {
  /** The scope this boundary covers, e.g. "university". Used in the log tag. */
  scope: string;
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * The body of every route-group error boundary.
 *
 * Next.js requires each `error.tsx` to be its own Client Component with the
 * exact `{ error, reset }` signature, so the files themselves cannot be shared
 * — but their contents can, and five copies of the same logging-and-retry block
 * is five places for the copy to drift.
 *
 * This catches what a page's own `!result.success` branch does not: a *thrown*
 * error rather than a returned failure envelope. Both paths exist deliberately
 * — an expected failure renders in place with the page intact, an unexpected
 * one lands here.
 */
export function RouteError({ scope, error, reset }: RouteErrorProps) {
  useEffect(() => {
    // Reaches the browser console in development and the server logs in
    // production, where `digest` is the only handle on the real stack — React
    // withholds the message itself from the client to avoid leaking internals.
    console.error(`[${scope}]`, error);
  }, [scope, error]);

  return (
    <ErrorState
      title="Something went wrong"
      description={error.message || "This page could not be loaded. Try again in a moment."}
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
