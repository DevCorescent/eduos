import type { ReactNode } from "react";
import { Ban, Clock, LogIn } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { UnavailableState } from "@/components/shared/UnavailableState";
import { buttonStyles } from "@/components/ui/Button";
import type { UiState } from "@/lib/ui-state";

/**
 * Renders the non-success states, so a screen never chooses a treatment itself.
 *
 * Pairs with resolveUiState in lib/ui-state.ts: that decides WHICH state, this
 * decides how it looks. Splitting them is what lets the mapping be unit-tested
 * without React and the presentation be changed without touching the mapping.
 *
 * A screen's whole non-success branch becomes:
 *
 *   const state = resolveUiState(result, { isEmpty: rows.length === 0 })
 *   if (state !== "success") {
 *     return <StateView state={state} subject="assignments" message={…} />
 *   }
 *
 * `subject` is the noun the copy is built from — "assignments", "fee demands".
 * Passing a noun rather than a whole sentence is what keeps the phrasing
 * consistent across sixty screens: the wording lives here, and a page supplies
 * only the thing it is about.
 */
export interface StateViewProps {
  state: Exclude<UiState, "success" | "loading">;
  /** Plural noun for the records this screen shows, e.g. "assignments". */
  subject: string;
  /** The failure detail from the API envelope, shown for error-shaped states. */
  message?: string;
  /**
   * Overrides the generated copy for the empty and unavailable states, where a
   * screen often knows something the noun alone cannot express.
   */
  title?: string;
  description?: string;
  icon?: ReactNode;
  /** Rendered under an empty state — usually the action that would fill it. */
  action?: ReactNode;
  /**
   * Passed through to whichever state is rendered.
   *
   * Exists for the nested case: a secondary panel inside a card that has its
   * own border already, where the default framing would draw a second one.
   */
  className?: string;
}

export function StateView({
  state,
  subject,
  message,
  title,
  description,
  icon,
  action,
  className,
}: StateViewProps) {
  switch (state) {
    case "empty":
      return (
        <EmptyState
          icon={icon}
          title={title ?? `No ${subject} yet`}
          description={description ?? `You don't have any ${subject} right now.`}
          action={action}
          className={className}
        />
      );

    case "unavailable":
      return (
        <UnavailableState
          icon={icon ?? <Ban className="size-6" aria-hidden="true" />}
          className={className}
          title={title ?? `${capitalise(subject)} are not available to you`}
          description={
            description ??
            `This feature is not available for your role or institution. Nothing is wrong — the capability simply is not open to this account.`
          }
        />
      );

    case "unauthorized":
      // The only state that offers a way forward rather than an explanation:
      // the reader can fix this one, and the fix is a single link.
      return (
        <UnavailableState
          className={className}
          icon={<LogIn className="size-6" aria-hidden="true" />}
          title="Your session has ended"
          description="Sign in again to continue."
        >
          <Link href="/login" className={buttonStyles({ variant: "primary", size: "sm" })}>
            Sign in
          </Link>
        </UnavailableState>
      );

    case "rateLimited":
      // Deliberately no retry control. The reader has already made too many
      // requests, and a button is an invitation to make another.
      return (
        <UnavailableState
          className={className}
          icon={<Clock className="size-6" aria-hidden="true" />}
          title="Too many requests"
          description={
            message ??
            "You have made a lot of requests in a short time. Wait a moment and reload the page."
          }
        />
      );

    case "notFound":
      return (
        <ErrorState
          className={className}
          title={`We couldn't find those ${subject}`}
          description={message ?? "The record may have been removed."}
        />
      );

    case "error":
    default:
      return (
        <ErrorState
          className={className}
          title={`${capitalise(subject)} service is currently unavailable`}
          description={message ?? "Please try again in a moment."}
        />
      );
  }
}

/** "fee demands" -> "Fee demands". Sentence case, not title case. */
function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
