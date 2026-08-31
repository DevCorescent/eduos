// ============================================================================
// MODULE : Platform — Archive tenant, platform-session handling
// LAYER  : Regression Test
// PURPOSE: Pin the fix for tester issue #10 — "clicking Archive shows
//          Unauthorized and the tenant is not archived" — and the 403
//          distinction that fix must not erase.
//
// THE BUG, EXACTLY
//   Nothing was wrong with the authorization. POST
//   /api/platform/tenants/[id]/archive runs requirePlatformAdmin() first,
//   validates, and writes status/archivedAt/archivedBy correctly. What was
//   missing was the PRESENTATION of one refusal: the platform session lasts one
//   hour and is never refreshed, so a console left open past it holds an expired
//   edu_platform cookie. The guard then answers 401, and both of this panel's
//   write paths did `setError(result.error)` — rendering the envelope's bare
//   "Unauthorized" with no indication that the session had ended and no way
//   back. That is the string the tester reported, on the same page and the same
//   day as issue #9's.
//
// WHY 401 AND 403 ARE ASSERTED SEPARATELY
//   requirePlatformAdmin answers 401 when nobody is signed in — for an operator
//   that means the cookie expired, and signing in again fixes it. It answers 403
//   when the caller IS somebody who may not do this: a tenant user, a
//   deactivated operator, or one whose PLATFORM_ADMIN grant was revoked.
//   Signing in again fixes none of those. Reporting a 403 as an expired session
//   would disguise a real permission refusal as a timeout, so the last test
//   asserts it has not been folded in.
//
// WHY THIS TEST READS THE SOURCE
//   The project has no React testing library and no DOM environment — see
//   package.json — so the component cannot be mounted and driven here. Same
//   approach and same limitation as lib/ui-modal-focus.test.ts and
//   lib/ui-tenant-status-auth.test.ts.
//
//   WHAT IT PROVES : both write paths report failure through one function, only
//                    a 401 is called an expired session, the archive dialog
//                    closes so the card's message is reachable, and the route
//                    still requires a platform admin.
//   WHAT IT DOES NOT PROVE : that the request succeeds, that the alert renders,
//                    or anything else about runtime behaviour. Those need the
//                    manual checks in the QA checklist.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PANEL = "app/(platform)/platform/tenants/[id]/TenantArchivePanel.tsx";
const ROUTE = "app/api/platform/tenants/[id]/archive/route.ts";

/** Source with comments removed, so a count means call sites and not prose. */
function codeOf(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const panel = codeOf(PANEL);
const route = codeOf(ROUTE);

describe("Archive tenant — authorization is unchanged", () => {
  it("still gates the route behind requirePlatformAdmin()", () => {
    // The fix for this issue is entirely presentational. If the guard ever
    // disappears from this route, the tenant directory's most consequential
    // action becomes reachable without a platform session.
    assert.match(
      route,
      /const guard = await requirePlatformAdmin\(\);\s*if \(!guard\.authorized\) return guard\.response;/,
      "the archive route must authorise before anything else"
    );
  });

  it("attributes the archival to the platform operator, not to a request field", () => {
    // archivedBy must come from the guard. A body-supplied value would let the
    // record name somebody who did not perform the act.
    assert.match(route, /archivedBy: guard\.platformUserId/);
  });
});

describe("Archive tenant — an expired session is explained, not dumped", () => {
  it("routes BOTH write paths through one failure reporter", () => {
    // archive() and restore() each call archiveTenant(); each must report
    // through reportFailure(), which is where the 401 handling lives. A second
    // raw setError(result.error) is how one path loses it again — which is
    // precisely how the confirm path in TenantStatusControl lost it (issue #9).
    const rawSetters = panel.match(/setError\(result\.error\)/g) ?? [];

    assert.equal(
      rawSetters.length,
      1,
      "setError(result.error) appears outside the single failure reporter. Both " +
        "archive() and restore() must report through reportFailure(), or one of " +
        "them will render a bare \"Unauthorized\" again."
    );

    assert.equal(
      (panel.match(/reportFailure\(result\)/g) ?? []).length,
      2,
      "both archive() and restore() must report through reportFailure()"
    );
  });

  it("closes the archive dialog on an expired session", () => {
    // The explanation and its Sign in link live on the card, behind the dialog.
    assert.match(
      panel,
      /if \(reportFailure\(result\)\) close\(\);/,
      "an expired session must close the dialog so the card's message is visible"
    );
  });

  it("offers a way back to the platform sign-in", () => {
    assert.match(
      panel,
      /href="\/super-admin\/login"/,
      "the expired-session alert must link to the platform sign-in, not /login — " +
        "an operator belongs to no tenant and has no institution code to supply"
    );
  });
});

describe("Archive tenant — 401 and 403 stay distinct", () => {
  it("reports the session as expired ONLY for a 401", () => {
    assert.match(
      panel,
      /if \(result\.code === "UNAUTHORIZED"\) \{\s*setSessionExpired\(true\);/,
      "the expired-session state must be guarded by an UNAUTHORIZED check"
    );
  });

  it("has no second, unguarded way to claim the session expired", () => {
    const setters = panel.match(/setSessionExpired\(true\)/g) ?? [];

    assert.equal(
      setters.length,
      1,
      "setSessionExpired(true) appears more than once. A 403 means the caller is " +
        "somebody who may not archive this university — signing in again resolves " +
        "nothing — so reporting it as an expired session hides a real permission " +
        "refusal behind a message that cannot help."
    );
  });
});
