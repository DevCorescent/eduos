// ============================================================================
// MODULE : Services — Data Source Switch
// PURPOSE: Decides, in one place, whether the service layer answers from the
//          mock fixtures or from the live routes under app/api.
//
//          This is the whole of the "backend integration" step. A page only
//          ever imports from services/ and never learns which branch ran, so
//          the switch below moves every screen at once with no page edit.
// ============================================================================

/**
 * True while screens are served from mock fixtures instead of app/api.
 *
 * Mocks are OPT-IN: the value must be exactly "true" to enable them. Every
 * other value — "false", "", or unset — serves the live API.
 *
 *   NEXT_PUBLIC_USE_MOCKS="true"   -> mock fixtures   (local UI work only)
 *   NEXT_PUBLIC_USE_MOCKS="false"  -> live API
 *   unset                          -> live API
 *
 * Opt-in matters because the failure is silent. Under the previous
 * `!== "true"` test the flag meant the opposite of its own name: an
 * NEXT_PUBLIC_USE_MOCKS="false" — the natural way to write "no mocks" — left
 * mocks ON, and an unset variable did too. A deployment with no config
 * therefore served fabricated data from mock/ while looking completely
 * healthy. Defaulting to the live API makes a misconfiguration fail loudly
 * (an API error) instead of quietly (plausible fake rows).
 *
 * NEXT_PUBLIC_ prefix is required: this is read during client-component
 * rendering as well as on the server, and Next.js only inlines prefixed vars
 * into the client bundle.
 */
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

/**
 * Absolute origin for server-side fetches.
 *
 * A Server Component has no notion of "the current origin", so a relative
 * "/api/students" throws there — it must be absolute. Client components are
 * unaffected: the browser resolves relative URLs against the page, and the
 * empty-string fallback below leaves them relative on purpose.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

/**
 * Artificial delay applied to mock responses, in milliseconds.
 *
 * Non-zero on purpose. Mock data that resolves instantly hides every loading
 * state, skeleton and pending-button behaviour the UI is required to have, so
 * bugs in them would not surface until the real API was connected. This keeps
 * those paths on screen during development.
 */
export const MOCK_LATENCY_MS = 300;
