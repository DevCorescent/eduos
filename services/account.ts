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
import { apiRequest } from "./client";
import { USE_MOCKS } from "./config";
import { getPortalSession } from "./session";
import { userStore } from "@/mock/rbacStores";
import { defaultPreferences, preferenceStore } from "@/mock/accountStores";
import { mockFail, mockOk } from "@/mock/utils";

const now = () => new Date().toISOString();

/**
 * The demo account Settings falls back to.
 *
 * Same gap, same remedy as services/portal.ts: the development session's `sub`
 * is a synthetic id, so the join against the fixtures finds nothing. Picking the
 * first seeded user keeps the screen reviewable; signing in against a real
 * backend resolves normally and never reaches this.
 */
function demoUser(): User | undefined {
  return userStore.all()[0];
}

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

  if (USE_MOCKS) {
    const byId = userStore.find(session.sub);
    if (byId) return byId;

    // Then by email — a demo account chosen at /login has a synthetic id but a
    // real fixture email, so this resolves the *right* person rather than the
    // fallback.
    const byEmail = userStore
      .all()
      .find((user) => user.email.toLowerCase() === session.email.toLowerCase());

    return byEmail ?? demoUser() ?? null;
  }

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
  if (!session) return mockFail<User>("Not signed in", "UNAUTHORIZED");

  if (USE_MOCKS) {
    const current = await getCurrentUser();
    if (!current) return mockFail<User>("User not found", "NOT_FOUND");

    const duplicate = userStore
      .all()
      .some(
        (user) =>
          user.id !== current.id &&
          user.email.toLowerCase() === input.email.trim().toLowerCase()
      );

    if (duplicate) return mockFail<User>("Email already in use", "CONFLICT");

    const updated = userStore.update(current.id, {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email.trim(),
      phone: input.phone?.trim() || null,
      updatedAt: now(),
    });

    return updated
      ? mockOk(updated, "Profile updated")
      : mockFail<User>("User not found", "NOT_FOUND");
  }

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
  if (USE_MOCKS) {
    // The fixtures carry no password hashes — User in types/entities.ts has no
    // passwordHash field, by design, because no response should ever include
    // one. So the old password cannot be verified here. Length is checked so
    // the form's own rule is still exercised, and the rest is deferred to the
    // real endpoint.
    if (input.currentPassword.length === 0) {
      return mockFail<null>("Enter your current password", "VALIDATION_ERROR");
    }
    if (input.newPassword.length < 8) {
      return mockFail<null>("Use at least 8 characters", "VALIDATION_ERROR");
    }
    if (input.newPassword === input.currentPassword) {
      return mockFail<null>("The new password must differ from the current one", "VALIDATION_ERROR");
    }

    return mockOk(null, "Password changed");
  }

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
 * NO BACKEND ROUTE OR TABLE EXISTS — there is no UserPreference model in
 * schema.prisma. Persisting this needs a migration first. Until then the mock
 * store answers, and the live branch is written against the contract a
 * per-user sub-resource would follow.
 */
export async function getNotificationPreferences(): Promise<
  ApiResponse<NotificationPreferences>
> {
  const session = await getPortalSession();
  if (!session) {
    return mockFail<NotificationPreferences>("Not signed in", "UNAUTHORIZED");
  }

  if (USE_MOCKS) {
    return mockOk(preferenceStore.get(session.sub));
  }

  const result = await apiRequest<NotificationPreferences>(
    `/api/users/${session.sub}/preferences`
  );

  // A user who has never saved preferences is not an error — the defaults are
  // the answer. Only a genuine failure surfaces as one.
  if (!result.success && result.code === "NOT_FOUND") {
    return { success: true, data: defaultPreferences() };
  }

  return result;
}

export async function updateNotificationPreferences(
  input: NotificationPreferences
): Promise<ApiResponse<NotificationPreferences>> {
  const session = await getPortalSession();
  if (!session) {
    return mockFail<NotificationPreferences>("Not signed in", "UNAUTHORIZED");
  }

  if (USE_MOCKS) {
    return mockOk(preferenceStore.set(session.sub, input), "Preferences saved");
  }

  return apiRequest<NotificationPreferences>(`/api/users/${session.sub}/preferences`, {
    method: "PATCH",
    body: input,
  });
}
