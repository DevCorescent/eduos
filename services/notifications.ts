// ============================================================================
// MODULE : Services — Notification Centre & Announcements (Phase 27)
// PURPOSE: The notification bell, the notification page and the announcement
//          screens, all reading the real Phase 27 endpoints.
//
// WHY THIS MODULE EXISTS AT ALL
//   The student notification page used to read GET /api/student/dashboard and
//   said so in its own header: /api/notifications was requireRole
//   ("UNIVERSITY_ADMIN") and answered a student 403, so the dashboard payload
//   was the only path open to them. Phase 27 replaced that guard with
//   requireNotificationAccess over NOTIFICATION_CENTER_ROLES, which includes
//   STUDENT — verified live, a student now receives 200.
//
//   So the workaround is obsolete, and with it the limitation it forced: the
//   dashboard returned a bounded slice with no pagination, no unread count and
//   no way to mark anything read. This module reads the real collection.
//
// TWO ENDPOINTS, DELIBERATELY NOT ONE
//   The bell needs a count and the page needs a page of rows. /unread returns
//   `unreadCount` computed over the WHOLE unread set rather than the returned
//   slice, which is exactly what a badge needs and what counting a page could
//   never give. Fetching the full list to render a badge would be the wrong
//   trade in both directions.
// ============================================================================

import type { ApiResponse, ListParams, PaginatedResult } from "@/types";
import type {
  AnnouncementDto,
  NotificationDto,
  UnreadNotificationsDto,
} from "@/lib/dto/notificationCenter.dto";
import type {
  AnnouncementAudience,
  AnnouncementStatus,
  NotificationCategory,
} from "@/app/generated/prisma/enums";
import { apiList, apiRequest } from "./client";

/**
 * The page size the notification list uses.
 *
 * NOTIFICATION_MAX_LIMIT is 100 and the route's own default is 20. Twenty is
 * kept rather than raised: a notification list is read newest-first and a
 * reader who needs the hundredth entry is better served by the category filter
 * than by a longer page.
 */
export const NOTIFICATION_PAGE_SIZE = 20;

/**
 * Filters GET /api/notifications genuinely honours.
 *
 * Each was verified against the running route rather than read off the schema:
 * an invalid category answers 400, `unreadOnly=maybe` answers 400, and an
 * unknown parameter answers 400 because the schema is `.strict()`. A control is
 * offered for each of these and for nothing else.
 */
export interface NotificationFilters extends ListParams {
  category?: NotificationCategory;
  unreadOnly?: boolean;
  /** Archived notifications are excluded unless this is set — the route's own default. */
  archived?: boolean;
}

export async function listNotifications(
  filters: NotificationFilters = {}
): Promise<ApiResponse<PaginatedResult<NotificationDto>>> {
  return apiList<NotificationDto>("/api/notifications", "items", filters);
}

/**
 * The unread count, plus a short preview list.
 *
 * `unreadCount` covers every unread notification, not just the items returned,
 * so the badge stays correct however many rows come back.
 */
export async function getUnreadNotifications(
  limit?: number
): Promise<ApiResponse<UnreadNotificationsDto>> {
  return apiRequest<UnreadNotificationsDto>("/api/notifications/unread", {
    params: limit === undefined ? undefined : { limit },
  });
}

/**
 * Mark one notification read, and optionally archive it in the same call.
 *
 * The route takes `{ archive?: boolean }`, so archiving is a property of
 * marking rather than a separate endpoint — passing true both reads and files
 * it away.
 */
export async function markNotificationRead(
  id: string,
  options: { archive?: boolean } = {}
): Promise<ApiResponse<NotificationDto>> {
  return apiRequest<NotificationDto>(`/api/notifications/${id}/read`, {
    method: "PATCH",
    body: options.archive === undefined ? {} : { archive: options.archive },
  });
}

/** Sweep every unread notification, or every unread one in a single category. */
export async function markAllNotificationsRead(
  category?: NotificationCategory
): Promise<ApiResponse<{ updated: number }>> {
  return apiRequest<{ updated: number }>("/api/notifications/read-all", {
    method: "PATCH",
    body: category === undefined ? {} : { category },
  });
}

export async function deleteNotification(id: string): Promise<ApiResponse<unknown>> {
  return apiRequest<unknown>(`/api/notifications/${id}`, { method: "DELETE" });
}

// --- Announcements ----------------------------------------------------------

/**
 * Filters GET /api/announcements honours, verified the same way.
 *
 * `includeUnpublished` is only meaningful to a role that may manage
 * announcements; for everyone else the route returns live ones regardless, so
 * the control is offered only where it can do something.
 */
export interface AnnouncementFilters extends ListParams {
  category?: NotificationCategory;
  audience?: AnnouncementAudience;
  includeUnpublished?: boolean;
  unreadOnly?: boolean;
}

export async function listAnnouncements(
  filters: AnnouncementFilters = {}
): Promise<ApiResponse<PaginatedResult<AnnouncementDto>>> {
  return apiList<AnnouncementDto>("/api/announcements", "items", filters);
}

/** Reading one announcement also records the read, which is why there is no separate call. */
export async function getAnnouncement(
  id: string
): Promise<ApiResponse<AnnouncementDto>> {
  return apiRequest<AnnouncementDto>(`/api/announcements/${id}`);
}

/**
 * The fields POST /api/announcements accepts.
 *
 * `audience` and its scope column travel together — the route refuses a
 * DEPARTMENT announcement with no departmentId, and refuses a scope id that
 * contradicts the audience. The form mirrors that pairing rather than sending
 * a combination the backend will reject.
 */
export interface AnnouncementInput {
  title: string;
  body: string;
  category?: NotificationCategory;
  status?: AnnouncementStatus;
  isPinned?: boolean;
  publishAt?: string | null;
  expiresAt?: string | null;
  audience: AnnouncementAudience;
  departmentId?: string | null;
  batchId?: string | null;
  sectionId?: string | null;
}

export async function createAnnouncement(
  input: AnnouncementInput
): Promise<ApiResponse<AnnouncementDto>> {
  return apiRequest<AnnouncementDto>("/api/announcements", {
    method: "POST",
    body: input,
  });
}

export async function updateAnnouncement(
  id: string,
  input: Partial<AnnouncementInput>
): Promise<ApiResponse<AnnouncementDto>> {
  return apiRequest<AnnouncementDto>(`/api/announcements/${id}`, {
    method: "PATCH",
    body: input,
  });
}

export async function deleteAnnouncement(id: string): Promise<ApiResponse<unknown>> {
  return apiRequest<unknown>(`/api/announcements/${id}`, { method: "DELETE" });
}
