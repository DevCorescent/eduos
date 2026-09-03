// ============================================================================
// MODULE : Auth — password reset codes
// LAYER  : Domain + hashing. No database, no request, no environment.
// PURPOSE: Mint, hash and check the one-time code the reset flow is built on.
//
// SIX DIGITS, BECAUSE THE UI ALREADY SAYS SO
//   ResetPasswordForm validates "The code is 6 digits" and the field is an OTP
//   input. The length is therefore not a free choice here; it is the contract
//   the screen already advertises to the person reading it off an email.
//
// WHY crypto.randomInt AND NOT Math.random
//   Math.random is seeded, predictable, and never appropriate for anything that
//   grants access. randomInt draws from the platform CSPRNG and is uniform over
//   the range — a modulo of a random byte would not be, and the bias would
//   concentrate codes in a predictable band.
//
// SIX DIGITS IS A MILLION COMBINATIONS, WHICH IS NOT MUCH
//   That is acceptable ONLY because the code is short-lived, single-use, and
//   scoped to one (tenant, email) pair. The bound that actually matters is
//   time: see PASSWORD_RESET_TTL_MINUTES. Anything longer would turn a
//   guessable space into a practical one.
// ============================================================================

import { randomInt } from "node:crypto";
import { hashPassword, verifyPassword } from "./password";

/** Digits in a reset code. Fixed by what ResetPasswordForm tells the user. */
export const PASSWORD_RESET_CODE_LENGTH = 6;

/**
 * How long a code stays usable.
 *
 * Fifteen minutes: long enough to find the mail, short enough that a million
 * combinations cannot be worked through against a live account.
 */
export const PASSWORD_RESET_TTL_MINUTES = 15;

/** A cryptographically random six-digit code, leading zeros preserved. */
export function generateResetCode(): string {
  // randomInt is uniform over [0, 1_000_000); padStart keeps "000123" six
  // characters long rather than silently becoming "123", which would not match
  // what the user was told to type.
  return String(randomInt(0, 1_000_000)).padStart(PASSWORD_RESET_CODE_LENGTH, "0");
}

/**
 * Hash a code for storage.
 *
 * bcrypt, through the same helper the password column uses. A fast digest would
 * be the wrong tool: six digits is a small enough space that SHA-256 over the
 * whole range is trivial, whereas bcrypt at this project's cost factor makes an
 * offline sweep of a leaked table impractical.
 */
export async function hashResetCode(code: string): Promise<string> {
  return hashPassword(code);
}

/** Check a submitted code against its stored hash. */
export async function verifyResetCode(code: string, hash: string): Promise<boolean> {
  return verifyPassword(code, hash);
}

/** When a code minted now stops being usable. */
export function resetCodeExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60_000);
}

/** The message body. Carries the code and nothing else about the account. */
export function resetCodeEmail(code: string): { subject: string; text: string } {
  return {
    subject: "Your password reset code",
    text: [
      "You asked to reset your password.",
      "",
      `Your verification code is: ${code}`,
      "",
      `The code expires in ${PASSWORD_RESET_TTL_MINUTES} minutes and can be used once.`,
      "",
      // No name, no username, no tenant, no link carrying a token. If this mail
      // reaches the wrong inbox it must not also tell the reader whose account
      // it belongs to.
      "If you did not request this, you can ignore this message and your password will stay as it is.",
    ].join("\n"),
  };
}
