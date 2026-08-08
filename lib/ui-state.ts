// ============================================================================
// MODULE : UI State Resolution
// PURPOSE: Decide, in ONE place, which state a screen is in.
//
// WHY THIS IS CENTRAL AND NOT PER-PAGE
//   A panel with no rows can mean six different things, and the difference is
//   never cosmetic — it is what the reader concludes. Left to each page, the
//   decision drifts: two screens shipped an ErrorState for a 403, which invited
//   a retry that could never succeed and implied a fault where there was none.
//
//   That is the whole argument for this file. Every screen asks the same
//   function, so the mapping is auditable in one place and a correction lands
//   everywhere at once.
//
// THE MAPPING, AND THE REASONING BEHIND EACH LINE
//
//   200, rows > 0      SUCCESS
//
//   200, rows == 0     EMPTY
//                      The query worked and the answer is zero. Nothing is
//                      wrong, and the reader can often change it.
//
//   401                UNAUTHORIZED
//                      Not signed in, or the session ended. The fix is to sign
//                      in, so the screen offers that and never a retry.
//
//   403                UNAVAILABLE  ← the one most often got wrong
//                      A permission or capability boundary, NOT a failure.
//                      Nothing is broken and retrying cannot help. Telling the
//                      reader the service is down would be false, and offering
//                      Retry would be cruel.
//
//   404                Ambiguous, so the CALLER decides. A missing sub-resource
//                      ("this student has no personal record yet") is EMPTY; a
//                      missing endpoint is ERROR. Defaults to ERROR, because
//                      silently reporting a broken route as "no data" is the
//                      more damaging mistake of the two.
//
//   429                RATE_LIMITED
//                      Retrying immediately makes it worse, so the screen asks
//                      for a wait rather than offering a button.
//
//   5xx / network      ERROR
//                      Something is wrong and it may well clear. Retry belongs
//                      here and nowhere else.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//   It does not fetch, render, or decide copy. It maps a response to a state.
//   Keeping it free of React means it is trivially testable and usable from a
//   Server Component, a Client Component and a Server Action alike.
// ============================================================================

import type { ApiResponse } from "@/types";

/** Every state a data-backed screen can be in. */
export type UiState =
  | "loading"
  | "success"
  | "empty"
  | "error"
  | "unavailable"
  | "unauthorized"
  | "notFound"
  | "rateLimited";

export interface ResolveOptions {
  /**
   * Whether a SUCCESSFUL response carried no rows.
   *
   * Passed in rather than inferred: only the caller knows whether its payload
   * is a list, an object, or a count, and guessing here would mean this module
   * reaching into shapes it should not know about.
   */
  isEmpty?: boolean;
  /**
   * Treat a 404 as "nothing here" rather than as a fault.
   *
   * Set it when the resource legitimately may not exist — a student with no
   * personal record, a tenant with no subscription. Leave it unset when a 404
   * would mean the route itself is wrong.
   */
  treatNotFoundAsEmpty?: boolean;
}

/**
 * Map an API envelope to the state a screen should render.
 *
 * @example
 * const result = await listStudents()
 * const state = resolveUiState(result, { isEmpty: result.success && result.data.items.length === 0 })
 */
export function resolveUiState<T>(
  response: ApiResponse<T>,
  options: ResolveOptions = {}
): UiState {
  if (response.success) {
    return options.isEmpty ? "empty" : "success";
  }

  switch (response.code) {
    case "UNAUTHORIZED":
    case "AUTH_ERROR":
      return "unauthorized";

    // A capability boundary. See the module header for why this is not an error.
    case "FORBIDDEN":
      return "unavailable";

    case "NOT_FOUND":
      return options.treatNotFoundAsEmpty ? "empty" : "notFound";

    case "RATE_LIMITED":
      return "rateLimited";

    // TENANT_ERROR is a misrouted request rather than an outage, but there is
    // nothing the reader can do about it either way, so it takes the error
    // treatment and its message carries the detail.
    default:
      return "error";
  }
}

/**
 * Whether a state should offer the reader a retry.
 *
 * Exported so no component has to re-derive it, and so the answer cannot
 * disagree between two screens. Only genuinely transient states qualify: a
 * capability boundary and a missing sign-in are not retryable, and retrying a
 * rate limit is actively harmful.
 */
export function isRetryable(state: UiState): boolean {
  return state === "error";
}
