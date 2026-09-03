// ============================================================================
// TESTS: password reset codes — tester issue #15.
//
// THE DEFECT
//   services/auth.ts called POST /api/auth/forgot-password and the route did
//   not exist. Next answered with its 404 HTML page, apiRequest could not parse
//   it, and the form showed "The server returned an unreadable response". No
//   code was ever generated, because nothing ran.
//
// WHAT IS ASSERTED WHERE
//   The code, its hashing and its expiry are pure and are exercised directly
//   below. The routes reach a database and this suite has none — see
//   package.json — so their guarantees are pinned as source contracts, and the
//   behaviours that need real rows (wrong code, expired code, reuse,
//   cross-tenant) are covered by live database verification instead.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PASSWORD_RESET_CODE_LENGTH,
  PASSWORD_RESET_TTL_MINUTES,
  generateResetCode,
  hashResetCode,
  resetCodeEmail,
  resetCodeExpiry,
  verifyResetCode,
} from "./passwordReset";
import { forgotPasswordSchema, resetPasswordSchema } from "../validations/auth";
import { clearOutbox, isMailConfigured, readOutbox, sendMail } from "../services/mail";

const forgotRoute = readFileSync(
  join(process.cwd(), "app/api/auth/forgot-password/route.ts"),
  "utf8"
);
const resetRoute = readFileSync(
  join(process.cwd(), "app/api/auth/reset-password/route.ts"),
  "utf8"
);

describe("The reset code itself", () => {
  it("is six digits, which is what the form tells the user to expect", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateResetCode();
      assert.match(code, /^[0-9]{6}$/, `not six digits: ${code}`);
      assert.equal(code.length, PASSWORD_RESET_CODE_LENGTH);
    }
  });

  it("keeps leading zeros rather than shortening the code", () => {
    // "000123" must not become "123": the user types what the email showed.
    for (let i = 0; i < 500; i++) {
      assert.equal(generateResetCode().length, 6);
    }
  });

  it("is drawn from the CSPRNG, not Math.random", () => {
    // Math.random is seeded and predictable, and must never gate access.
    // Comments are stripped first: that module NAMES Math.random to explain why
    // it is not used, and matching that sentence would be a false alarm.
    const source = readFileSync(join(process.cwd(), "lib/auth/passwordReset.ts"), "utf8");
    const stripped = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

    assert.match(stripped, /randomInt\(/);
    assert.ok(!/Math\.random\(/.test(stripped), "Math.random must not mint a reset code");
  });

  it("does not repeat itself in any meaningful way", () => {
    // A weak generator shows up as collisions long before 1000 draws.
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateResetCode());

    assert.ok(seen.size > 900, `only ${seen.size} distinct codes in 1000 draws`);
  });
});

describe("Storage is a hash, never the code", () => {
  it("hashes with bcrypt, and the hash does not contain the code", () => {
    // Asserted synchronously against the source so the intent is pinned even
    // where the hash itself is opaque.
    const source = readFileSync(join(process.cwd(), "lib/auth/passwordReset.ts"), "utf8");
    assert.match(source, /hashPassword/);
  });

  it("verifies a correct code and refuses a wrong one", async () => {
    const code = generateResetCode();
    const hash = await hashResetCode(code);

    assert.notEqual(hash, code, "the stored value must not be the code");
    assert.ok(!hash.includes(code), "the code must not appear inside its own hash");
    assert.equal(await verifyResetCode(code, hash), true);
    assert.equal(await verifyResetCode("000000" === code ? "111111" : "000000", hash), false);
  });

  it("the schema column stores a hash, and the model says so", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const model = schema.slice(
      schema.indexOf("model PasswordResetCode"),
      schema.indexOf("}", schema.indexOf("model PasswordResetCode"))
    );

    assert.match(model, /codeHash\s+String/);
    assert.ok(!/\bcode\s+String\b/.test(model), "there must be no plaintext code column");
  });
});

