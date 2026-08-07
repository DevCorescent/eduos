// ============================================================================
// MODULE : Services — Data Source Configuration
// PURPOSE: The one setting the service layer needs from the environment.
//
//          There is no mock/live switch any more. Every screen is served by
//          the routes under app/api, so a misconfiguration fails loudly with
//          an API error rather than quietly with plausible fabricated rows —
//          which is what the old NEXT_PUBLIC_USE_MOCKS flag made possible.
// ============================================================================

/**
 * Absolute origin for server-side fetches.
 *
 * A Server Component has no notion of "the current origin", so a relative
 * "/api/students" throws there — it must be absolute. Client components are
 * unaffected: the browser resolves relative URLs against the page, and the
 * empty-string fallback below leaves them relative on purpose.
 *
 * services/client.ts prefers the incoming request's own host over this value,
 * so the tenant subdomain is preserved; this is the fallback for calls made
 * outside a request scope.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";
