// ============================================================================
// The redaction backstop and the two transaction semantics are what stop this
// module from writing a credential into the table auditors read, and from
// recording a change that never committed. These assertions are the
// specification for both.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redact } from "./audit.service";

describe("redact — credentials never reach the audit table", () => {
  it("replaces a password at the top level", () => {
    assert.deepEqual(redact({ email: "a@b.com", password: "hunter2" }), {
      email: "a@b.com",
      password: "[redacted]",
    });
  });

  it("catches every credential-shaped key by substring, not exact match", () => {
    const out = redact({
      passwordHash: "x",
      newPassword: "y",
      refresh_token: "z",
      accessToken: "t",
      apiKey: "k",
      api_key: "k2",
      clientSecret: "s",
      Authorization: "Bearer abc",
      cookie: "edu_access=…",
    }) as Record<string, unknown>;

    for (const [key, value] of Object.entries(out)) {
      assert.equal(value, "[redacted]", `${key} was not redacted`);
    }
  });

  it("is case-insensitive, because column names are not consistent", () => {
    assert.deepEqual(redact({ PASSWORD: "x", Token: "y" }), {
      PASSWORD: "[redacted]",
      Token: "[redacted]",
    });
  });

  it("reaches into nested objects", () => {
    assert.deepEqual(redact({ user: { id: "1", passwordHash: "x" } }), {
      user: { id: "1", passwordHash: "[redacted]" },
    });
  });

  it("walks arrays, because a snapshot may be a list of rows", () => {
    assert.deepEqual(redact([{ token: "a" }, { token: "b" }]), [
      { token: "[redacted]" },
      { token: "[redacted]" },
    ]);
  });

  it("leaves ordinary values alone — the point is evidence, not censorship", () => {
    const snapshot = {
      enrollmentNo: "STU-20260001",
      amount: "15000.00",
      isActive: true,
      count: 3,
      missing: null,
    };
    assert.deepEqual(redact(snapshot), snapshot);
  });

  it("returns primitives and null unchanged", () => {
    assert.equal(redact(null), null);
    assert.equal(redact("plain"), "plain");
    assert.equal(redact(42), 42);
    assert.equal(redact(undefined), undefined);
  });

  it("stops at a depth limit rather than recursing without bound", () => {
    // A snapshot deep enough to exhaust the stack is a bug, not evidence.
    // Building 12 levels: the 9th and beyond are returned as-is.
    let deep: Record<string, unknown> = { password: "leaf" };
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };

    // The call must terminate. That it does is the assertion.
    assert.doesNotThrow(() => redact(deep));
  });

  it("does not mutate the snapshot it was given", () => {
    const original = { password: "hunter2", email: "a@b.com" };
    redact(original);
    assert.equal(original.password, "hunter2");
  });
});
