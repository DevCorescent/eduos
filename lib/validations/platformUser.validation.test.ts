// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform Users (W1.3)
// LAYER  : Validation — Unit Tests
// PURPOSE: Prove the request contract that stands between a hostile client and
//          the platform's own operator table.
//
//          The load-bearing assertions here are the NEGATIVE ones. W1.3's whole
//          reason for existing is that platform authority must not be
//          expressible as a string a caller supplies, so these tests pin down
//          what the schemas refuse: the role name "SUPER_ADMIN", tenant role
//          names, a caller-chosen password, and a tenantId.
//
//          They are unit tests over Zod only — no database, no HTTP. What the
//          routes do with a valid body is asserted by their own reading of the
//          service, and the guard has its own suite.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  changePlatformPasswordSchema,
  createPlatformUserSchema,
  listPlatformUsersQuerySchema,
  platformUserIdParamSchema,
  updatePlatformUserSchema,
  PLATFORM_ROLE_NAMES,
} from "@/lib/validations/platform";
import { PLATFORM_ADMIN_ROLE } from "@/lib/middleware/requirePlatformAdmin";

/** A minimal valid create body. */
const VALID_CREATE = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@eduos.local",
  role: "PLATFORM_ADMIN",
};

describe("PLATFORM_ROLE_NAMES", () => {
  it("agrees with the role name the guard actually checks", () => {
    // The two are deliberately NOT imported from one another — a validation
    // module should not depend on an authorization module. This test is what
    // holds them together instead, so a rename in either is caught here rather
    // than as a create endpoint that stores a role nothing recognises.
    assert.ok((PLATFORM_ROLE_NAMES as readonly string[]).includes(PLATFORM_ADMIN_ROLE));
  });

  it("defines exactly one role — W1.3 invents no authorization model", () => {
    assert.equal(PLATFORM_ROLE_NAMES.length, 1);
  });
});

describe("createPlatformUserSchema", () => {
  it("accepts a well-formed operator", () => {
    const result = createPlatformUserSchema.safeParse(VALID_CREATE);
    assert.equal(result.success, true);
  });

  it("lowercases the email, so one address cannot become two identities", () => {
    // PlatformUser.email is unique over the raw text and the login route
    // lowercases before its lookup. Without this, "Ada@..." would create a
    // second row that could never be signed into.
    const result = createPlatformUserSchema.safeParse({
      ...VALID_CREATE,
      email: "Ada@EduOS.Local",
    });
    assert.equal(result.success, true);
    assert.equal(result.data?.email, "ada@eduos.local");
  });

  it("REFUSES the role name SUPER_ADMIN", () => {
    // The exact string the W1.1 escalation used. It is not a platform role and
    // is not merely unrecognised here — the enum has one member, so nothing
    // outside it parses at all.
    const result = createPlatformUserSchema.safeParse({ ...VALID_CREATE, role: "SUPER_ADMIN" });
    assert.equal(result.success, false);
  });

  it("REFUSES a tenant role name", () => {
    const result = createPlatformUserSchema.safeParse({ ...VALID_CREATE, role: "UNIVERSITY_ADMIN" });
    assert.equal(result.success, false);
  });

  it("REFUSES a caller-supplied password", () => {
    // Strict, so this is a rejection rather than a silently dropped key. One
    // operator must not be able to set another's credential to a value they
    // keep — the route generates one and returns it once instead.
    const result = createPlatformUserSchema.safeParse({
      ...VALID_CREATE,
      password: "hunter2hunter2",
    });
    assert.equal(result.success, false);
  });

  it("REFUSES a passwordHash", () => {
    const result = createPlatformUserSchema.safeParse({ ...VALID_CREATE, passwordHash: "$2b$12$x" });
    assert.equal(result.success, false);
  });

  it("REFUSES a tenantId — a platform identity belongs to no institution", () => {
    const result = createPlatformUserSchema.safeParse({ ...VALID_CREATE, tenantId: "tenant_1" });
    assert.equal(result.success, false);
  });

  it("REFUSES isActive — creation has no use for a deactivated account", () => {
    const result = createPlatformUserSchema.safeParse({ ...VALID_CREATE, isActive: false });
    assert.equal(result.success, false);
  });

  it("rejects a blank name and a malformed address", () => {
    assert.equal(
      createPlatformUserSchema.safeParse({ ...VALID_CREATE, firstName: "   " }).success,
      false
    );
    assert.equal(
      createPlatformUserSchema.safeParse({ ...VALID_CREATE, email: "not-an-address" }).success,
      false
    );
  });
});

