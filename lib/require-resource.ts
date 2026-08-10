// ============================================================================
// MODULE : Resource Unwrapping for detail pages
// PURPOSE: Turn a single-resource envelope into the resource, or into the
//          correct Next.js outcome — without the page interpreting HTTP.
//
// WHY THIS IS SEPARATE FROM lib/ui-state.ts
//   That module is deliberately framework-agnostic: no React, no Next, usable
//   from a route handler or a plain test. This one calls notFound(), which is
//   Next-specific by definition. Keeping them apart is what lets the
//   classification stay portable while the framework behaviour lives where it
//   belongs.
//
// WHY DETAIL PAGES ARE DIFFERENT FROM LIST PAGES
//   A list page renders a state inline — an empty table, an unavailable panel.
//   A detail page has no such option: if the record is not there, there is no
//   page to render, and Next's own not-found boundary is the right answer.
//   Every such page had therefore grown the same three lines:
//
//     if (!result.success) {
//       if (result.code === "NOT_FOUND") notFound();
//       throw new Error(result.error);
//     }
//
//   which is HTTP interpretation sitting in the presentation layer, repeated
//   nine times and free to drift. It now happens once, here, driven by
//   resolveUiState so the meaning of each code is decided in exactly one place.
//
// THE DISTINCTION THIS PRESERVES
//   notFound() says the record does not exist. Throwing says something broke.
//   Conflating them would tell a user a tenant had been deleted during what was
//   really a transient outage — which is why this maps 404 and only 404 to the
//   not-found boundary, and lets every other failure reach the error boundary
//   with its message intact.
// ============================================================================

import "server-only";

import { notFound } from "next/navigation";
import type { ApiResponse } from "@/types";
import { resolveUiState } from "@/lib/ui-state";

/**
 * Return the resource, or hand control to the appropriate Next.js boundary.
 *
 * @param result  the envelope from a single-resource service call
 * @param subject what is being fetched, for the thrown message — "student",
 *                "tenant". Used only when the failure is not a 404.
 *
 * @example
 * const student = unwrapResource(await getStudent(id), "student")
 * // `student` is the resource; the not-found and error boundaries handle the rest
 */
export function unwrapResource<T>(result: ApiResponse<T>, subject: string): T {
  const state = resolveUiState(result);

  if (state === "success") {
    // Narrowing the union is the one place `.success` is still read, and it is
    // read here so that no page has to.
    return (result as Extract<ApiResponse<T>, { success: true }>).data;
  }

  if (state === "notFound") {
    notFound();
  }

  // Everything else — 403, 5xx, a network failure — is a genuine fault for a
  // detail route, and the error boundary is the right place for it. The API's
  // own message is preserved rather than replaced with a generic one.
  throw new Error(
    result.success ? `Could not load ${subject}` : result.error
  );
}
