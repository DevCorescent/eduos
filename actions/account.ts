"use server";

// ============================================================================
// MODULE : Actions — My Account
// PURPOSE: Server Actions for the Settings screen.
//          See actions/setup.ts for why mutations run server-side, and for the
//          live-mode cookie-forwarding gap.
//
//          Note what these actions do NOT take: a user id. Every one of them
//          resolves "me" from the session inside the service, so there is no id
//          in the client payload to tamper with and no way to aim a profile
//          edit or a password change at somebody else's account.
// ============================================================================

import {
  changePassword,
  updateNotificationPreferences,
  updateProfile,
  type NotificationPreferences,
  type ProfileInput,
} from "@/services/account";
import type { ActionResult } from "./setup";

/** Matches the check in services/users.ts so both paths agree on what an email is. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function updateProfileAction(input: ProfileInput): Promise<ActionResult> {
  if (!input.firstName.trim()) {
    return { success: false, error: "Enter your first name.", field: "firstName" };
  }
  if (!input.lastName.trim()) {
    return { success: false, error: "Enter your last name.", field: "lastName" };
  }
  if (!EMAIL_PATTERN.test(input.email.trim())) {
    return { success: false, error: "Enter a valid email address.", field: "email" };
  }

  const result = await updateProfile(input);

  // A taken email belongs on the email field, not in a banner — it names the
  // one input the user has to change.
  if (!result.success && result.code === "CONFLICT") {
    return { ...result, field: "email" };
  }

  return result;
}

export async function changePasswordAction(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string
): Promise<ActionResult> {
  if (!currentPassword) {
    return {
      success: false,
      error: "Enter your current password.",
      field: "currentPassword",
    };
  }
  if (newPassword.length < 8) {
    return {
      success: false,
      error: "Use at least 8 characters.",
      field: "newPassword",
    };
  }
  // Checked server-side as well as in the form: the confirmation exists to catch
  // a typo in a field nobody can read back, and a mismatch that slipped through
  // would lock the user out of their own account.
  if (newPassword !== confirmPassword) {
    return {
      success: false,
      error: "The two passwords do not match.",
      field: "confirmPassword",
    };
  }

  const result = await changePassword({ currentPassword, newPassword });

  if (!result.success && result.code === "VALIDATION_ERROR") {
    return { ...result, field: "newPassword" };
  }

  return result;
}

export async function updateNotificationPreferencesAction(
  input: NotificationPreferences
): Promise<ActionResult> {
  return updateNotificationPreferences(input);
}
