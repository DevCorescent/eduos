// ============================================================================
// MODULE : Platform — Tenant status, platform-session handling
// LAYER  : Regression Test
// PURPOSE: Pin the fix for tester issue #9 — "changing a tenant's status shows
//          Unauthorized" — and, just as importantly, pin the 403 DISTINCTION
//          that fix must not erase.
//
// THE BUG, EXACTLY
//   TenantStatusControl has two ways to write a status:
//
//     Active -> Trial                 the "Apply" button   -> apply()
//     Active -> Suspended / Cancelled the confirmation dialog
//
//   apply() handled a 401 by explaining that the platform session had expired
//   and offering a Sign in link. The dialog called updateTenant() ITSELF, so it
//   never reached that handling and rendered the raw envelope message instead —
//   a bare "Unauthorized" inside the dialog, with no way forward. Two of the
//   three transitions the tester exercised took that second path, which is why
//   the issue survived a fix that looked complete.
//
//   The fix is not a second copy of the handling. It is ONE write: the dialog's
//   onConfirm now calls apply(), so the two paths cannot drift again.
//
// WHY 401 AND 403 ARE ASSERTED SEPARATELY
//   requirePlatformAdmin answers 401 when nobody is signed in — for a platform
//   operator that means the one-hour edu_platform cookie has expired, and
//   signing in again fixes it. It answers 403 when the caller IS somebody but
//   is not a platform admin: a tenant user, a deactivated operator, or one
//   whose PLATFORM_ADMIN grant was revoked. Signing in again fixes none of
//   those. Folding 403 into "your session expired" would describe a real
//   permission refusal as a timeout and send the operator round a loop that
//   cannot end, so the third test below asserts it has not been folded in.
//
// WHY THIS TEST READS THE SOURCE
//   The project has no React testing library and no DOM environment — see
//   package.json — so the component cannot be mounted and driven here. This is
//   the same approach, and the same limitation, as lib/ui-modal-focus.test.ts.
//
//   WHAT IT PROVES : there is exactly one call site for the write, the dialog
//                    routes through apply(), and only a 401 is reported as an
//                    expired session.
//   WHAT IT DOES NOT PROVE : that the request succeeds, that the dialog closes,
//                    that the alert renders, or anything at all about runtime
//                    behaviour. Those need the browser checks in the PR notes.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PANEL = "app/(platform)/platform/tenants/[id]/TenantStatusControl.tsx";

const source = readFileSync(join(process.cwd(), PANEL), "utf8");

/**
 * The file with its comments removed.
 *
 * The comments in this panel discuss `updateTenant()` by name, so counting call
 * sites against the raw text would count prose. Stripping first is what makes
 * the count mean "call sites" rather than "mentions".
 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

describe("Tenant status — both write paths share one implementation", () => {
  it("calls updateTenant from exactly ONE place", () => {
    const callSites = code.match(/updateTenant\s*\(/g) ?? [];

    assert.equal(
      callSites.length,
      1,
      "TenantStatusControl now writes the status from more than one place. The " +
        "confirmation dialog used to call updateTenant() directly, which is how " +
        "Active -> Suspended and Active -> Cancelled bypassed the expired-session " +
        "handling and showed a bare \"Unauthorized\" (tester issue #9). Route the " +
        "dialog through apply() instead of adding a second call site."
    );
  });

  it("routes the confirmation dialog's onConfirm through apply()", () => {
    assert.match(
      code,
      /onConfirm=\{async \(\) => \{\s*const result = await apply\(selected\);/,
      "the confirmation dialog must perform its write through apply(), which is " +
        "where the platform-session handling lives"
    );
  });

  it("closes the dialog on an expired session, so the panel's message is visible", () => {
    // The explanation and its Sign in link are rendered by the panel, behind the
    // dialog's overlay. Leaving the dialog open would hide them.
    assert.match(
      code,
      /result\.code === "UNAUTHORIZED"\) confirm\.close\(\)/,
      "an expired platform session must close the dialog and hand the operator " +
        "to the panel's session-expired alert"
    );
  });
});

describe("Tenant status — 401 and 403 stay distinct", () => {
  it("reports the session as expired ONLY for a 401", () => {
    assert.match(
      code,
      /if \(result\.code === "UNAUTHORIZED"\) \{\s*setSessionExpired\(true\);/,
      "the expired-session state must be guarded by an UNAUTHORIZED check"
    );
  });

  it("has no second, unguarded way to claim the session expired", () => {
    const setters = code.match(/setSessionExpired\(true\)/g) ?? [];

    assert.equal(
      setters.length,
      1,
      "setSessionExpired(true) appears more than once. A 403 means the caller is " +
        "somebody who may not do this — a tenant user, a deactivated operator, or " +
        "one whose PLATFORM_ADMIN grant was revoked — and signing in again " +
        "resolves none of them. Reporting that as an expired session hides a real " +
        "permission refusal behind a message that cannot help."
    );
  });
});
