// ============================================================================
// OWNER      : Gauransh
// MODULE     : Notification Center & Announcement System (Phase 27)
// LAYER      : Controller
// PURPOSE    : Orchestration only — receives already-authorised, already-
//              validated input from the route and delegates.
// ARCHITECTURE:
//   • Controller performs ONLY delegation.
//   • No auth, no tenant resolution, no request or response handling, no
//     validation, no business logic, no audience arithmetic, no Prisma.
//
// THE COMPOSITION ROOT
//   The single place NotificationCenterService is wired to its repository. All
//   ten Phase 27 routes share this instance, so the notification surface and
//   the announcement surface provably apply the same tenant and recipient
//   confinement.
// ============================================================================

import { notificationCenterRepository } from "@/lib/repositories/notificationCenter.repository";
import {
  NotificationCenterService,
  type NotificationAccess,
} from "@/lib/services/notificationCenter.service";
import type {
  AnnouncementDto,
  NotificationDto,
  NotificationPageDto,
  UnreadNotificationsDto,
} from "@/lib/dto/notificationCenter.dto";
import type {
  AnnouncementListQuery,
  CreateAnnouncementInput,
  MarkAllReadInput,
  MarkNotificationInput,
  NotificationListQuery,
  UnreadNotificationQuery,
  UpdateAnnouncementInput,
} from "@/lib/validations/notificationCenter.validation";

/** The single wired instance every Phase 27 route delegates to. */
const notificationCenterService = new NotificationCenterService(
  notificationCenterRepository
);

export class NotificationCenterController {
  /** GET /api/notifications */
  async listNotifications(
    access: NotificationAccess,
    query: NotificationListQuery
  ): Promise<NotificationPageDto<NotificationDto>> {
    return notificationCenterService.listNotifications(access, query);
  }

  /** GET /api/notifications/unread */
  async unread(
    access: NotificationAccess,
    query: UnreadNotificationQuery
  ): Promise<UnreadNotificationsDto> {
    return notificationCenterService.unread(access, query);
  }

  /** PATCH /api/notifications/[id]/read */
  async markRead(
    access: NotificationAccess,
    id: string,
    input: MarkNotificationInput,
    now: Date
  ) {
    return notificationCenterService.markRead(access, id, input, now);
  }

  /** PATCH /api/notifications/read-all */
  async markAllRead(access: NotificationAccess, input: MarkAllReadInput, now: Date) {
    return notificationCenterService.markAllRead(access, input, now);
  }

  /** DELETE /api/notifications/[id] */
  async deleteNotification(
    access: NotificationAccess,
    id: string,
    now: Date
  ): Promise<void> {
    return notificationCenterService.deleteNotification(access, id, now);
  }

  /** GET /api/announcements */
  async listAnnouncements(
    access: NotificationAccess,
    query: AnnouncementListQuery,
    now: Date
  ): Promise<NotificationPageDto<AnnouncementDto>> {
    return notificationCenterService.listAnnouncements(access, query, now);
  }

  /** GET /api/announcements/[id] */
  async getAnnouncement(
    access: NotificationAccess,
    id: string,
    now: Date
  ): Promise<AnnouncementDto> {
    return notificationCenterService.getAnnouncement(access, id, now);
  }

  /** POST /api/announcements */
  async createAnnouncement(
    access: NotificationAccess,
    input: CreateAnnouncementInput,
    now: Date
  ): Promise<AnnouncementDto> {
    return notificationCenterService.createAnnouncement(access, input, now);
  }

  /** PATCH /api/announcements/[id] */
  async updateAnnouncement(
    access: NotificationAccess,
    id: string,
    input: UpdateAnnouncementInput,
    now: Date
  ): Promise<AnnouncementDto> {
    return notificationCenterService.updateAnnouncement(access, id, input, now);
  }

  /** DELETE /api/announcements/[id] */
  async deleteAnnouncement(access: NotificationAccess, id: string): Promise<void> {
    return notificationCenterService.deleteAnnouncement(access, id);
  }
}

export const notificationCenterController = new NotificationCenterController();
