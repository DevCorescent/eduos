// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform — Operator Settings (self-service)
// LAYER  : Validation — Unit Tests
// PURPOSE: Pin the body contract of PATCH /api/super-admin/settings.
//
// THIS SCHEMA IS A PRIVILEGE BOUNDARY, NOT A FORM VALIDATOR
//   updatePlatformUserSchema — used by PATCH /api/platform/users/[id], where an
//   administrator edits SOMEBODY ELSE — accepts role and isActive. This one
//   must not, because its subject is always the caller:
//
//     role     accepted here would be self-granted privilege
//     isActive accepted here would let an operator lock themselves out, which
//              the administrative route already refuses as a special case
//     email    identifies the account and is the session's subject; changing
//              it carries a uniqueness check and stays administrative
//
//   .strict() is what makes those a 400 rather than a silently dropped key, so
//   the tests below assert rejection and not merely absence from the output.
//
//   No id of any kind is accepted either. The route resolves the operator from
//   requirePlatformAdmin(), so there is no body through which one Super Admin
//   could name another.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  updateOwnPlatformProfileSchema,
  updatePlatformUserSchema,
} from "@/lib/validations/platform";
import { PLATFORM_ACCENTS } from "@/lib/constants/platformAccent";

describe("updateOwnPlatformProfileSchema — PATCH /api/super-admin/settings", () => {
  describe("accepts exactly what an operator may change about themselves", () => {
    it("accepts both names", () => {
      const parsed = updateOwnPlatformProfileSchema.safeParse({
        firstName: "Ada",
        lastName: "Lovelace",
      });

      assert.ok(parsed.success);
      assert.deepEqual(parsed.data, { firstName: "Ada", lastName: "Lovelace" });
    });

    it("accepts either name on its own", () => {
      assert.equal(updateOwnPlatformProfileSchema.safeParse({ firstName: "Ada" }).success, true);
      assert.equal(updateOwnPlatformProfileSchema.safeParse({ lastName: "Byron" }).success, true);
    });

    it("trims, so a name of spaces cannot be saved", () => {
      const parsed = updateOwnPlatformProfileSchema.safeParse({ firstName: "  Ada  " });

      assert.ok(parsed.success);
      assert.equal(parsed.data.firstName, "Ada");
      assert.equal(updateOwnPlatformProfileSchema.safeParse({ firstName: "   " }).success, false);
    });

    it("REJECTS an empty body — a no-op that would still advance updatedAt", () => {
      assert.equal(updateOwnPlatformProfileSchema.safeParse({}).success, false);
    });

    it("REJECTS an over-long name", () => {
      assert.equal(
        updateOwnPlatformProfileSchema.safeParse({ firstName: "x".repeat(101) }).success,
        false
      );
      assert.equal(
        updateOwnPlatformProfileSchema.safeParse({ firstName: "x".repeat(100) }).success,
        true
      );
    });
  });

  describe("the privilege boundary", () => {
    it("REJECTS role — an operator may not grant themselves anything", () => {
      const parsed = updateOwnPlatformProfileSchema.safeParse({
        firstName: "Ada",
        role: "PLATFORM_ADMIN",
      });

      assert.equal(parsed.success, false, "role must be refused, not stripped");
    });

    it("REJECTS isActive — an operator may not deactivate themselves", () => {
      assert.equal(
        updateOwnPlatformProfileSchema.safeParse({ firstName: "Ada", isActive: false }).success,
        false
      );
    });

    it("REJECTS email — the account identifier stays administrative", () => {
      assert.equal(
        updateOwnPlatformProfileSchema.safeParse({ email: "someone.else@eduos.local" }).success,
        false
      );
    });

    it("REJECTS any id — the subject is the session, never the body", () => {
      // The whole self-service guarantee: Super Admin A has no way to name
      // Super Admin B.
      for (const key of ["id", "platformUserId", "userId", "sub", "tenantId"]) {
        assert.equal(
          updateOwnPlatformProfileSchema.safeParse({ firstName: "Ada", [key]: "other_operator" })
            .success,
          false,
          `${key} must be refused`
        );
      }
    });

    it("REJECTS passwordHash and password — neither belongs on this route", () => {
      assert.equal(
        updateOwnPlatformProfileSchema.safeParse({ passwordHash: "$2a$10$abc" }).success,
        false
      );
      assert.equal(
        updateOwnPlatformProfileSchema.safeParse({ password: "hunter2hunter2" }).success,
        false
      );
    });
  });

  describe("accentColor — a closed set, never a colour string", () => {
    it("accepts every supported accent", () => {
      for (const accent of PLATFORM_ACCENTS) {
        assert.equal(
          updateOwnPlatformProfileSchema.safeParse({ accentColor: accent }).success,
          true,
          `${accent} must be accepted`
        );
      }
    });

    it("REJECTS an unsupported accent with no silent coercion", () => {
      assert.equal(updateOwnPlatformProfileSchema.safeParse({ accentColor: "TEAL" }).success, false);
      assert.equal(updateOwnPlatformProfileSchema.safeParse({ accentColor: "blue" }).success, false);
      assert.equal(updateOwnPlatformProfileSchema.safeParse({ accentColor: "" }).success, false);
    });

    it("REJECTS a raw colour or a CSS fragment", () => {
      // The value becomes a data attribute selecting a stylesheet block. A
      // string that reached the column could not be styled, and a string that
      // reached a style attribute would be caller-controlled CSS.
      for (const value of ["#ff0000", "red", "var(--danger)", "red; --success: red"]) {
        assert.equal(
          updateOwnPlatformProfileSchema.safeParse({ accentColor: value }).success,
          false,
          `${value} must be refused`
        );
      }
    });

    it("REJECTS null — clearing is choosing DEFAULT, which is a real member", () => {
      assert.equal(updateOwnPlatformProfileSchema.safeParse({ accentColor: null }).success, false);
    });

    it("can be sent alongside a name without widening what else is accepted", () => {
      assert.ok(
        updateOwnPlatformProfileSchema.safeParse({ firstName: "Ada", accentColor: "BLUE" }).success
      );
      assert.equal(
        updateOwnPlatformProfileSchema.safeParse({ accentColor: "BLUE", role: "PLATFORM_ADMIN" })
          .success,
        false
      );
      assert.equal(
        updateOwnPlatformProfileSchema.safeParse({ accentColor: "BLUE", id: "other" }).success,
        false
      );
    });
  });

  describe("it is genuinely narrower than the administrative schema", () => {
    it("the administrative schema DOES accept role and isActive — this one does not", () => {
      // Asserted as a pair so the two cannot silently converge: if someone
      // later widens the self-service schema to reuse the administrative one,
      // this is the test that fails.
      assert.equal(
        updatePlatformUserSchema.safeParse({ role: "PLATFORM_ADMIN" }).success,
        true,
        "administrative schema still accepts role"
      );
      assert.equal(
        updateOwnPlatformProfileSchema.safeParse({ role: "PLATFORM_ADMIN" }).success,
        false,
        "self-service schema must not"
      );

      assert.equal(updatePlatformUserSchema.safeParse({ isActive: false }).success, true);
      assert.equal(updateOwnPlatformProfileSchema.safeParse({ isActive: false }).success, false);
    });
  });
});
