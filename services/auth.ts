// ============================================================================
// MODULE : Services — Authentication
// PURPOSE: The four auth flows the UI calls, behind one interface that hides
//          whether they are served by the API or by fixtures.
//
//          Two of the four have no backend yet: POST /api/auth/forgot-password
//          and /api/auth/reset-password appear in the frontend plan but not
//          under app/api. They are written here against the contract the other
//          routes follow, so wiring them up later is a change to this file
//          alone — no page touches fetch directly.
// ============================================================================

import type { ApiResponse, AuthUser } from "@/types";
import {
  MOCK_SESSION_COOKIE,
  encodeMockSession,
  type MockSessionPayload,
} from "@/constants/mockSession";
import { apiRequest } from "./client";
import { USE_MOCKS } from "./config";
import {
  mockForgotPassword,
  mockLogin,
  mockLogout,
  mockResetPassword,
} from "@/mock/auth";

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
 * Persist the chosen demo identity for the server-side portal guards.
 *
 * Written from the browser because that is where a form submit runs; a Server
 * Component cannot set a cookie during render. Deliberately not httpOnly — it
 * holds no secret, and services/session.ts refuses to honour it outside
 * development anyway.
 *
 * SameSite=Lax matches the real session cookies set by the login route.
 */
function writeMockSession(payload: MockSessionPayload): void {
  if (typeof document === "undefined") return;
  document.cookie = `${MOCK_SESSION_COOKIE}=${encodeMockSession(payload)}; path=/; max-age=${60 * 60 * 24}; SameSite=Lax`;
}

function clearMockSession(): void {
  if (typeof document === "undefined") return;
  // Expiring in the past is the only way to remove a cookie; the path must
  // match the one it was written with or the browser deletes nothing.
  document.cookie = `${MOCK_SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

/**
 * Sign in.
 *
 * RETURNS : the envelope, with `data.user` carrying the roles that decide which
 *           portal to land on. The caller reads `user.roles` and passes it to
 *           homeRouteForRoles — this service does not navigate.
 *
 * On the live path the session cookies are set by the route's Set-Cookie
 * headers, so nothing is stored here. On the mock path there is no server to do
 * that, hence writeMockSession.
 */
export async function login(input: LoginInput): Promise<ApiResponse<{ user: AuthUser }>> {
  if (USE_MOCKS) {
    const result = await mockLogin(input);
    if (result.success) {
      writeMockSession({ email: result.data.user.email, roles: result.data.user.roles });
    }
    return result;
  }

  return apiRequest<{ user: AuthUser }>("/api/auth/login", {
    method: "POST",
    body: input,
  });
}

/**
 * Sign out.
 *
 * The mock cookie is cleared on both paths and before the request, not after.
 * If the network call fails the user has still asked to leave, and leaving a
 * stale identity behind would silently sign them back in on the next
 * navigation.
 */
export async function logout(): Promise<ApiResponse<null>> {
  clearMockSession();

  if (USE_MOCKS) return mockLogout();

  return apiRequest<null>("/api/auth/logout", { method: "POST" });
}

/**
 * Request a password-reset code.
 *
 * Succeeds whether or not the address is registered — see mockForgotPassword
 * for why, and note the live endpoint must do the same when it is built.
 */
export async function forgotPassword(
  input: ForgotPasswordInput
): Promise<ApiResponse<{ sent: true }>> {
  if (USE_MOCKS) return mockForgotPassword();

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
export async function resetPassword(
  input: ResetPasswordInput
): Promise<ApiResponse<null>> {
  if (USE_MOCKS) return mockResetPassword(input);

  return apiRequest<null>("/api/auth/reset-password", {
    method: "POST",
    body: input,
  });
}
