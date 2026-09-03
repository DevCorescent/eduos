// ============================================================================
// TESTS: phone validation on Add Campus (#18) and Enrol Student (#24).
//
// THE COMPLAINT, TWICE
//   "Phone number validation is not implemented, allowing invalid phone numbers
//   to be entered." Reported against Add Campus and again against Enrol
//   Student. Both fields were `z.string().trim().min(1).optional()`, so "1" and
//   a line of prose were equally storable.
//
// WHERE EACH ONE IS ACTUALLY VALIDATED
//   Campus  — createCampusSchema.phone. updateCampusSchema is that schema
//             .partial(), so editing is covered by the same rule.
//   Student — createUserSchema.phone. Enrolling a student writes the person as
//             a User and Student carries no phone column of its own, so this is
//             the only server boundary the enrolment form crosses.
//
// ONE RULE, NOT THREE
//   The rule came from issue #12 and lived privately inside
//   lib/validations/platform.ts. Rather than copy the regex into two more
//   schemas, it moved to lib/validations/phone.ts and all three import it.
//   These tests exercise the real schemas, so they prove the rule is actually
//   reaching each boundary rather than merely that the shared module exists.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCampusSchema, updateCampusSchema } from "./campus";
import { createUserSchema, updateUserSchema } from "./user";
import { createTenantSchema } from "./platform";
import { PHONE_MAX_DIGITS, PHONE_MIN_DIGITS, phoneDigits } from "./phone";

/** The minimum a campus needs, so only the phone is under test. */
const CAMPUS = { name: "Jaipur Main Campus", code: "JMC" };

/** The minimum a user needs, so only the phone is under test. */
const USER = {
  email: "student@university.edu",
  password: "Sup3rSecret!",
  firstName: "Asha",
  lastName: "Rao",
};

const campusAccepts = (phone: string) =>
  createCampusSchema.safeParse({ ...CAMPUS, phone }).success;

const userAccepts = (phone: string) =>
  createUserSchema.safeParse({ ...USER, phone }).success;

/** Values every screen in this project must keep accepting. */
const VALID = [
  "+91 90000 00000", // the format an existing project test already pins
  "+91 98765 43210", // the faculty/student form placeholder
  "+91 141 4000 100", // the Add Campus form placeholder
  "9000000000", // no country code, no separators
  "+91-90000-00000", // hyphens
  "(022) 2222 3333", // bracketed area code
  "+1 (555) 123-4567", // not India
  "+44 20 7946 0958",
];

const INVALID_TOO_SHORT = ["1", "12345", "+91 123", "123456"];
const INVALID_TOO_LONG = ["1234567890123456", "+91 90000 00000 00000"];
const INVALID_MALFORMED = [
  "not a phone",
  "+91 90000 0000a",
  "++91 9000000000",
  "-9000000000",
  "   ",
  "+91 90000 00000 ext 5",
];

describe("#18 — Add Campus rejects an invalid phone at the server boundary", () => {
  it("accepts every phone format this project already uses", () => {
    for (const phone of VALID) {
      assert.equal(campusAccepts(phone), true, `campus should accept ${phone}`);
    }
  });

  it("REJECTS too few digits — the tester's exact case", () => {
    for (const phone of INVALID_TOO_SHORT) {
      assert.equal(campusAccepts(phone), false, `campus should reject ${phone}`);
    }
  });

  it("REJECTS too many digits", () => {
    for (const phone of INVALID_TOO_LONG) {
      assert.equal(campusAccepts(phone), false, `campus should reject ${phone}`);
    }
  });

  it("REJECTS malformed values", () => {
    for (const phone of INVALID_MALFORMED) {
      assert.equal(campusAccepts(phone), false, `campus should reject ${phone}`);
    }
  });

  it("stays optional — a campus need not publish a phone number", () => {
    assert.equal(createCampusSchema.safeParse(CAMPUS).success, true);
  });

  it("covers editing too, so a bad value cannot arrive later", () => {
    // updateCampusSchema is createCampusSchema.partial(). Asserted anyway: a
    // rewrite that stopped deriving it would reopen the hole on a route nobody
    // re-checked.
    assert.equal(updateCampusSchema.safeParse({ phone: "1" }).success, false);
    assert.equal(updateCampusSchema.safeParse({ phone: "+91 90000 00000" }).success, true);
  });
});

