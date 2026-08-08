// ============================================================================
// OWNER      : Gauransh
// MODULE     : Notification Center & Announcement System (Phase 27)
// LAYER      : Service
// PURPOSE    : Own every rule this phase has — whose notifications a caller
//              reads, who an announcement reaches, and when it is live.
// ARCHITECTURE:
//   • Service owns ALL orchestration and every decision.
//   • The audience and liveness rules are delegated to
//     lib/domain/announcements/audience.ts, so the SQL predicate the repository
//     builds and the in-memory `isLive` the DTO reports are provably the same
//     rule.
//
// EVERY NOTIFICATION METHOD TAKES userId AND NEVER A NOTIFICATION OWNER
//   The recipient is the caller, resolved from session.sub by the route. There
//   is no parameter for someone else's id, so reading another person's bell is
//   unexpressible rather than merely refused. The repository carries the same
//   predicate into every write, so a marked-read call cannot touch a row that
//   is not the caller's.
//
// ANNOUNCEMENTS ARE RESOLVED ON READ, NEVER FANNED OUT
//   Publishing writes ONE row. A batch-wide announcement in a large university
//   would otherwise be tens of thousands of Notification rows per post; editing
//   one would have to find and rewrite all of them, and deleting one would
//   leave orphans. Entitlement is computed at query time from the caller's own
//   department, batch and section.
//
// QUERY BUDGET, STATED HONESTLY
//   listNotifications  2
//   unread             2
//   markRead / markAll / delete  1
//   listAnnouncements  2-3 (reader audience, then page and count)
//   createAnnouncement 1 target check + 1 insert
// ============================================================================

import { AppError } from "@/lib/errors/AppError";
import { ERROR_CODE, HTTP_STATUS } from "@/lib/constants/errors";
import { AnnouncementAudience, AnnouncementStatus } from "@/app/generated/prisma/enums";
import { NOTIFICATION_MESSAGE } from "@/lib/constants/notificationCenter";
import {
  isAudienceConsistent,
  isLive,
  requiredTargetFor,
} from "@/lib/domain/announcements/audience";
import {
  toAnnouncementDto,
  toNotificationDto,
  toPageDto,
  type AnnouncementDto,
  type AnnouncementRow,
  type NotificationDto,
  type NotificationPageDto,
  type NotificationRow,
  type UnreadNotificationsDto,
} from "@/lib/dto/notificationCenter.dto";
import type { NotificationCenterRepositoryPort } from "@/lib/repositories/notificationCenter.repository";
import type {
  AnnouncementListQuery,
  CreateAnnouncementInput,
  MarkAllReadInput,
  MarkNotificationInput,
  NotificationListQuery,
  UnreadNotificationQuery,
  UpdateAnnouncementInput,
} from "@/lib/validations/notificationCenter.validation";

/**
 * Who is asking.
 *
 * `canManageAnnouncements` carries the AUTHORITY the guard established rather
 * than raw roles — the same contract Phases 16, 23 and 26 use. It is what stops
 * a student reading a draft by setting `?includeUnpublished=true`.
 */
export interface NotificationAccess {
  readonly tenantId: string;
  readonly userId: string;
  readonly canManageAnnouncements: boolean;
}

export class NotificationCenterService {
  constructor(private readonly repository: NotificationCenterRepositoryPort) {}

  // --- Notifications --------------------------------------------------------

  /** GET /api/notifications */
  async listNotifications(
    access: NotificationAccess,
    query: NotificationListQuery
  ): Promise<NotificationPageDto<NotificationDto>> {
    const { rows, total } = await this.repository.findNotificationPage(
      access.tenantId,
      access.userId,
      query
    );

    return toPageDto(
      rows.map((row) => toNotificationDto(row as unknown as NotificationRow)),
      query.page,
      query.limit,
      total
    );
  }

  /** GET /api/notifications/unread */
  async unread(
    access: NotificationAccess,
    query: UnreadNotificationQuery
  ): Promise<UnreadNotificationsDto> {
    const { rows, total } = await this.repository.findUnread(
      access.tenantId,
      access.userId,
      query
    );

    return {
      unreadCount: total,
      items: rows.map((row) => toNotificationDto(row as unknown as NotificationRow)),
    };
  }

  /**
   * PATCH /api/notifications/[id]/read
   *
   * RULES : The notification must be the caller's. A zero row count means it is
   *         not — an unknown id, another tenant's, or another person's — and
   *         all three become the same 404. A 403 would confirm that a
   *         notification with that id exists somewhere.
   */
  async markRead(
    access: NotificationAccess,
    id: string,
    input: MarkNotificationInput,
    now: Date
  ): Promise<{ id: string; readAt: string; archived: boolean }> {
    const count = await this.repository.markRead(
      access.tenantId,
      access.userId,
      id,
      now,
      input.archive ?? false
    );

    if (count === 0) throw this.notificationNotFound();

    return { id, readAt: now.toISOString(), archived: input.archive ?? false };
  }