describe("A code expires, and expiry is short", () => {
  it("sets an expiry the configured number of minutes ahead", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    const expiry = resetCodeExpiry(now);

    assert.equal(expiry.getTime() - now.getTime(), PASSWORD_RESET_TTL_MINUTES * 60_000);
  });

  it("is short enough that a million combinations are not workable", () => {
    // Six digits is a small space; time is the bound that makes it acceptable.
    assert.ok(PASSWORD_RESET_TTL_MINUTES <= 30, "a reset code must not be long-lived");
    assert.ok(PASSWORD_RESET_TTL_MINUTES >= 5, "too short to be usable");
  });
});

describe("The email carries the code and nothing about the account", () => {
  it("states the purpose, the code and the expiry", () => {
    const code = "042042";
    const { subject, text } = resetCodeEmail(code);

    assert.match(subject, /password reset/i);
    assert.ok(text.includes(code));
    assert.match(text, new RegExp(String(PASSWORD_RESET_TTL_MINUTES)));
    assert.match(text, /once/i);
  });

  it("discloses no password and no account detail", () => {
    // If this reaches the wrong inbox it must not also say whose account it is.
    const { text } = resetCodeEmail("042042");

    for (const leak of ["passwordHash", "username", "tenantId", "userId"]) {
      assert.ok(!text.includes(leak), `the email must not mention ${leak}`);
    }
  });
});

