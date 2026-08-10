// ============================================================================
// OWNER  : Gauransh
// MODULE : University Provisioning (W1.4)
// LAYER  : Validation — Unit Tests
// PURPOSE: Pin down the request contract for onboarding a real university.
//
//          The load-bearing assertions are the NEGATIVE ones. Provisioning is
//          the act that creates a tenant's first privileged account, so what the
//          schemas REFUSE is the security property: a caller-chosen password, a
//          caller-chosen role, a caller-supplied tenantId, and a status that
//          would create a university nobody can use.
//
//          Unit tests over Zod only — no database, no HTTP. Transactional
//          behaviour and the guards have their own coverage.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  changeTenantPasswordSchema,
  provisionAdminSchema,
  provisionTenantSchema,
  updateTenantSchema,
  INITIAL_TENANT_ROLE,
} from "@/lib/validations/platform";

/** A minimal valid university, as AKTU would be onboarded. */
const VALID_UNIVERSITY = {
  name: "Dr. A.P.J. Abdul Kalam Technical University",
  slug: "aktu",
  type: "UNIVERSITY",
  status: "ACTIVE",
};

const VALID_ADMIN = {
  firstName: "Registrar",
  lastName: "Kalam",
  email: "registrar@aktu.ac.in",
};

describe("INITIAL_TENANT_ROLE", () => {
  it("is UNIVERSITY_ADMIN and nothing else", () => {
    // The provisioning service grants this constant, never a value from the
    // request. Asserting it here is what makes "provisioning cannot mint a
    // SUPER_ADMIN" a checked property rather than a claim in a comment.
    assert.equal(INITIAL_TENANT_ROLE, "UNIVERSITY_ADMIN");
  });
});

describe("provisionAdminSchema", () => {
  it("accepts a well-formed administrator", () => {
    assert.equal(provisionAdminSchema.safeParse(VALID_ADMIN).success, true);
  });

  it("lowercases the email, so one address cannot become two accounts", () => {
    // User is @@unique([tenantId, email]) over the raw text and the tenant login
    // route lowercases before its lookup. Without this, "Registrar@AKTU.ac.in"
    // would create a row nobody could sign into.
    const result = provisionAdminSchema.safeParse({
      ...VALID_ADMIN,
      email: "Registrar@AKTU.ac.in",
    });
    assert.equal(result.success, true);
    assert.equal(result.data?.email, "registrar@aktu.ac.in");
  });

  it("REFUSES a caller-supplied password", () => {
    // Strict, so this is a rejection rather than a silently dropped key. A
    // platform operator must not be able to set a university's credential to a
    // value they keep — one is generated and returned once instead.
    assert.equal(
      provisionAdminSchema.safeParse({ ...VALID_ADMIN, password: "hunter2hunter2" }).success,
      false
    );
  });

  it("REFUSES a passwordHash", () => {
    assert.equal(
      provisionAdminSchema.safeParse({ ...VALID_ADMIN, passwordHash: "$2b$12$x" }).success,
      false
    );
  });

  it("REFUSES a role — the initial administrator's role is not a choice", () => {
    assert.equal(
      provisionAdminSchema.safeParse({ ...VALID_ADMIN, role: "SUPER_ADMIN" }).success,
      false
    );
    assert.equal(
      provisionAdminSchema.safeParse({ ...VALID_ADMIN, role: "UNIVERSITY_ADMIN" }).success,
      false
    );
  });

  it("REFUSES a tenantId — it comes from the route, never the body", () => {
    // A body-supplied tenantId is how an administrator gets attached to the
    // wrong university.
    assert.equal(
      provisionAdminSchema.safeParse({ ...VALID_ADMIN, tenantId: "someone_elses_tenant" }).success,
      false
    );
  });

  it("rejects a blank name and a malformed address", () => {
    assert.equal(provisionAdminSchema.safeParse({ ...VALID_ADMIN, firstName: "  " }).success, false);
    assert.equal(provisionAdminSchema.safeParse({ ...VALID_ADMIN, email: "nope" }).success, false);
  });
});