  /** PATCH /api/notifications/read-all */
  async markAllRead(
    access: NotificationAccess,
    input: MarkAllReadInput,
    now: Date
  ): Promise<{ updated: number }> {
    const updated = await this.repository.markAllRead(
      access.tenantId,
      access.userId,
      now,
      input.category
    );

    return { updated };
  }

  /**
   * DELETE /api/notifications/[id]
   *
   * A SOFT delete. A notification is a record that something was communicated
   * to someone; a recipient dismissing it from their bell is a display
   * preference, not grounds to destroy the institution's evidence that the
   * message was sent — the same reasoning that makes certificate revocation a
   * flag rather than a DELETE.
   */
  async deleteNotification(
    access: NotificationAccess,
    id: string,
    now: Date
  ): Promise<void> {
    const count = await this.repository.softDelete(
      access.tenantId,
      access.userId,
      id,
      now
    );

    if (count === 0) throw this.notificationNotFound();
  }

  // --- Announcements --------------------------------------------------------

  /**
   * GET /api/announcements
   *
   * RULES : `includeUnpublished` is honoured ONLY for a caller who may manage
   *         announcements. A student setting the parameter gets the ordinary
   *         live list — the flag is not rejected, because rejecting it would
   *         tell them the capability exists.
   */
  async listAnnouncements(
    access: NotificationAccess,
    query: AnnouncementListQuery,
    now: Date
  ): Promise<NotificationPageDto<AnnouncementDto>> {
    const reader = await this.repository.findReaderAudience(access.tenantId, access.userId);

    const { rows, total } = await this.repository.findAnnouncementPage(
      access.tenantId,
      reader,
      {
        category: query.category,
        audience: query.audience,
        manage: access.canManageAnnouncements,
        includeUnpublished: query.includeUnpublished ?? false,
        page: query.page,
        limit: query.limit,
      },
      now,
      access.userId
    );

    const mapped = rows
      .map((row) => toAnnouncementDto(row as unknown as AnnouncementRow, isLive(row, now)))
      // `unreadOnly` is applied here rather than in SQL: the read state arrives
      // as a filtered nested select, and expressing "no matching child row" as
      // a predicate would need a second shape of the same query for one
      // optional filter.
      .filter((entry) => (query.unreadOnly ? !entry.isRead : true));

    return toPageDto(mapped, query.page, query.limit, total);
  }

  /**
   * GET /api/announcements/[id]
   *
   * RULES : A reader who is not in the audience, or whose announcement is not
   *         live, receives a 404 — unless they may manage announcements, in
   *         which case they read drafts too.
   *
   *         Reading MARKS IT READ. That is what the endpoint is for: a drawer
   *         that required a second call to record the read would leave the
   *         unread count wrong for every client that forgot to make it.
   */
  async getAnnouncement(
    access: NotificationAccess,
    id: string,
    now: Date
  ): Promise<AnnouncementDto> {
    const row = await this.repository.findAnnouncement(access.tenantId, id, access.userId);

    if (!row) throw this.announcementNotFound();

    const live = isLive(row, now);

    if (!live && !access.canManageAnnouncements) {
      // The same 404 as "no such announcement", so a draft's existence is not
      // disclosed by the difference between two status codes.
      throw this.announcementNotFound();
    }

    if (live) {
      await this.repository.markAnnouncementRead(id, access.userId, now);
    }

    return toAnnouncementDto(row as unknown as AnnouncementRow, live);
  }

  /**
   * POST /api/announcements
   *
   * RULES : The audience and its target must agree — checked by the SAME domain
   *         function the schema uses, and then the target is verified to exist
   *         in this tenant. A DEPARTMENT announcement naming another
   *         university's department would otherwise be addressed to nobody and
   *         report success.
   */
  async createAnnouncement(
    access: NotificationAccess,
    input: CreateAnnouncementInput,
    now: Date
  ): Promise<AnnouncementDto> {
    await this.assertAudience(access.tenantId, {
      audience: input.audience,
      departmentId: input.departmentId ?? null,
      batchId: input.batchId ?? null,
      sectionId: input.sectionId ?? null,
    });

    const created = await this.repository.createAnnouncement({
      tenantId: access.tenantId,
      title: input.title,
      body: input.body,
      category: input.category,
      audience: input.audience,
      departmentId: input.departmentId ?? null,
      batchId: input.batchId ?? null,
      sectionId: input.sectionId ?? null,
      status: input.status,
      isPinned: input.isPinned,
      publishAt: input.publishAt ? new Date(input.publishAt) : null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      createdById: access.userId,
    });

    return toAnnouncementDto(
      created as unknown as AnnouncementRow,
      isLive(created, now)
    );
  }

