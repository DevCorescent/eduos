// ============================================================================
// TESTS: platform session renewal — tester issues #9 and #10.
//
// THE BUG THESE PIN
//   The tenant session renews: there is an `edu_refresh` cookie and an
//   /api/auth/refresh endpoint behind it. The platform session had neither. The
//   cookie was written once at login with a one-hour life and never touched
//   again, so an operator was signed out on a hard boundary, mid-task — the
//   "Unauthorized" the tester hit when changing a tenant's status (#9) and when
//   archiving a tenant (#10). Reporting that refusal more clearly, which is
//   what the previous fix did, does not stop it happening.
//
// WHAT RENEWAL MUST NOT BECOME
//   An expired claim must never be extended, or the one-hour bound would mean
//   nothing and a stolen cookie would live forever. Every assertion below that
//   returns false is guarding that, not tidying an edge case.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PLATFORM_COOKIE_MAX_AGE,
  PLATFORM_RENEW_AFTER_SECONDS,
  shouldRenewPlatformSession,
} from "./platformSession";

/** A fixed "now", so these never depend on how long the suite takes to run. */
const NOW = 1_800_000_000;

describe("shouldRenewPlatformSession", () => {
  it("renews halfway through the session's life", () => {
    // The point of the whole change: an operator still working keeps working.
    assert.equal(
      shouldRenewPlatformSession({ exp: NOW + PLATFORM_RENEW_AFTER_SECONDS }, NOW),
      true
    );
  });

  it("renews a session with one minute left", () => {
    assert.equal(shouldRenewPlatformSession({ exp: NOW + 60 }, NOW), true);
  });

  it("does NOT renew a freshly issued session", () => {
    // A Set-Cookie on every request is pure overhead on a console that makes
    // several calls per screen.
    assert.equal(
      shouldRenewPlatformSession({ exp: NOW + PLATFORM_COOKIE_MAX_AGE }, NOW),
      false
    );
  });

  it("does NOT renew one second before the halfway mark", () => {
    assert.equal(
      shouldRenewPlatformSession({ exp: NOW + PLATFORM_RENEW_AFTER_SECONDS + 1 }, NOW),
      false
    );
  });

  it("REFUSES to renew an already-expired session", () => {
    // The security boundary. verifyPlatformToken rejects an expired token long
    // before this runs, but a renewal that accepted one would turn the
    // one-hour limit into no limit at all.
    assert.equal(shouldRenewPlatformSession({ exp: NOW - 1 }, NOW), false);
    assert.equal(shouldRenewPlatformSession({ exp: NOW - 86_400 }, NOW), false);
  });

  it("REFUSES to renew a session expiring exactly now", () => {
    assert.equal(shouldRenewPlatformSession({ exp: NOW }, NOW), false);
  });

  it("does NOT renew a claim carrying no expiry", () => {
    // Nothing to reason about; renewing would mint an endless session from a
    // token that never said when it should end.
    assert.equal(shouldRenewPlatformSession({ exp: undefined }, NOW), false);
  });

  it("renews in the second half, which is what makes the window useful", () => {
    // An operator making any request in the second half gets at least another
    // half-life of work. That is the property the tester's flow needed.
    assert.ok(PLATFORM_RENEW_AFTER_SECONDS * 2 === PLATFORM_COOKIE_MAX_AGE);
  });
});

describe("renewal is a consequence of authorisation, never a step toward it", () => {
  it("requirePlatformAdmin renews only after every refusal has returned", () => {
    // Placing the call before any refusal would extend the session of a
    // deactivated operator, or one whose admin grant was revoked, on the very
    // request that refuses them.
    const guard = readFileSync(
      join(process.cwd(), "lib/middleware/requirePlatformAdmin.ts"),
      "utf8"
    );

    const renewAt = guard.indexOf("await renewPlatformSession(session)");
    assert.ok(renewAt > 0, "the guard no longer renews the session");

    const before = guard.slice(0, renewAt);
    for (const refusal of ["NO_SESSION", "NOT_ADMIN", "PASSWORD_CHANGE_REQUIRED"]) {
      assert.ok(
        before.includes(refusal),
        `${refusal} must be decided BEFORE the session is renewed`
      );
    }

    // And it is the last thing before success.
    const after = guard.slice(renewAt);
    assert.ok(
      !/return \{\s*authorized: false/.test(after),
      "a refusal after renewal would extend a session it then refuses"
    );
  });
});
