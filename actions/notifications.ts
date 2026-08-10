"use server";

// ============================================================================
// MODULE : Actions — Notification Centre & Announcements (Phase 27)
// PURPOSE: The notification and announcement mutations, as Server Actions.
//
//          They run on the server for the same reason every other mutation in
//          this project does: the session is an httpOnly cookie, so issuing the
//          request from the server keeps the credential out of client
//          JavaScript entirely. services/client.ts forwards that cookie and the
//          tenant host onto the outbound request.
//
//          None of them navigates or revalidates. The caller is a client
//          component that calls router.refresh() on success, which re-runs the
//          Server Component page — the convention EntityCrud established.
//
// THE FAILURE ENVELOPE IS RETURNED, NOT THROWN
//          Every action hands back the service's own { success, error, code }.
//          A thrown error would reach an error boundary and replace the whole
//          screen, which is the wrong treatment for "this one row could not be
//          marked read" — the list is still valid and the reader should keep it.
// ============================================================================

import {
  createAnnouncement,
  deleteAnnouncement,
  deleteNotification,
  markAllNotificationsRead,
  markNotificationRead,
  updateAnnouncement,
  type AnnouncementInput,
} from "@/services/notifications";
import type { NotificationCategory } from "@/app/generated/prisma/enums";
import type { ActionResult } from "./setup";

export async function markNotificationReadAction(
  id: string,
  archive?: boolean
): Promise<ActionResult> {
  return markNotificationRead(id, { archive });
}

/**
 * Sweep every unread notification, optionally within one category.
 *
 * The category is passed through when the reader has a filter applied, so
 * "Mark all read" clears what they are actually looking at rather than
 * silently clearing notifications they have not seen.
 */
export async function markAllNotificationsReadAction(
  category?: NotificationCategory
): Promise<ActionResult> {
  return markAllNotificationsRead(category);
}

export async function deleteNotificationAction(id: string): Promise<ActionResult> {
  return deleteNotification(id);
}

// --- Announcements ----------------------------------------------------------

/**
 * Create an announcement.
 *
 * The audience and its scope id travel together and are validated as a pair by
 * the route: a DEPARTMENT announcement with no departmentId is refused, as is a
 * scope id that contradicts the audience. The form sends the pair the reader
 * actually chose and lets the backend remain the authority on consistency.
 */
export async function createAnnouncementAction(
  input: AnnouncementInput
): Promise<ActionResult> {
  return createAnnouncement(input);
}

export async function updateAnnouncementAction(
  id: string,
  input: Partial<AnnouncementInput>
): Promise<ActionResult> {
  return updateAnnouncement(id, input);
}

export async function deleteAnnouncementAction(id: string): Promise<ActionResult> {
  return deleteAnnouncement(id);
}
