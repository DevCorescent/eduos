// components/shared/ErrorState.tsx

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE SECOND STATE: the request failed and retrying is reasonable.
 *
 * Distinct from EmptyState (the request succeeded and the answer is zero) and
 * from UnavailableState (there is no request to make, because the capability is
 * not built). See lib/ui-state.ts for the full mapping and why each line of it
 * is the way it is. Copy here should describe a SERVICE that is unavailable,
 * never data that is absent.
 */
export interface ErrorStateProps {
  /** Headline. @default "Something went wrong" */
  title?: string;
  /** The API's own message — `error` from the failure envelope. */
  description?: string;
  /** Typically a retry link or a "back to list" action. */
  action?: ReactNode;
  className?: string;
}

/**
 * Shown in place of content when a fetch returns `success: false`.
 *
 * Distinct from EmptyState, and the distinction matters to the reader: empty
 * means the request worked and there is genuinely nothing to show, error means
 * the answer is unknown. Rendering "No tenants yet" after a failed request
 * tells the user something false.
 *
 * The API's own message is surfaced rather than replaced with generic copy,
 * because it is the specific one — "Tenant slug already in use" is actionable
 * where "Something went wrong" is not. The client layer already guarantees a
 * human-readable string for transport failures too, so there is no raw
 * exception text to leak here.
 *
 * A Server Component: pages render it directly from a failed server-side fetch,
 * with no client boundary.
 *
 * @example
 * ```tsx
 * const result = await listTenants(params)
 * if (!result.success) {
 *   return <ErrorState title="Couldn't load tenants" description={result.error} />
 * }
 * ```
 */
export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      // Announced when it replaces content after a failed action. "polite" waits
      // for the current utterance rather than cutting it off.
      role="alert"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-danger/20 bg-danger-bg px-6 py-12 text-center",
        className
      )}
    >
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger-bg-foreground">
        <AlertTriangle className="size-7" aria-hidden="true" />
      </div>

      <h3 className="text-sm font-semibold text-danger-bg-foreground">{title}</h3>

      {description && (
        <p className="mt-1 max-w-md text-sm text-danger-bg-foreground/80">{description}</p>
      )}

      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
