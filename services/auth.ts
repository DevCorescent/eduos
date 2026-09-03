// ============================================================================
// MODULE : Services — Authentication
// PURPOSE: The four auth flows the UI calls, each a thin wrapper over its route
//          so that no page touches fetch directly.
//
// ALL FOUR NOW HAVE A ROUTE BEHIND THEM
//   POST /api/auth/forgot-password and POST /api/auth/reset-password were
//   specified in FRONTEND.md and had no handler under app/api, so Next answered
//   with its 404 HTML page, apiRequest could not parse it, and the screens
//   showed "the server returned an unreadable response" — tester issue #15.
//   The routes exist as of that fix. Nothing in this file changed to
//   accommodate them: they were written to the contract these calls already
//   assumed, which is why the field names below are `otp` and `newPassword`.
// ============================================================================

import type { ApiResponse, AuthUser } from "@/types";
import { apiRequest } from "./client";

export interface LoginInput {
  tenantSlug: string;
  email: string;
  password: string;
}

export interface ForgotPasswordInput {
  tenantSlug: string;
  email: string;
}

export interface ResetPasswordInput {
  tenantSlug: string;
  email: string;
  otp: string;
  newPassword: string;
}

/**
 * Sign in.
 *
 * RETURNS : the envelope, with `data.user` carrying the roles that decide which
 *           portal to land on. The caller reads `user.roles` and passes it to
 *           homeRouteForRoles — this service does not navigate.
 *
 * The session cookies are set by the route's own Set-Cookie headers, so nothing
 * is stored here.
 */
export async function login(input: LoginInput): Promise<ApiResponse<{ user: AuthUser }>> {
  return apiRequest<{ user: AuthUser }>("/api/auth/login", {
    method: "POST",
    body: input,
  });
}

/** Sign out. The route clears the session cookies it set. */
export async function logout(): Promise<ApiResponse<null>> {
  return apiRequest<null>("/api/auth/logout", { method: "POST" });
}

/**
 * Request a password-reset code.
 *
 * Must succeed whether or not the address is registered — a differing response
 * turns the form into an account-enumeration oracle.
 */
export async function forgotPassword(
  input: ForgotPasswordInput
): Promise<ApiResponse<{ sent: true }>> {
  return apiRequest<{ sent: true }>("/api/auth/forgot-password", {
    method: "POST",
    body: input,
  });
}

/**
 * Complete a password reset.
 *
 * `tenantSlug` and `email` travel with the code because a one-time code is only
 * meaningful against the account that requested it, and tenantSlug + email is
 * what identifies a user in this schema — User is unique on
 * @@unique([tenantId, email]), so the address alone is ambiguous across tenants.
 */
export async function resetPassword(input: ResetPasswordInput): Promise<ApiResponse<null>> {
  return apiRequest<null>("/api/auth/reset-password", {
    method: "POST",
    body: input,
  });
}