describe("#24 — Enrol Student rejects an invalid phone at the server boundary", () => {
  it("accepts every phone format this project already uses", () => {
    for (const phone of VALID) {
      assert.equal(userAccepts(phone), true, `enrolment should accept ${phone}`);
    }
  });

  it("REJECTS too few digits — the tester's exact case", () => {
    for (const phone of INVALID_TOO_SHORT) {
      assert.equal(userAccepts(phone), false, `enrolment should reject ${phone}`);
    }
  });

  it("REJECTS too many digits", () => {
    for (const phone of INVALID_TOO_LONG) {
      assert.equal(userAccepts(phone), false, `enrolment should reject ${phone}`);
    }
  });

  it("REJECTS malformed values", () => {
    for (const phone of INVALID_MALFORMED) {
      assert.equal(userAccepts(phone), false, `enrolment should reject ${phone}`);
    }
  });

  it("stays optional — a student need not supply a phone number", () => {
    assert.equal(createUserSchema.safeParse(USER).success, true);
  });

  it("covers editing too", () => {
    assert.equal(updateUserSchema.safeParse({ phone: "1" }).success, false);
    assert.equal(updateUserSchema.safeParse({ phone: "+91 90000 00000" }).success, true);
  });
});

describe("The rule is shared, so the three screens cannot disagree", () => {
  it("campus, enrolment and the university contact number all answer alike", () => {
    // The point of moving the rule out of platform.ts. If any of the three ever
    // grows its own copy, one of these rows stops matching.
    for (const phone of [...VALID, ...INVALID_TOO_SHORT, ...INVALID_TOO_LONG]) {
      const tenant = createTenantSchema.safeParse({
        slug: "test-university",
        name: "Test University",
        contactPhone: phone,
      }).success;

      assert.equal(
        campusAccepts(phone),
        tenant,
        `campus and university disagree about ${phone}`
      );
      assert.equal(
        userAccepts(phone),
        tenant,
        `enrolment and university disagree about ${phone}`
      );
    }
  });

  it("+91 90000 00000 remains valid everywhere — the existing convention", () => {
    // Called out separately because an existing project test already pins this
    // value, and #18/#24 must not have changed what it means.
    assert.equal(campusAccepts("+91 90000 00000"), true);
    assert.equal(userAccepts("+91 90000 00000"), true);
    assert.equal(phoneDigits("+91 90000 00000"), 12);
  });

  it("the boundaries are exactly the documented ones", () => {
    const shortest = "1".repeat(PHONE_MIN_DIGITS);
    const longest = "1".repeat(PHONE_MAX_DIGITS);

    assert.equal(campusAccepts(shortest), true);
    assert.equal(userAccepts(shortest), true);
    assert.equal(campusAccepts(longest), true);
    assert.equal(userAccepts(longest), true);

    assert.equal(campusAccepts("1".repeat(PHONE_MIN_DIGITS - 1)), false);
    assert.equal(userAccepts("1".repeat(PHONE_MAX_DIGITS + 1)), false);
  });
});

describe("The forms check the same rule before submitting", () => {
  it("Add Campus uses the tel field kind rather than plain text", () => {
    // EntityFormModal generates its inputs from a declarative list and the API
    // answers a rejection with a generic "Invalid input" whose details never
    // reach the client, so without this the user would get a banner that does
    // not say which field is wrong.
    const page = readFileSync(
      join(process.cwd(), "app/(university)/setup/campuses/page.tsx"),
      "utf8"
    );

    assert.match(page, /kind: "tel", name: "phone"/);
  });

  it("the tel kind validates through the shared rule, not a copy", () => {
    const modal = readFileSync(
      join(process.cwd(), "components/shared/EntityFormModal.tsx"),
      "utf8"
    );

    assert.match(modal, /from "@\/lib\/validations\/phone"/);
    assert.match(modal, /field\.kind === "tel"/);
    assert.match(modal, /PHONE_SHAPE\.test\(phone\)/);
  });

  it("Enrol Student validates the phone step and shows it on the field", () => {
    const wizard = readFileSync(
      join(process.cwd(), "app/(university)/students/EnrolStudentWizard.tsx"),
      "utf8"
    );

    assert.match(wizard, /from "@\/lib\/validations\/phone"/);
    assert.match(wizard, /errors\.phone = PHONE_SHAPE_MESSAGE/);
    assert.match(wizard, /error=\{fieldErrors\.phone\}/);
  });
});
