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

// ============================================================================
// The restore path — found while verifying #10 end to end against the database.
// ============================================================================

describe("Restoring a tenant clears the archive stamp", () => {
  it("clears archivedAt AND archivedBy in the same update as the status", () => {
    // The bug: restore set status back to SUSPENDED and left archivedAt and
    // archivedBy exactly as the archive had written them. A restored
    // university then carried a timestamp and an operator id asserting it was
    // archived while its status said it was not — two columns of one row
    // disagreeing about the same fact. The panel branches on `status`, so the
    // screen looked correct and only the data was wrong, which is the kind of
    // defect that surfaces much later as a report nobody can explain.
    const route = readFileSync(
      join(process.cwd(), "app/api/platform/tenants/[id]/archive/route.ts"),
      "utf8"
    );

    const restoreAt = route.indexOf("if (restore) {");
    assert.ok(restoreAt > 0, "the restore branch has moved or gone");

    // Bounded to the restore branch so the archive branch's own writes, which
    // legitimately SET these columns, cannot satisfy this assertion.
    const branch = route.slice(restoreAt, route.indexOf("if (isArchived) {", restoreAt));

    assert.match(
      branch,
      /data: \{ status: "SUSPENDED", archivedAt: null, archivedBy: null \}/,
      "restore must clear the archive stamp it is undoing"
    );
  });

  it("archiving still records the status, who archived it and when", () => {
    // The counterpart: clearing on restore must not have been achieved by
    // never writing the stamp in the first place.
    const route = readFileSync(
      join(process.cwd(), "app/api/platform/tenants/[id]/archive/route.ts"),
      "utf8"
    );

    const archiveAt = route.indexOf("const archived = await prisma.tenant.update");
    assert.ok(archiveAt > 0, "the archive write has moved or gone");
    const branch = route.slice(archiveAt, archiveAt + 500);

    assert.match(branch, /status: "ARCHIVED"/);
    assert.match(branch, /archivedAt: new Date\(\)/);
    assert.match(branch, /archivedBy: guard\.platformUserId/);
  });

  it("restore returns the tenant to SUSPENDED, not ACTIVE", () => {
    // A deliberate product decision recorded in the route: restoring makes the
    // institution manageable again; putting its students back online is a
    // separate, explicit status change. Pinned so a later "convenience" edit
    // cannot quietly bring a suspended university back online.
    const route = readFileSync(
      join(process.cwd(), "app/api/platform/tenants/[id]/archive/route.ts"),
      "utf8"
    );

    const restoreAt = route.indexOf("if (restore) {");
    const branch = route.slice(restoreAt, route.indexOf("if (isArchived) {", restoreAt));

    assert.match(branch, /status: "SUSPENDED"/);
    assert.ok(!/status: "ACTIVE"/.test(branch), "restore must not reactivate the tenant");
  });

  it("refuses to restore a tenant that is not archived, and says so", () => {
    // Without this the update would run against a live university and set it
    // to SUSPENDED — an outage caused by a button that should have been a
    // no-op.
    const route = readFileSync(
      join(process.cwd(), "app/api/platform/tenants/[id]/archive/route.ts"),
      "utf8"
    );

    const restoreAt = route.indexOf("if (restore) {");
    const branch = route.slice(restoreAt, route.indexOf("if (isArchived) {", restoreAt));

    assert.match(branch, /if \(!isArchived\)/);
    assert.match(branch, /"This university is not archived", "CONFLICT"/);
    assert.match(branch, /status: 409/);

    // And the guard is decided BEFORE the write, not after it.
    assert.ok(
      branch.indexOf("if (!isArchived)") < branch.indexOf("prisma.tenant.update"),
      "the conflict must be refused before the restore writes anything"
    );
  });

  it("refuses to archive one that is already archived", () => {
    // Re-archiving would overwrite archivedAt and archivedBy, losing the record
    // of who actually archived it and when.
    const route = readFileSync(
      join(process.cwd(), "app/api/platform/tenants/[id]/archive/route.ts"),
      "utf8"
    );

    assert.match(route, /"This university is already archived", "CONFLICT"/);
  });
});