  /**
   * PATCH /api/announcements/[id]
   *
   * RULES : The audience is re-validated against the MERGED result, not against
   *         the supplied fields alone. Supplying `audience: SECTION` without a
   *         sectionId while the stored row carries a departmentId would
   *         otherwise pass a check on the request and produce a row addressed
   *         to nobody.
   */
  async updateAnnouncement(
    access: NotificationAccess,
    id: string,
    input: UpdateAnnouncementInput,
    now: Date
  ): Promise<AnnouncementDto> {
    const existing = await this.repository.findAnnouncement(
      access.tenantId,
      id,
      access.userId
    );

    if (!existing) throw this.announcementNotFound();

    const merged = {
      audience: input.audience ?? existing.audience,
      departmentId:
        input.departmentId !== undefined ? input.departmentId ?? null : existing.departmentId,
      batchId: input.batchId !== undefined ? input.batchId ?? null : existing.batchId,
      sectionId:
        input.sectionId !== undefined ? input.sectionId ?? null : existing.sectionId,
    };

    // Only re-check when something audience-shaped moved. An edit to the title
    // must not fail because a pre-existing row was already inconsistent.
    const audienceTouched =
      input.audience !== undefined ||
      input.departmentId !== undefined ||
      input.batchId !== undefined ||
      input.sectionId !== undefined;

    if (audienceTouched) {
      await this.assertAudience(access.tenantId, merged);
    }

    const publishAt =
      input.publishAt !== undefined
        ? input.publishAt
          ? new Date(input.publishAt)
          : null
        : existing.publishAt;
    const expiresAt =
      input.expiresAt !== undefined
        ? input.expiresAt
          ? new Date(input.expiresAt)
          : null
        : existing.expiresAt;

    if (publishAt && expiresAt && publishAt.getTime() >= expiresAt.getTime()) {
      throw new AppError(
        "publishAt must be before expiresAt",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODE.VALIDATION
      );
    }

    const updated = await this.repository.updateAnnouncement(access.tenantId, id, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
      ...(input.publishAt !== undefined ? { publishAt } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt } : {}),
      ...(audienceTouched
        ? {
            audience: merged.audience,
            departmentId: merged.departmentId,
            batchId: merged.batchId,
            sectionId: merged.sectionId,
          }
        : {}),
    });

    return toAnnouncementDto(
      updated as unknown as AnnouncementRow,
      isLive(updated, now)
    );
  }

  /**
   * DELETE /api/announcements/[id]
   *
   * A HARD delete, unlike a notification. An announcement is a post its author
   * controls, not a record that something was delivered to a named person, and
   * AnnouncementRead cascades with it.
   */
  async deleteAnnouncement(access: NotificationAccess, id: string): Promise<void> {
    const removed = await this.repository.deleteAnnouncement(access.tenantId, id);

    if (removed === 0) throw this.announcementNotFound();
  }

  // --- Internals ------------------------------------------------------------

  /**
   * Refuse an audience whose target is missing, wrong, or does not exist.
   *
   * The consistency half uses the SAME domain function the schema uses, so the
   * two layers cannot enforce different rules. The existence half is this
   * layer's alone — the schema has no way to know whether a departmentId
   * belongs to this tenant.
   */
  private async assertAudience(
    tenantId: string,
    target: {
      audience: AnnouncementAudience;
      departmentId: string | null;
      batchId: string | null;
      sectionId: string | null;
    }
  ): Promise<void> {
    if (!isAudienceConsistent(target)) {
      throw new AppError(
        NOTIFICATION_MESSAGE.AUDIENCE_TARGET_MISMATCH,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODE.VALIDATION
      );
    }

    const required = requiredTargetFor(target.audience);

    if (required === null) return;

    const id = target[required];
    if (!id) return;

    const exists = await this.repository.targetExists(tenantId, required, id);

    if (!exists) {
      const message =
        required === "departmentId"
          ? NOTIFICATION_MESSAGE.DEPARTMENT_NOT_FOUND
          : required === "batchId"
            ? NOTIFICATION_MESSAGE.BATCH_NOT_FOUND
            : NOTIFICATION_MESSAGE.SECTION_NOT_FOUND;

      throw new AppError(message, HTTP_STATUS.NOT_FOUND, ERROR_CODE.NOT_FOUND);
    }
  }

  private notificationNotFound(): AppError {
    return new AppError(
      NOTIFICATION_MESSAGE.NOT_FOUND,
      HTTP_STATUS.NOT_FOUND,
      ERROR_CODE.NOT_FOUND
    );
  }

  private announcementNotFound(): AppError {
    return new AppError(
      NOTIFICATION_MESSAGE.ANNOUNCEMENT_NOT_FOUND,
      HTTP_STATUS.NOT_FOUND,
      ERROR_CODE.NOT_FOUND
    );
  }
}

/** Re-exported so the middleware can name the statuses it reasons about. */
export { AnnouncementStatus };
