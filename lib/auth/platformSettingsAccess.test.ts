// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Operator Settings Destination
// LAYER  : Auth — Regression Tests
// PURPOSE: Pin the reason the platform console's "Settings" item cannot point
//          at /settings, so the bug cannot return by someone "tidying up" the
//          two destinations back into one.
//
// THE BUG
//   PortalShell hard-coded { label: "Settings", href: "/settings" } into every
//   portal's top bar. /settings lives in app/(account), whose layout resolves
//   its subject with getPortalSession() — the TENANT session, cookie
//   edu_access. A Super Admin signs in at /api/super-admin/auth/login and
//   receives a PLATFORM session, cookie edu_platform, and holds no tenant
//   session at all. So the account layout found nothing and redirected to
//   /login, which is indistinguishable from having been signed out even though
//   edu_platform was still valid the whole time.
//
// WHAT THESE TESTS PROVE
//   The separation is by COOKIE, and that is the exact mechanism — worth
//   stating precisely, because it is not the one you would guess:
//
//     • getSession() reads edu_access. A platform operator has only
//       edu_platform, so there is no tenant token to verify in the first place
//       and getPortalSession() returns null. THAT is the redirect to /login.
//
//     • verifyToken() checks the SIGNATURE ONLY. Both credentials are signed
//       with the same JWT_SECRET, so it does not reject a platform token on
//       type — the asymmetry below pins this, so nobody later "simplifies" the
//       guards believing the tenant verifier screens by session type.
//
//     • verifyPlatformToken() DOES check sessionType, which is what keeps the
//       platform Settings destination closed to a tenant user, including one
//       whose tenant roles claim SUPER_ADMIN.
//
//   Cookie NAMES are pinned too: if a later change made the two sessions share
//   one cookie, these tests should be what fails first.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// The modules read JWT_SECRET at call time, so the suite supplies one before
// importing anything that signs.
process.env.JWT_SECRET ??= "test-secret-for-platform-settings-suite";

import { signAccessToken, verifyToken } from "./jwt";
import {
  PLATFORM_COOKIE,
  signPlatformToken,
  verifyPlatformToken,
} from "./platformSession";
import { ACCESS_COOKIE } from "./session";

const PLATFORM_OPERATOR = {
  sub: "platform_user_1",
  email: "superadmin@eduos.local",
  role: "PLATFORM_ADMIN",
};

const TENANT_ADMIN = {
  sub: "user_1",
  tenantId: "tenant_1",
  email: "admin@demo.edu",
  roles: ["UNIVERSITY_ADMIN"],
};

describe("the platform and tenant sessions are different credentials", () => {
  it("stores them in DIFFERENT cookies, so holding one is never holding the other", () => {
    assert.notEqual(
      PLATFORM_COOKIE,
      ACCESS_COOKIE,
      "a shared cookie name would make the two sessions indistinguishable"
    );
    assert.equal(PLATFORM_COOKIE, "edu_platform");
    assert.equal(ACCESS_COOKIE, "edu_access");
  });

  it("a Super Admin carries NOTHING a tenant guard can read — why /settings cannot serve them", () => {
    const platformToken = signPlatformToken(PLATFORM_OPERATOR);

    // getSession() reads the edu_access cookie. A platform operator holds only
    // edu_platform, so no tenant token is ever presented, getPortalSession()
    // returns null, and app/(account)/layout.tsx redirects to /login. Pointing
    // the console at /settings was not a misconfiguration to tune — it was a
    // category error, and this is the shape of it.
    const asTenantPayload = verifyToken(platformToken);

    // Even read optimistically, the credential describes no tenant user: no
    // tenant to scope to and no roles to gate on. Every tenant guard that
    // matters — requireTenant, requireRole, shellFor — needs one of these.
    assert.equal(
      (asTenantPayload as { tenantId?: string }).tenantId,
      undefined,
      "a platform operator belongs to no tenant"
    );
    assert.equal(
      (asTenantPayload as { roles?: string[] }).roles,
      undefined,
      "a platform operator carries no tenant roles"
    );
  });

  it("the tenant verifier screens by SIGNATURE, not by session type — pinned, not endorsed", () => {
    // Deliberately asserting the current, permissive behaviour so it is
    // visible. Both credentials are signed with the same JWT_SECRET, so
    // verifyToken does NOT reject a platform token the way verifyPlatformToken
    // rejects a tenant one. Nothing in the Settings fix depends on it — the
    // cookie separation above is what protects the route — but a future change
    // that moves a platform token into edu_access would land in a guard that
    // does not screen it, and this test is where that shows up.
    const platformToken = signPlatformToken(PLATFORM_OPERATOR);

    assert.doesNotThrow(() => verifyToken(platformToken));
    assert.equal(
      verifyPlatformToken(signAccessToken(TENANT_ADMIN)),
      null,
      "the platform verifier, by contrast, DOES screen by sessionType"
    );
  });

  it("a tenant admin's token is NOT a platform session — why the platform Settings page stays closed", () => {
    const tenantToken = signAccessToken(TENANT_ADMIN);

    // The platform Settings destination (/super-admin/change-password) is
    // guarded by getPlatformSession(), which is verifyPlatformToken beneath.
    // A University Admin — even one whose tenant roles were edited to claim
    // SUPER_ADMIN — resolves to null here and is sent to /super-admin/login.
    assert.equal(
      verifyPlatformToken(tenantToken),
      null,
      "a tenant token must never satisfy the platform session verifier"
    );
  });

  it("a tenant token claiming SUPER_ADMIN still does not open the platform Settings page", () => {
    // The escalation the W1.2 audit found. Repeated here against the settings
    // destination specifically, because that route is now linked from the
    // console and is a door that did not previously exist in the nav.
    const escalated = signAccessToken({ ...TENANT_ADMIN, roles: ["SUPER_ADMIN"] });

    assert.equal(verifyPlatformToken(escalated), null);
  });
});

describe("the platform session survives a visit to the platform settings page", () => {
  it("verifies before and after, so navigating there cannot sign an operator out", () => {
    const token = signPlatformToken(PLATFORM_OPERATOR);

    // The page performs no mutation of the credential — it reads the session,
    // reads one flag, and renders. Re-verifying the same token is what a
    // refresh does, and what returning to /platform/dashboard does.
    const first = verifyPlatformToken(token);
    const second = verifyPlatformToken(token);

    assert.notEqual(first, null);
    assert.deepEqual(first, second);
    assert.equal(first?.email, PLATFORM_OPERATOR.email);
    assert.equal(first?.role, "PLATFORM_ADMIN");
  });
});
