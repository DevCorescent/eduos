// ============================================================================
// MODULE : Validation — telephone numbers
// LAYER  : Shared Zod field. No database, no environment.
// PURPOSE: One definition of "is this a phone number", for every field that
//          stores one.
//
// WHY THIS FILE EXISTS
//   The rule was written for tester issue #12 (a university's contact phone)
//   and lived privately inside lib/validations/platform.ts. Issues #18 and #24
//   then reported the same defect on two more screens — Add Campus and Enrol
//   Student — where `phone` was `z.string().trim().min(1)` and a single digit
//   was storable. Copying the regex into two more schemas would have created
//   three definitions of one rule, which drift the moment anybody edits one.
//   The rule moved here unchanged; platform.ts now imports it, so #12 keeps
//   exactly the behaviour its tests already pin.
//
// DELIBERATELY NOT AN INDIAN RULE
//   The seed data and every form placeholder are +91, and Tenant defaults
//   country to "IN" — but nothing in the PRD or anywhere in this repository
//   states a required phone format. A +91-only rule would invent a requirement
//   and reject the first overseas institution, campus or student.
//
// THE BOUNDS
//   Fifteen digits is the maximum length of an international telephone number
//   under ITU-T E.164 — a real standard, and the answer to "too many digits".
//   Seven is a conservative floor for the "too few" half: short enough to
//   accept any real subscriber number reachable with a country code, long
//   enough to reject the "1" the tester was able to save. It is the one bound
//   here not backed by a written standard, and it is stated plainly rather
//   than hidden so it can be changed if a specification appears.
//
//   Separators are permitted but not required, so "+91 90000 00000",
//   "+91-90000-00000", "(022) 2222 3333" and "9000000000" are all accepted;
//   the digits are what is counted.
// ============================================================================

import { z } from "zod";

/**
 * A plausible telephone shape: an optional leading +, then digits with spaces,
 * hyphens, brackets or dots between them.
 *
 * The first character after the optional + must be a digit or an opening
 * bracket, which is what rejects "abc", "++91 …" and "-9000000000".
 */
export const PHONE_SHAPE = /^\+?[0-9(][0-9\s().-]*$/;

export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_DIGITS = 15;

/** The digits alone, which is what the length rule applies to. */
export function phoneDigits(value: string): number {
  return value.replace(/[^0-9]/g, "").length;
}

export const PHONE_SHAPE_MESSAGE =
  "Enter a valid phone number using digits, and optionally a leading + and spaces, hyphens or brackets.";

export const PHONE_LENGTH_MESSAGE = `Enter between ${PHONE_MIN_DIGITS} and ${PHONE_MAX_DIGITS} digits.`;

/**
 * A telephone number, as a Zod field.
 *
 * Required as written; callers append `.optional()` where the column is
 * nullable — which is every current use. Two separate refinements rather than
 * one, so the message names the actual fault: "that is not a phone number" and
 * "that is the wrong number of digits" are different corrections.
 */
export const phoneField = z
  .string()
  .trim()
  .min(1)
  .refine((value) => PHONE_SHAPE.test(value), { message: PHONE_SHAPE_MESSAGE })
  .refine(
    (value) => phoneDigits(value) >= PHONE_MIN_DIGITS && phoneDigits(value) <= PHONE_MAX_DIGITS,
    { message: PHONE_LENGTH_MESSAGE }
  );