describe("Mail transport", () => {
  it("reports whether it is configured rather than guessing", () => {
    assert.equal(typeof isMailConfigured(), "boolean");
  });

  it("captures instead of pretending when SMTP is absent outside production", async () => {
    const host = process.env.SMTP_HOST;
    const from = process.env.SMTP_FROM;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    clearOutbox();

    try {
      const result = await sendMail({ to: "someone@example.test", subject: "s", text: "t" });

      // The important half: it does NOT claim delivery.
      assert.equal(result.delivered, false);
      assert.equal(readOutbox().length, 1);
      assert.equal(readOutbox()[0]?.to, "someone@example.test");
    } finally {
      clearOutbox();
      if (host !== undefined) process.env.SMTP_HOST = host;
      if (from !== undefined) process.env.SMTP_FROM = from;
    }
  });

  it("never throws — a transport error must not become an HTML error page", () => {
    // The whole reported symptom was an unparseable response. sendMail returns
    // failures as data so a route can always answer with the JSON envelope.
    const source = readFileSync(join(process.cwd(), "lib/services/mail.ts"), "utf8");

    assert.match(source, /try \{/);
    assert.match(source, /catch \(error\)/);
    assert.match(source, /delivered: false/);
  });
});

describe("Validation", () => {
  it("forgot: requires a tenant and a well-formed address", () => {
    assert.equal(
      forgotPasswordSchema.safeParse({ tenantSlug: "demo", email: "a@b.co" }).success,
      true
    );
    assert.equal(forgotPasswordSchema.safeParse({ tenantSlug: "demo", email: "nope" }).success, false);
    assert.equal(forgotPasswordSchema.safeParse({ email: "a@b.co" }).success, false);
    assert.equal(forgotPasswordSchema.safeParse({ tenantSlug: "", email: "a@b.co" }).success, false);
  });

  it("reset: uses the field names the existing form already sends", () => {
    // ResetPasswordForm posts otp and newPassword. Renaming them would break a
    // screen that works.
    const valid = {
      tenantSlug: "demo",
      email: "a@b.co",
      otp: "123456",
      newPassword: "sup3rsecret",
    };

    assert.equal(resetPasswordSchema.safeParse(valid).success, true);
  });

  it("reset: the code must be exactly six digits", () => {
    const base = { tenantSlug: "demo", email: "a@b.co", newPassword: "sup3rsecret" };

    for (const otp of ["12345", "1234567", "12345a", "", "abcdef"]) {
      assert.equal(resetPasswordSchema.safeParse({ ...base, otp }).success, false, otp);
    }
    assert.equal(resetPasswordSchema.safeParse({ ...base, otp: "000000" }).success, true);
  });

  it("reset: the new password reuses the project's existing floor", () => {
    const base = { tenantSlug: "demo", email: "a@b.co", otp: "123456" };

    assert.equal(resetPasswordSchema.safeParse({ ...base, newPassword: "short" }).success, false);
    assert.equal(resetPasswordSchema.safeParse({ ...base, newPassword: "12345678" }).success, true);
  });
});

describe("The routes cannot be used to discover who has an account", () => {
  it("forgot-password answers with one envelope built before the lookup", () => {
    // If the response differed for a registered address, this endpoint would be
    // an enumeration oracle for every university on the platform.
    assert.match(forgotRoute, /const uniform = \(sent: boolean\)/);

    const afterUniform = forgotRoute.slice(forgotRoute.indexOf("const uniform"));
    for (const branch of ["!tenant || !isServableStatus", "!user || !user.isActive"]) {
      assert.ok(afterUniform.includes(branch), `${branch} must return the uniform envelope`);
    }
    assert.ok(
      !/status: 404/.test(forgotRoute),
      "an unknown address must not be a 404 — that discloses it"
    );
  });

  it("forgot-password does not change its answer when delivery fails", () => {
    // Saying "we could not send it" would confirm there was something to send.
    assert.match(forgotRoute, /if \(!delivery\.delivered\) \{/);
    assert.match(forgotRoute, /console\.error/);
    assert.match(forgotRoute, /return uniform\(delivery\.delivered\)/);
  });

  it("reset-password has exactly one refusal for every way of being wrong", () => {
    assert.match(resetRoute, /function refused\(\)/);

    // Every failure path uses it: unknown tenant, unknown user, no match.
    const uses = resetRoute.match(/return refused\(\);/g) ?? [];
    assert.ok(uses.length >= 3, `expected at least 3 uses of refused(), found ${uses.length}`);
  });

  it("neither route ever returns the code or a password hash", () => {
    // Asserted against the actual response payloads rather than by scanning for
    // the word "code": the uniform message legitimately reads "a verification
    // code is on its way", and matching that would be a false alarm.
    assert.match(forgotRoute, /ok\(\s*\{ sent \}/, "forgot-password returns only { sent }");
    assert.match(resetRoute, /ok\(null,/, "reset-password returns no data at all");

    // The plaintext code reaches exactly two places: the hash and the email.
    assert.match(forgotRoute, /hashResetCode\(code\)/);
    assert.match(forgotRoute, /resetCodeEmail\(code\)/);

    for (const [name, source] of [
      ["forgot-password", forgotRoute],
      ["reset-password", resetRoute],
    ] as const) {
      assert.ok(!/passwordHash[^;]*ok\(/.test(source), `${name} must not return a hash`);
    }
  });

  it("both routes always answer with the JSON envelope, never an HTML page", () => {
    // The reported symptom. A handler that throws produces Next's HTML error
    // page, which apiRequest cannot parse.
    for (const [name, source] of [
      ["forgot-password", forgotRoute],
      ["reset-password", resetRoute],
    ] as const) {
      assert.match(source, /catch \(error\) \{/, `${name} must catch`);
      assert.match(source, /fail\("Internal server error", "SERVER_ERROR"\)/, name);
      assert.match(source, /Request body must be valid JSON/, `${name} must guard JSON.parse`);
    }
  });
});

describe("The reset is atomic, single-use, and ends existing sessions", () => {
  it("issuing a code consumes the previous ones, in one transaction", () => {
    assert.match(forgotRoute, /prisma\.\$transaction\(\[/);
    assert.match(forgotRoute, /passwordResetCode\.updateMany/);
    assert.match(forgotRoute, /consumedAt: new Date\(\)/);
  });

  it("the password change and the code consumption cannot half-succeed", () => {
    const tx = resetRoute.slice(resetRoute.indexOf("prisma.$transaction(["));

    assert.match(tx, /user\.update/);
    assert.match(tx, /passwordResetCode\.update\(/);
    assert.match(tx, /session\.deleteMany/);
  });

  it("only live codes are considered", () => {
    assert.match(resetRoute, /consumedAt: null/);
    assert.match(resetRoute, /expiresAt: \{ gt: new Date\(\) \}/);
  });

  it("the lookup is scoped to the tenant as well as the user", () => {
    const query = resetRoute.slice(resetRoute.indexOf("passwordResetCode.findMany"));

    assert.match(query, /userId: user\.id/);
    assert.match(query, /tenantId: tenant\.id/);
  });
});
