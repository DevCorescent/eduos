// ============================================================================
// MODULE : Services — My Account
// PURPOSE: The signed-in person's own record: profile, password and
//          notification preferences.
//
//          Distinct from services/users.ts, which is the administrator's view of
//          *other* people. The difference is not cosmetic — an admin edits by
//          id and may change roles and active status, whereas this module edits
//          "me" and must never be able to do either. Keeping them apart means a
//          Settings screen cannot accidentally reach an admin-only field.
//
// BACKEND : Profile updates go to the existing PATCH /api/users/[id].
//           Password change and notification preferences have NO route yet —
//           app/api/auth holds only login, logout, me and refresh, and no
//           preference table exists. Both live branches below are written
//           against the contract the rest of the collection follows, exactly as
//           services/academics.ts does for backend Phases 8 and 9, so wiring
//           them up is a change in this file alone.
// ============================================================================

import "server-only";

import type { ApiResponse, User } from "@/types";
import { fail } from "@/types";
import { apiRequest } from "./client";
import { getPortalSession } from "./session";

/**
 * The signed-in user's own record, or null when nobody is signed in.
 *
 * The session carries only `sub`, `tenantId`, `email` and `roles` — enough to
 * guard a route, not enough to render a profile form, which needs the name and
 * phone the JWT does not carry.
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getPortalSession();
  if (!session) return null;

  const result = await apiRequest<User>(`/api/users/${session.sub}`);
  return result.success ? result.data : null;
}

// --- Profile ----------------------------------------------------------------

export interface ProfileInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}

/**
 * Update my own name, email and phone.
 *
 * Deliberately narrower than UpdateUserInput: `isActive` is absent, so a person
 * cannot deactivate their own account through the Settings form. Role changes
 * are not reachable here at all — those live in services/users.ts behind the
 * admin screens.
 */
export async function updateProfile(input: ProfileInput): Promise<ApiResponse<User>> {
  const session = await getPortalSession();
  if (!session) return fail("Not signed in", "UNAUTHORIZED");

  return apiRequest<User>(`/api/users/${session.sub}`, {
    method: "PATCH",
    body: {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email.trim(),
      phone: input.phone?.trim() || undefined,
    },
  });
}

// --- Password ---------------------------------------------------------------

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * Change my own password.
 *
 * NO BACKEND ROUTE EXISTS. app/api/auth holds login, logout, me and refresh
 * only. The live branch is written against POST /api/auth/change-password
 * because that is where the other auth operations live and what the frontend
 * plan implies; confirm the path with the backend owner before switching mocks
 * off, since nothing has agreed it yet.
 *
 * The current password is required rather than trusted-because-signed-in: a
 * session left open on a shared machine must not be enough to lock the owner
 * out of their own account.
 */
export async function changePassword(
  input: ChangePasswordInput
): Promise<ApiResponse<null>> {
  return apiRequest<null>("/api/auth/change-password", {
    method: "POST",
    body: input,
  });
}

// --- Notification preferences -----------------------------------------------

/**
 * Which notifications reach me, and how.
 *
 * Channels mirror the NotificationType enum in schema.prisma (EMAIL, SMS, PUSH,
 * IN_APP). Categories are the events this product actually raises — there is no
 * value in a toggle for something nothing ever sends.
 */
export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  push: boolean;
  inApp: boolean;
  attendanceAlerts: boolean;
  feeReminders: boolean;
  resultPublished: boolean;
  announcements: boolean;
}

/**
 * My notification preferences.
 *
 * NO BACKEND ROUTE OR TABLE EXISTS — schema.prisma declares no UserPreference
 * model, and app/api exposes no per-user preferences sub-resource. The request
 * below is written against the contract such a sub-resource would follow, so
 * the endpoint is the only thing missing; until it lands the call returns
 * NOT_FOUND and the Settings tab renders that.
 *
 * No default set is substituted on failure. Toggles shown as "your settings"
 * that were never loaded from anywhere, and that a save would not persist,
 * misrepresent the state of the account.
 */
export async function getNotificationPreferences(): Promise<
  ApiResponse<NotificationPreferences>
> {
  const session = await getPortalSession();
  if (!session) {
    return fail("Not signed in", "UNAUTHORIZED");
  }

  const result = await apiRequest<NotificationPreferences>(
    `/api/users/${session.sub}/preferences`
  );

  return result;
}

export async function updateNotificationPreferences(
  input: NotificationPreferences
): Promise<ApiResponse<NotificationPreferences>> {
  const session = await getPortalSession();
  if (!session) {
    return fail("Not signed in", "UNAUTHORIZED");
  }

  return apiRequest<NotificationPreferences>(`/api/users/${session.sub}/preferences`, {
    method: "PATCH",
    body: input,
  });
}
