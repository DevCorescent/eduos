// ============================================================================
// OWNER  : Gauransh
// MODULE : Notification Center & Announcement System (Phase 27)
// LAYER  : DTO
// PURPOSE: The shapes the ten Phase 27 endpoints return.
//
// NO PRISMA VALUE CROSSES THIS BOUNDARY
//   Every Date becomes an ISO string. The `data` Json column is passed through
//   as stored — nothing in the database constrains its shape and nothing in the
//   application has ever validated what was written into it, so casting it to
//   an interface would be a claim this codebase cannot support.
//
// READ STATE IS DERIVED, NOT STORED TWICE
//   A notification's `isRead` comes from `readAt !== null`; an announcement's
//   from whether an AnnouncementRead row exists for the caller. Neither is a
//   column a writer could set inconsistently.
// ============================================================================

import type {
  AnnouncementAudience,
  AnnouncementStatus,
  NotificationCategory,
  NotificationType,
} from "@/app/generated/prisma/enums";

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

// --- Notifications ----------------------------------------------------------

/** One notification, as the bell renders it. */
export interface NotificationDto {
  readonly id: string;
  /** The DELIVERY CHANNEL — EMAIL, SMS, PUSH, IN_APP. Phase 13's column. */
  readonly type: NotificationType;
  /**
   * WHAT it is about — Phase 27's addition.
   *
   * Null for every notification written before the concept existed, which is
   * the correct reading: no category can be inferred for those rows.
   */
  readonly category: NotificationCategory | null;
  readonly subject: string | null;
  readonly body: string;
  readonly data: unknown;
  readonly sentAt: string | null;
  readonly readAt: string | null;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly isRead: boolean;
  readonly isArchived: boolean;
}

/** The row shape NOTIFICATION_SELECT produces. */
export interface NotificationRow {
  id: string;
  type: NotificationType;
  category: NotificationCategory | null;
  subject: string | null;
  body: string;
  data: unknown;
  sentAt: Date | null;
  readAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
}

export function toNotificationDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    subject: row.subject,
    body: row.body,
    data: row.data ?? null,
    sentAt: toIso(row.sentAt),
    readAt: toIso(row.readAt),
    archivedAt: toIso(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    isRead: row.readAt !== null,
    isArchived: row.archivedAt !== null,
  };
}

// --- Announcements ----------------------------------------------------------

/** One announcement, as a reader sees it. */
export interface AnnouncementDto {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly body: string;
  readonly category: NotificationCategory;
  readonly audience: AnnouncementAudience;
  readonly departmentId: string | null;
  readonly departmentName: string | null;
  readonly batchId: string | null;
  readonly batchName: string | null;
  readonly sectionId: string | null;
  readonly sectionName: string | null;
  readonly status: AnnouncementStatus;
  readonly isPinned: boolean;
  readonly publishAt: string | null;
  readonly expiresAt: string | null;
  readonly createdById: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Whether the CALLER has read it. Absent read row means unread. */
  readonly isRead: boolean;
  readonly readAt: string | null;
  /**
   * Whether this announcement is live at the instant it was read.
   *
   * Derived from the same predicate the query uses, so a manager's listing
   * cannot claim an announcement is live while a reader's listing omits it.
   */
  readonly isLive: boolean;
}

/** The row shape ANNOUNCEMENT_SELECT produces, with the caller's read state. */
export interface AnnouncementRow {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  category: NotificationCategory;
  audience: AnnouncementAudience;
  departmentId: string | null;
  batchId: string | null;
  sectionId: string | null;
  status: AnnouncementStatus;
  isPinned: boolean;
  publishAt: Date | null;
  expiresAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  department?: { code: string; name: string } | null;
  batch?: { code: string; name: string } | null;
  section?: { name: string } | null;
  reads?: Array<{ readAt: Date }>;
}

export function toAnnouncementDto(row: AnnouncementRow, isLive: boolean): AnnouncementDto {
  const read = row.reads?.[0] ?? null;

  return {
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    body: row.body,
    category: row.category,
    audience: row.audience,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    batchId: row.batchId,
    batchName: row.batch?.name ?? null,
    sectionId: row.sectionId,
    sectionName: row.section?.name ?? null,
    status: row.status,
    isPinned: row.isPinned,
    publishAt: toIso(row.publishAt),
    expiresAt: toIso(row.expiresAt),
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isRead: read !== null,
    readAt: read ? read.readAt.toISOString() : null,
    isLive,
  };
}

// --- Pages ------------------------------------------------------------------

/** A page of rows and the total that satisfied the same predicate. */
export interface NotificationPageDto<T> {
  readonly items: readonly T[];
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

export function toPageDto<T>(
  items: readonly T[],
  page: number,
  limit: number,
  total: number
): NotificationPageDto<T> {
  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/** The unread response — the bell's badge and its drawer contents. */
export interface UnreadNotificationsDto {
  /**
   * The count over the WHOLE unread set, not the returned page.
   *
   * A badge reading "20" when there are two hundred would be worse than
   * useless, so this is counted separately from the items.
   */
  readonly unreadCount: number;
  readonly items: readonly NotificationDto[];
}
