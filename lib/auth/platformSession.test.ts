// ============================================================================
// W1.2 SECURITY REGRESSION SUITE
//
// The W1.1 audit reproduced this attack against the running application:
//
//   UNIVERSITY_ADMIN → grants itself a tenant Role named "SUPER_ADMIN"
//                    → re-authenticates
//                    → GET /api/platform/tenants → 200, all 5 tenants
//
// It worked because platform authority was a STRING inside tenant-owned data
// and the guard compared that string. These assertions pin the structural
// property that replaced it: a token is a platform credential only if it says
// so, and nothing a tenant can write produces one.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { signPlatformToken, verifyPlatformToken } from "./platformSession";

// The module reads JWT_SECRET at call time, so the suite supplies one.
process.env.JWT_SECRET ??= "test-secret-for-platform-session-suite";
const SECRET = process.env.JWT_SECRET;

describe("tenant admin cannot escalate to platform admin through tenant role assignment", () => {
  it("REJECTS a tenant token that claims roles: ['SUPER_ADMIN']", () => {
    // Exactly the token the W1.1 attack produced: signed by this application,
    // with the escalated role claim, and no sessionType.
    const escalated = jwt.sign(
      {
        sub: "tenant-user-id",
        tenantId: "tenant-a",
        email: "admin@demo.edu",
        roles: ["UNIVERSITY_ADMIN", "SUPER_ADMIN"],
      },
      SECRET,
      { expiresIn: "1h" }
    );

    // Valid signature, valid expiry — and still not a platform credential.
    assert.equal(verifyPlatformToken(escalated), null);
  });

  it("REJECTS a token that names the old role as its sessionType", () => {
    const forged = jwt.sign(
      { sessionType: "SUPER_ADMIN", sub: "x", email: "a@b.c", role: "PLATFORM_ADMIN" },
      SECRET,
      { expiresIn: "1h" }
    );
    assert.equal(verifyPlatformToken(forged), null);
  });

  it("REJECTS a token with no sessionType at all", () => {
    const bare = jwt.sign({ sub: "x", email: "a@b.c", role: "PLATFORM_ADMIN" }, SECRET, {
      expiresIn: "1h",
    });
    assert.equal(verifyPlatformToken(bare), null);
  });

  it("REJECTS a token signed with a different key", () => {
    const foreign = jwt.sign(
      { sessionType: "PLATFORM", sub: "x", email: "a@b.c", role: "PLATFORM_ADMIN" },
      "some-other-secret",
      { expiresIn: "1h" }
    );
    assert.equal(verifyPlatformToken(foreign), null);
  });

  it("REJECTS an expired platform token", () => {
    const expired = jwt.sign(
      { sessionType: "PLATFORM", sub: "x", email: "a@b.c", role: "PLATFORM_ADMIN" },
      SECRET,
      { expiresIn: -10 }
    );
    assert.equal(verifyPlatformToken(expired), null);
  });

  it("REJECTS a tampered token", () => {
    const good = signPlatformToken({ sub: "x", email: "a@b.c", role: "PLATFORM_ADMIN" });
    assert.equal(verifyPlatformToken(good + "x"), null);
    assert.equal(verifyPlatformToken("not.a.token"), null);
    assert.equal(verifyPlatformToken(""), null);
  });
});

describe("signPlatformToken — the only way a platform credential is minted", () => {
  it("stamps sessionType PLATFORM, which the tenant login never sets", () => {
    const token = signPlatformToken({
      sub: "platform-user-id",
      email: "superadmin@eduos.local",
      role: "PLATFORM_ADMIN",
    });

    const payload = verifyPlatformToken(token);
    assert.ok(payload);
    assert.equal(payload.sessionType, "PLATFORM");
    assert.equal(payload.sub, "platform-user-id");
    assert.equal(payload.role, "PLATFORM_ADMIN");
  });

  it("carries NO tenantId and NO roles array — a platform operator has neither", () => {
    const decoded = jwt.decode(
      signPlatformToken({ sub: "x", email: "a@b.c", role: "PLATFORM_ADMIN" })
    ) as Record<string, unknown>;

    assert.equal("tenantId" in decoded, false);
    assert.equal("roles" in decoded, false);
  });
});