describe("provisionTenantSchema", () => {
  it("accepts a university without an administrator", () => {
    assert.equal(provisionTenantSchema.safeParse(VALID_UNIVERSITY).success, true);
  });

  it("accepts a university with its first administrator", () => {
    const result = provisionTenantSchema.safeParse({ ...VALID_UNIVERSITY, admin: VALID_ADMIN });
    assert.equal(result.success, true);
    assert.equal(result.data?.admin?.email, "registrar@aktu.ac.in");
  });

  it("accepts status, so a university can be onboarded directly as ACTIVE", () => {
    const result = provisionTenantSchema.safeParse(VALID_UNIVERSITY);
    assert.equal(result.data?.status, "ACTIVE");
  });

  it("leaves status undefined when omitted, so the schema default applies", () => {
    const result = provisionTenantSchema.safeParse({
      name: VALID_UNIVERSITY.name,
      slug: VALID_UNIVERSITY.slug,
      type: VALID_UNIVERSITY.type,
    });
    assert.equal(result.success, true);
    assert.equal(result.data?.status, undefined);
  });

  it("requires name and slug", () => {
    assert.equal(provisionTenantSchema.safeParse({ slug: "aktu" }).success, false);
    assert.equal(provisionTenantSchema.safeParse({ name: "AKTU" }).success, false);
  });

  it("enforces the slug's DNS-label shape", () => {
    // The slug becomes a subdomain: lib/services/tenant.ts strips the root
    // domain off the Host header, so dots, capitals and spaces are unroutable.
    for (const slug of ["AKTU", "ak tu", "aktu.ac.in", "-aktu", "aktu-", "ak--tu"]) {
      assert.equal(
        provisionTenantSchema.safeParse({ ...VALID_UNIVERSITY, slug }).success,
        false,
        `expected "${slug}" to be refused`
      );
    }
    assert.equal(
      provisionTenantSchema.safeParse({ ...VALID_UNIVERSITY, slug: "ipu-delhi" }).success,
      true
    );
  });

  it("rejects an invalid status rather than falling back to a default", () => {
    assert.equal(
      provisionTenantSchema.safeParse({ ...VALID_UNIVERSITY, status: "ENABLED" }).success,
      false
    );
  });

  it("REFUSES an admin carrying a password or a role", () => {
    // The nested schema's strictness is what stops the escalation being smuggled
    // one level down, where a partial check would not look.
    assert.equal(
      provisionTenantSchema.safeParse({
        ...VALID_UNIVERSITY,
        admin: { ...VALID_ADMIN, role: "SUPER_ADMIN" },
      }).success,
      false
    );
    assert.equal(
      provisionTenantSchema.safeParse({
        ...VALID_UNIVERSITY,
        admin: { ...VALID_ADMIN, password: "hunter2hunter2" },
      }).success,
      false
    );
  });

  it("does not leak `admin` into the tenant UPDATE contract", () => {
    // updateTenantSchema is derived from createTenantSchema, NOT from this one.
    // A PATCH accepting `admin` would read as "edit the administrator" while
    // doing something else entirely, so the key must be dropped there.
    const result = updateTenantSchema.safeParse({ name: "AKTU", admin: VALID_ADMIN });
    assert.equal(result.success, true);
    assert.equal("admin" in (result.data ?? {}), false);
  });
});

describe("changeTenantPasswordSchema", () => {
  it("accepts a current password and a longer new one", () => {
    assert.equal(
      changeTenantPasswordSchema.safeParse({
        currentPassword: "issued-password",
        newPassword: "a-much-longer-passphrase",
      }).success,
      true
    );
  });

  it("REJECTS reusing the same value", () => {
    // Otherwise a forced change could be satisfied by resubmitting the shared
    // secret, clearing the flag while leaving the credential in place — the one
    // outcome the whole flow exists to prevent.
    const same = "a-much-longer-passphrase";
    assert.equal(
      changeTenantPasswordSchema.safeParse({ currentPassword: same, newPassword: same }).success,
      false
    );
  });

  it("rejects a new password shorter than 12 characters", () => {
    assert.equal(
      changeTenantPasswordSchema.safeParse({
        currentPassword: "issued-password",
        newPassword: "short12345",
      }).success,
      false
    );
  });

  it("REFUSES a userId — this route changes the CALLER'S password and no other", () => {
    // Strict. The account is identified by the session's sub, so there must be
    // no key by which the request can be aimed at somebody else.
    assert.equal(
      changeTenantPasswordSchema.safeParse({
        currentPassword: "issued-password",
        newPassword: "a-much-longer-passphrase",
        userId: "another_user",
      }).success,
      false
    );
  });
});
