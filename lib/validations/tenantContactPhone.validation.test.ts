// ============================================================================
// TESTS: a university's contact phone number — tester issue #12.
//
// THE COMPLAINT
//   "Phone number validation is not implemented, allowing invalid phone numbers
//   to be entered while creating a university." contactPhone was
//   `z.string().min(1)`, so a single digit and a line of prose were both stored
//   as an institution's published contact number.
//
// WHAT THESE DELIBERATELY DO NOT ASSERT
//   Any Indian-specific rule. The seed data and the form placeholder are +91,
//   and Tenant defaults country to "IN", but nothing in the PRD or this
//   repository states a required phone format — so the rule is international
//   and these tests pin that it stays international. A future +91-only regex
//   would fail the overseas cases below, which is the point of having them.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTenantSchema, provisionTenantSchema, updateTenantSchema } from "./platform";

/** The minimum a tenant needs to be valid, so only the phone is under test. */
const BASE = { slug: "test-university", name: "Test University" };

const accepts = (phone: string) =>
  createTenantSchema.safeParse({ ...BASE, contactPhone: phone }).success;

describe("contactPhone — valid numbers are still accepted", () => {
  it("accepts the format the project already uses", () => {
    // The exact value an existing test in admission.validation.test.ts asserts
    // is valid. Breaking it would have been a regression dressed as a fix.
    assert.equal(accepts("+91 90000 00000"), true);
  });

  it("accepts the form's own placeholder", () => {
    assert.equal(accepts("+91 98765 43210"), true);
  });

  it("accepts plain digits, with no country code or separators", () => {
    assert.equal(accepts("9000000000"), true);
  });

  it("accepts hyphens, brackets and a bracketed area code", () => {
    assert.equal(accepts("+91-90000-00000"), true);
    assert.equal(accepts("(022) 2222 3333"), true);
  });

  it("accepts numbers from outside India", () => {
    // The rule must not assume the country EduOS happens to have seeded.
    assert.equal(accepts("+1 (555) 123-4567"), true);
    assert.equal(accepts("+44 20 7946 0958"), true);
    assert.equal(accepts("+81 3 1234 5678"), true);
  });

  it("stays optional — a university need not publish a phone number", () => {
    assert.equal(createTenantSchema.safeParse(BASE).success, true);
  });
});

describe("contactPhone — the tester's invalid inputs are refused", () => {
  it("REFUSES too few digits", () => {
    // The tester's exact scenario. "1" was previously stored.
    assert.equal(accepts("1"), false);
    assert.equal(accepts("12345"), false);
    assert.equal(accepts("+91 123"), false);
  });

  it("REFUSES too many digits", () => {
    // Sixteen digits exceeds the ITU-T E.164 maximum of fifteen.
    assert.equal(accepts("1234567890123456"), false);
    assert.equal(accepts("+91 90000 00000 00000"), false);
  });

  it("accepts exactly the boundary lengths", () => {
    assert.equal(accepts("1234567"), true, "seven digits is the floor");
    assert.equal(accepts("123456789012345"), true, "fifteen digits is E.164's ceiling");
  });

  it("REFUSES text and malformed values", () => {
    assert.equal(accepts("not a phone"), false);
    assert.equal(accepts("+91 90000 0000a"), false);
    assert.equal(accepts("++91 9000000000"), false);
    assert.equal(accepts("-9000000000"), false);
    assert.equal(accepts("   "), false);
  });

  it("REFUSES an extension suffix rather than silently storing it", () => {
    // Not a judgement that extensions are worthless — there is simply no
    // defined place to put one, and accepting the text would put it in the
    // dialable number.
    assert.equal(accepts("+91 90000 00000 ext 5"), false);
  });
});

describe("the rule cannot be bypassed by another route", () => {
  it("applies to provisioning, which is the tester's flow", () => {
    assert.equal(
      provisionTenantSchema.safeParse({ ...BASE, contactPhone: "1" }).success,
      false
    );
    assert.equal(
      provisionTenantSchema.safeParse({ ...BASE, contactPhone: "+91 90000 00000" }).success,
      true
    );
  });

  it("applies to editing, so a bad value cannot arrive later", () => {
    // updateTenantSchema is createTenantSchema.partial(), so it inherits the
    // field. Asserted anyway: a future rewrite that stops deriving it would
    // reopen the hole on a route nobody re-checked.
    assert.equal(updateTenantSchema.safeParse({ contactPhone: "1" }).success, false);
    assert.equal(updateTenantSchema.safeParse({ contactPhone: "+91 90000 00000" }).success, true);
  });
});

describe("the form's copy of the rule matches the API's", () => {
  it("uses an identical pattern and identical digit bounds", () => {
    // The form restates the rule because lib/validations/platform.ts pulls in
    // Zod and the generated Prisma enums, which do not belong in a client
    // bundle — the same reason SLUG_PATTERN is duplicated there. Duplication is
    // fine; drift is not, because the field would then refuse client-side what
    // the API accepts, or worse, the reverse.
    // The rule moved to lib/validations/phone.ts when issues #18 and #24 needed
    // the same validation on Add Campus and Enrol Student. Behaviour is
    // unchanged — every acceptance and rejection asserted above still runs
    // against createTenantSchema — but the single definition now lives there,
    // so that is where the drift check reads it from.
    const schema = readFileSync(join(process.cwd(), "lib/validations/phone.ts"), "utf8");
    const form = readFileSync(
      join(process.cwd(), "app/(platform)/platform/tenants/new/ProvisionUniversityForm.tsx"),
      "utf8"
    );

    // Both literals are extracted and compared as text, rather than matched
    // against a third regex describing them — escaping a pattern that itself
    // contains escapes is how this assertion silently stops checking anything.
    const literalOf = (source: string, name: string): string => {
      const found = new RegExp(`const ${name} = (/.+/);`).exec(source);
      assert.ok(found, `${name} not found — has it been renamed?`);
      return found[1];
    };

    const apiPattern = literalOf(schema, "PHONE_SHAPE");
    const formPattern = literalOf(form, "CONTACT_PHONE_PATTERN");

    assert.equal(
      formPattern,
      apiPattern,
      "the form's phone pattern has drifted from the API's"
    );

    for (const bound of ["MIN_DIGITS = 7", "MAX_DIGITS = 15"]) {
      assert.ok(schema.includes(bound), `the shared rule lost ${bound}`);
      assert.ok(form.includes(bound), `the form lost ${bound}`);
    }
  });

  it("shows the message beside the field", () => {
    // Without the error prop the form validates and then says nothing, which
    // reads as a dead Save button.
    const form = readFileSync(
      join(process.cwd(), "app/(platform)/platform/tenants/new/ProvisionUniversityForm.tsx"),
      "utf8"
    );

    assert.match(form, /error=\{fieldErrors\.contactPhone\}/);
  });
});
