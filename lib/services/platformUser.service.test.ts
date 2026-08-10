// ============================================================================
// OWNER  : Gauransh
// MODULE : Platform Users (W1.3)
// LAYER  : Service — Unit Tests
// PURPOSE: Pin down the one pure, security-relevant function in this service:
//          the generator that produces a password an operator will be handed.
//
//          Everything else in the module is Prisma work, which needs a database
//          rather than a unit test — the routes' behaviour around it is proved
//          by the validation suite and the guard's own tests.
//
//          These assertions are deliberately about PROPERTIES, not values. A
//          test that pinned an exact string would only prove the generator is
//          deterministic, which is the precise thing it must not be.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { generateTemporaryPassword } from "@/lib/services/platformUser.service";

describe("generateTemporaryPassword", () => {
  it("produces a 16-character password", () => {
    assert.equal(generateTemporaryPassword().length, 16);
  });

  it("uses only unambiguous characters", () => {
    // O/0 and I/l/1 are excluded on purpose: this value gets read aloud and
    // copied off a screen, and an indistinguishable pair turns into a support
    // ticket that looks exactly like a wrong password.
    const allowed = /^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;

    for (let i = 0; i < 200; i += 1) {
      const password = generateTemporaryPassword();
      assert.match(password, allowed, `unexpected character in ${password}`);
    }
  });

  it("does not repeat", () => {
    // Not a randomness test — a real one belongs to node:crypto, which this
    // delegates to. It catches the failure that actually happens: a generator
    // refactored onto a fixed seed, a cached value, or a constant.
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generateTemporaryPassword());

    assert.equal(seen.size, 500);
  });
});
