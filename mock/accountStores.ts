// ============================================================================
// MODULE : Mock — Account Preference Store
// PURPOSE: Holds per-user notification preferences for the Settings screen.
//
//          Keyed by userId rather than by a row id: preferences are one-per-user
//          and are addressed as "mine", never enumerated, so createMockStore's
//          id sequence has nothing to offer here. A plain Map is the honest
//          shape.
//
// SCOPE   : Process-local, like every other mock store. Edits survive navigation
//          but not a server restart.
// ============================================================================

import type { NotificationPreferences } from "@/services/account";

const preferences = new Map<string, NotificationPreferences>();

/**
 * Defaults for a user who has never opened Settings.
 *
 * Everything on except SMS. SMS costs the university money per message, so it
 * is the one channel a person opts into rather than out of — a default that
 * silently bills the tenant for every student is not a defensible default.
 */
export function defaultPreferences(): NotificationPreferences {
  return {
    email: true,
    sms: false,
    push: true,
    inApp: true,
    attendanceAlerts: true,
    feeReminders: true,
    resultPublished: true,
    announcements: true,
  };
}

export const preferenceStore = {
  get(userId: string): NotificationPreferences {
    return preferences.get(userId) ?? defaultPreferences();
  },

  set(userId: string, next: NotificationPreferences): NotificationPreferences {
    preferences.set(userId, next);
    return next;
  },

  reset(): void {
    preferences.clear();
  },
};
