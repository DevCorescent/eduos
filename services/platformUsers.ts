// ============================================================================
// MODULE : Services — Platform Users (W1.3)
// PURPOSE: Every platform-operator read and write the console performs.
//
//          The list function names the key the route nests its rows under
//          ("users"), which apiList normalises to `items`. That one string is
//          the whole of the backend's list shape for this collection, and it is
//          confined here — no page sees it.
//
//          No page imports Prisma, and no page calls fetch(): the flow is
//          UI → this module → services/client → route → guard → Zod → service.
// ============================================================================

import type { ApiResponse, ListParams, PaginatedResult, PlatformUser } from "@/types";
import { apiList, apiRequest } from "./client";

/** The one platform role W1.3 supports. Mirrors PLATFORM_ROLE_NAMES. */
export type PlatformRoleName = "PLATFORM_ADMIN";

/** Writable fields on create. Mirrors createPlatformUserSchema. */
export interface CreatePlatformUserInput {
  firstName: string;
  lastName: string;
  email: string;
  role: PlatformRoleName;
}

/**
 * Writable fields on update. Every key optional; `isActive` is update-only.
 *
 * No password field, deliberately — one operator does not choose another's
 * credential. resetPlatformUserPassword is the only way a password changes from
 * this screen, and it accepts no value.
 */
export type UpdatePlatformUserInput = Partial<CreatePlatformUserInput> & {
  isActive?: boolean;
};

/**
 * What creating an operator, or resetting one, hands back.
 *
 * The plaintext is present exactly once, in this response. It is never stored
 * and never re-fetchable: a caller that discards it must issue a fresh reset.
 */
export interface PlatformUserCredential {
  user: PlatformUser;
  temporaryPassword: string;
}

/**
 * One page of platform operators.
 *
 * `q` is REAL here, unlike on the tenant and subscription listings: the backend
 * route validates it and the service matches email, firstName and lastName
 * case-insensitively. That is why the users page renders an enabled search box
 * where the tenants page renders a disabled one with an explanation.
 */
export async function listPlatformUsers(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<PlatformUser>>> {
  return apiList<PlatformUser>("/api/platform/users", "users", params);
}

export async function getPlatformUser(id: string): Promise<ApiResponse<PlatformUser>> {
  return apiRequest<PlatformUser>(`/api/platform/users/${id}`);
}

export async function createPlatformUser(
  input: CreatePlatformUserInput
): Promise<ApiResponse<PlatformUserCredential>> {
  return apiRequest<PlatformUserCredential>("/api/platform/users", {
    method: "POST",
    body: input,
  });
}

/**
 * Update an operator, including activation and deactivation.
 *
 * `{ isActive: false }` is the deactivate action and `{ isActive: true }` the
 * activate one — there is no separate endpoint, because both are the same write
 * and a second route would only be a different name for it.
 */
export async function updatePlatformUser(
  id: string,
  input: UpdatePlatformUserInput
): Promise<ApiResponse<PlatformUser>> {
  return apiRequest<PlatformUser>(`/api/platform/users/${id}`, {
    method: "PATCH",
    body: input,
  });
}

/**
 * Issue a fresh temporary password for an operator who has lost access.
 *
 * Sends no body: there is no input by which the new secret can be influenced.
 */
export async function resetPlatformUserPassword(
  id: string
): Promise<ApiResponse<PlatformUserCredential>> {
  return apiRequest<PlatformUserCredential>(`/api/platform/users/${id}/reset-password`, {
    method: "POST",
  });
}

/**
 * Change the signed-in operator's OWN password.
 *
 * Not under /api/platform: it is an authentication concern and is the one route
 * an operator holding a generated password may still reach. The current
 * password is required rather than trusted-because-signed-in — an unattended
 * session should not be enough to take the account over permanently.
 */
export async function changeOwnPlatformPassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<ApiResponse<null>> {
  return apiRequest<null>("/api/super-admin/auth/change-password", {
    method: "POST",
    body: input,
  });
}
