// ============================================================================
// MODULE : Services — Data Source Switch
// PURPOSE: Decides, in one place, whether the service layer answers from the
//          mock fixtures or from the live routes under app/api.
//
//          This is the whole of the "backend integration" step. Flipping
//          NEXT_PUBLIC_USE_MOCKS to "false" moves every screen onto the real
//          API with no page edit, because a page only ever imports from
//          services/ and never learns which branch ran.
// ============================================================================

/**
 * True while screens are served from mock fixtures.
 *
 * Defaults to mock. The frontend is being built ahead of several backend
 * modules (courses, timetable, attendance, finance, certificates have no
 * routes yet), so mock is the only mode in which every screen renders today.
 * Opting *in* to the live API is therefore the explicit action, not opting out.
 *
 * NEXT_PUBLIC_ prefix is required: this is read during client-component
 * rendering as well as on the server, and Next.js only inlines prefixed vars
 * into the client bundle.
 */
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== "true";

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
