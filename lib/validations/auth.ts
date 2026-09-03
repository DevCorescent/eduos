import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  tenantSlug: z.string().min(1),
});

export const registerSchema = z.object({
  tenantSlug: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Step one of the self-service reset — tester issue #15.
 *
 * tenantSlug travels with the address because an email is only unique WITHIN a
 * university: User is unique on (tenantId, email), so an address alone is
 * ambiguous across tenants and could not identify an account.
 */
export const forgotPasswordSchema = z.object({
  tenantSlug: z.string().trim().min(1),
  email: z.string().trim().email(),
});

/**
 * Step two — tester issue #15.
 *
 * The field names are `otp` and `newPassword` because that is what
 * ResetPasswordForm already sends and services/auth.ts already declares.
 * Renaming them here would break a screen that works, to no benefit.
 *
 * The code is exactly six digits, matching PASSWORD_RESET_CODE_LENGTH and the
 * message the form shows before it will submit. `newPassword` reuses the same
 * `min(8)` floor as loginSchema and registerSchema rather than inventing a
 * second password policy.
 */
export const resetPasswordSchema = z.object({
  tenantSlug: z.string().trim().min(1),
  email: z.string().trim().email(),
  otp: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, "The code is 6 digits."),
  newPassword: z.string().min(8),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