describe("updatePlatformUserSchema", () => {
  it("accepts a single field", () => {
    assert.equal(updatePlatformUserSchema.safeParse({ firstName: "Grace" }).success, true);
  });

  it("accepts isActive on its own — this is the deactivate request", () => {
    // Activation and deactivation are this schema, not a second endpoint: both
    // are the same write, and a separate route would be a different name for it.
    assert.equal(updatePlatformUserSchema.safeParse({ isActive: false }).success, true);
    assert.equal(updatePlatformUserSchema.safeParse({ isActive: true }).success, true);
  });

  it("REJECTS an empty body rather than advancing updatedAt for nothing", () => {
    assert.equal(updatePlatformUserSchema.safeParse({}).success, false);
  });

  it("REFUSES passwordHash, tenantId and the generated columns", () => {
    for (const forbidden of [
      { passwordHash: "$2b$12$x" },
      { tenantId: "tenant_1" },
      { id: "other_id" },
      { createdAt: "2026-01-01T00:00:00.000Z" },
      { lastLoginAt: "2026-01-01T00:00:00.000Z" },
    ]) {
      assert.equal(
        updatePlatformUserSchema.safeParse({ firstName: "Grace", ...forbidden }).success,
        false,
        `expected ${Object.keys(forbidden)[0]} to be refused`
      );
    }
  });

  it("still REFUSES SUPER_ADMIN, since the role rule is inherited not restated", () => {
    assert.equal(updatePlatformUserSchema.safeParse({ role: "SUPER_ADMIN" }).success, false);
  });
});

describe("listPlatformUsersQuerySchema", () => {
  it("defaults pagination when the params are omitted", () => {
    const result = listPlatformUsersQuerySchema.safeParse({});
    assert.equal(result.success, true);
    assert.equal(result.data?.page, 1);
    assert.equal(result.data?.limit, 20);
    assert.equal(result.data?.q, undefined);
  });

  it("coerces page and limit from strings, as search params arrive", () => {
    const result = listPlatformUsersQuerySchema.safeParse({ page: "3", limit: "50" });
    assert.equal(result.success, true);
    assert.equal(result.data?.page, 3);
    assert.equal(result.data?.limit, 50);
  });

  it("refuses a request for the whole table", () => {
    assert.equal(listPlatformUsersQuerySchema.safeParse({ limit: "1000" }).success, false);
  });

  it("refuses page 0, which would be a negative skip", () => {
    assert.equal(listPlatformUsersQuerySchema.safeParse({ page: "0" }).success, false);
  });

  it("treats a blank q as no search rather than as the empty string", () => {
    // `?q=` reads as "search for nothing" to a backend that supports search,
    // which is not what an untouched search box means.
    const result = listPlatformUsersQuerySchema.safeParse({ q: "   " });
    assert.equal(result.success, true);
    assert.equal(result.data?.q, undefined);
  });

  it("keeps a real search term, trimmed", () => {
    const result = listPlatformUsersQuerySchema.safeParse({ q: "  admin " });
    assert.equal(result.success, true);
    assert.equal(result.data?.q, "admin");
  });
});

describe("platformUserIdParamSchema", () => {
  it("accepts any non-empty id and asserts no cuid shape", () => {
    // The id is an opaque key. Asserting a format would turn an
    // unrecognised-but-well-formed id into a 400 when 404 is the accurate answer.
    assert.equal(platformUserIdParamSchema.safeParse({ id: "anything" }).success, true);
  });

  it("rejects an empty or whitespace-only segment", () => {
    assert.equal(platformUserIdParamSchema.safeParse({ id: "   " }).success, false);
  });
});

describe("changePlatformPasswordSchema", () => {
  it("accepts a current password and a longer new one", () => {
    const result = changePlatformPasswordSchema.safeParse({
      currentPassword: "temp-password",
      newPassword: "a-much-longer-passphrase",
    });
    assert.equal(result.success, true);
  });

  it("REJECTS reusing the same value", () => {
    // Otherwise a forced change could be satisfied by resubmitting the shared
    // secret, clearing the flag while leaving the credential in place — the one
    // outcome the whole flow exists to prevent.
    const same = "a-much-longer-passphrase";
    const result = changePlatformPasswordSchema.safeParse({
      currentPassword: same,
      newPassword: same,
    });
    assert.equal(result.success, false);
  });

  it("rejects a new password shorter than 12 characters", () => {
    const result = changePlatformPasswordSchema.safeParse({
      currentPassword: "temp-password",
      newPassword: "short12345",
    });
    assert.equal(result.success, false);
  });

  it("REFUSES an id — this route changes the CALLER'S password and no other", () => {
    // Strict. The account is identified by the session's sub, so there must be
    // no key by which the request can be aimed at somebody else.
    const result = changePlatformPasswordSchema.safeParse({
      currentPassword: "temp-password",
      newPassword: "a-much-longer-passphrase",
      id: "other_operator",
    });
    assert.equal(result.success, false);
  });
});
