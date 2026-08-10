// ============================================================================
// OWNER  : Gauransh
// MODULE : Notification Center & Announcement System (Phase 27)
// LAYER  : Service — Unit Tests
// PURPOSE: Prove the confinements that keep one person's bell out of another's
//          hands, and that a student cannot read a draft announcement by
//          setting a query parameter.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AppError } from "@/lib/errors/AppError";
import {
  AnnouncementAudience,
  AnnouncementStatus,
  NotificationCategory,
  NotificationType,
} from "@/app/generated/prisma/enums";
import {
  NotificationCenterService,
  type NotificationAccess,
} from "@/lib/services/notificationCenter.service";
import type { NotificationCenterRepositoryPort } from "@/lib/repositories/notificationCenter.repository";

const TENANT_ID = "tenant_1";
const USER_ID = "user_1";
const NOW = new Date("2026-06-01T12:00:00.000Z");

const READER: NotificationAccess = {
  tenantId: TENANT_ID,
  userId: USER_ID,
  canManageAnnouncements: false,
};

const MANAGER: NotificationAccess = { ...READER, canManageAnnouncements: true };

function announcementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ann_1",
    tenantId: TENANT_ID,
    title: "Exam timetable published",
    body: "The timetable is now available.",
    category: NotificationCategory.ACADEMIC,
    audience: AnnouncementAudience.INSTITUTION,
    departmentId: null,
    batchId: null,
    sectionId: null,
    status: AnnouncementStatus.PUBLISHED,
    isPinned: false,
    publishAt: null,
    expiresAt: null,
    createdById: "author",
    createdAt: NOW,
    updatedAt: NOW,
    department: null,
    batch: null,
    section: null,
    reads: [] as Array<{ readAt: Date }>,
    ...overrides,
  };
}

interface HarnessOptions {
  markReadCount?: number;
  deleteCount?: number;
  announcement?: ReturnType<typeof announcementRow> | null;
  announcementRows?: Array<Record<string, unknown>>;
  targetExists?: boolean;
  deleteAnnouncementCount?: number;
}

function makeHarness(options: HarnessOptions = {}) {
  const calls = {
    listArgs: [] as Array<Record<string, unknown>>,
    markReadArgs: [] as Array<Record<string, unknown>>,
    markAnnouncementRead: 0,
    created: [] as Array<Record<string, unknown>>,
    updated: [] as Array<Record<string, unknown>>,
    pageArgs: [] as Array<Record<string, unknown>>,
  };

  const repository = {
    async findNotificationPage(
      _tenantId: string,
      userId: string,
      filter: Record<string, unknown>
    ) {
      calls.listArgs.push({ userId, ...filter });
      return {
        rows: [
          {
            id: "n1",
            type: NotificationType.IN_APP,
            category: NotificationCategory.ATTENDANCE,
            subject: "s",
            body: "b",
            data: null,
            sentAt: null,
            readAt: null,
            archivedAt: null,
            createdAt: NOW,
          },
        ],
        total: 1,
      };
    },
    async findUnread() {
      return { rows: [], total: 7 };
    },
    async markRead(
      _tenantId: string,
      userId: string,
      id: string,
      _now: Date,
      archive: boolean
    ) {
      calls.markReadArgs.push({ userId, id, archive });
      return options.markReadCount ?? 1;
    },
    async markAllRead() {
      return 5;
    },
    async softDelete() {
      return options.deleteCount ?? 1;
    },
    async findAnnouncementPage(
      _tenantId: string,
      _reader: unknown,
      filter: Record<string, unknown>
    ) {
      calls.pageArgs.push(filter);
      return { rows: options.announcementRows ?? [announcementRow()], total: 1 };
    },
    async findAnnouncement() {
      return options.announcement === undefined ? announcementRow() : options.announcement;
    },
    async markAnnouncementRead() {
      calls.markAnnouncementRead += 1;
      return { id: "read_1" };
    },
    async createAnnouncement(data: Record<string, unknown>) {
      calls.created.push(data);
      return announcementRow(data);
    },
    async updateAnnouncement(_t: string, _id: string, data: Record<string, unknown>) {
      calls.updated.push(data);
      return announcementRow(data);
    },
    async deleteAnnouncement() {
      return options.deleteAnnouncementCount ?? 1;
    },
    async findReaderAudience() {
      return { departmentId: "dept_1", batchId: "batch_1", sectionId: "sec_1" };
    },
    async targetExists() {
      return options.targetExists ?? true;
    },
    async transaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      return fn(undefined as never);
    },
  } as unknown as NotificationCenterRepositoryPort;

  return { service: new NotificationCenterService(repository), calls };
}

// --- Notification confinement -----------------------------------------------

describe("NotificationCenterService notification confinement", () => {
  it("anchors the list on the CALLER's user id", async () => {
    const { service, calls } = makeHarness();

    await service.listNotifications(READER, { archived: false, page: 1, limit: 20 });

    assert.equal(calls.listArgs[0].userId, USER_ID);
  });

  it("anchors mark-read on the caller, so it cannot touch another bell", async () => {
    const { service, calls } = makeHarness();

    await service.markRead(READER, "n1", {}, NOW);

    assert.equal(calls.markReadArgs[0].userId, USER_ID);
  });

  it("404s when mark-read matches no row", async () => {
    // Unknown id, another tenant's, or another person's — all the same answer.
    const { service } = makeHarness({ markReadCount: 0 });

    await assert.rejects(
      () => service.markRead(READER, "n1", {}, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  it("archives only when asked", async () => {
    const { service, calls } = makeHarness();

    await service.markRead(READER, "n1", {}, NOW);
    await service.markRead(READER, "n2", { archive: true }, NOW);

    assert.equal(calls.markReadArgs[0].archive, false);
    assert.equal(calls.markReadArgs[1].archive, true);
  });

  it("404s when a delete matches no row, so a repeat delete is not a 200", async () => {
    const { service } = makeHarness({ deleteCount: 0 });

    await assert.rejects(
      () => service.deleteNotification(READER, "n1", NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  it("reports the unread count over the whole set, not the returned page", async () => {
    // A badge reading "20" when there are two hundred would be worse than
    // useless.
    const { service } = makeHarness();

    const result = await service.unread(READER, { limit: 20 });

    assert.equal(result.unreadCount, 7);
    assert.equal(result.items.length, 0);
  });

  it("derives isRead from readAt rather than a second column", async () => {
    const { service } = makeHarness();

    const page = await service.listNotifications(READER, {
      archived: false,
      page: 1,
      limit: 20,
    });

    assert.equal(page.items[0].isRead, false);
  });
});

// --- Announcement visibility ------------------------------------------------

describe("NotificationCenterService announcement visibility", () => {
  it("does NOT honour includeUnpublished for an ordinary reader", async () => {
    // A student must not read a draft by setting a query parameter.
    const { service, calls } = makeHarness();

    await service.listAnnouncements(
      READER,
      { includeUnpublished: true, page: 1, limit: 20 },
      NOW
    );

    assert.equal(calls.pageArgs[0].manage, false);
  });

  it("honours includeUnpublished for a manager", async () => {
    const { service, calls } = makeHarness();

    await service.listAnnouncements(
      MANAGER,
      { includeUnpublished: true, page: 1, limit: 20 },
      NOW
    );

    assert.equal(calls.pageArgs[0].manage, true);
    assert.equal(calls.pageArgs[0].includeUnpublished, true);
  });

  it("404s an ordinary reader on a DRAFT announcement", async () => {
    const { service } = makeHarness({
      announcement: announcementRow({ status: AnnouncementStatus.DRAFT }),
    });

    await assert.rejects(
      () => service.getAnnouncement(READER, "ann_1", NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        // The same 404 as "no such announcement", so a draft's existence is not
        // disclosed by the difference between two status codes.
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  it("lets a MANAGER read a draft", async () => {
    const { service } = makeHarness({
      announcement: announcementRow({ status: AnnouncementStatus.DRAFT }),
    });

    const result = await service.getAnnouncement(MANAGER, "ann_1", NOW);

    assert.equal(result.isLive, false);
  });

  it("marks a LIVE announcement read on view", async () => {
    const { service, calls } = makeHarness();

    await service.getAnnouncement(READER, "ann_1", NOW);

    assert.equal(calls.markAnnouncementRead, 1);
  });

  it("does NOT mark a draft read when a manager previews it", async () => {
    // Previewing must not record a read on everyone's behalf.
    const { service, calls } = makeHarness({
      announcement: announcementRow({ status: AnnouncementStatus.DRAFT }),
    });

    await service.getAnnouncement(MANAGER, "ann_1", NOW);

    assert.equal(calls.markAnnouncementRead, 0);
  });
});

// --- Announcement audience --------------------------------------------------

describe("NotificationCenterService announcement audience", () => {
  const base = {
    title: "Notice",
    body: "Body",
    category: NotificationCategory.ANNOUNCEMENT,
    status: AnnouncementStatus.PUBLISHED,
    isPinned: false,
    audience: AnnouncementAudience.INSTITUTION,
  };

  it("creates an institution-wide announcement with no target", async () => {
    const { service, calls } = makeHarness();

    await service.createAnnouncement(MANAGER, base, NOW);

    assert.equal(calls.created[0].departmentId, null);
  });

  it("REFUSES an INSTITUTION announcement carrying a target", async () => {
    // The dangerous case: the target is silently ignored, so the author
    // believes they narrowed the audience while broadcasting to everyone.
    const { service } = makeHarness();

    await assert.rejects(
      () =>
        service.createAnnouncement(MANAGER, { ...base, batchId: "batch_1" }, NOW),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  it("REFUSES a DEPARTMENT announcement with no departmentId", async () => {
    const { service } = makeHarness();

    await assert.rejects(() =>
      service.createAnnouncement(
        MANAGER,
        { ...base, audience: AnnouncementAudience.DEPARTMENT },
        NOW
      )
    );
  });

  it("404s when the audience target does not exist in this tenant", async () => {
    // Otherwise the announcement is addressed to nobody and reports success.
    const { service } = makeHarness({ targetExists: false });

    await assert.rejects(
      () =>
        service.createAnnouncement(
          MANAGER,
          {
            ...base,
            audience: AnnouncementAudience.DEPARTMENT,
            departmentId: "dept_missing",
          },
          NOW
        ),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  it("re-validates the MERGED audience on update, not the request alone", async () => {
    // audience: SECTION with no sectionId, over a row carrying a departmentId,
    // would otherwise pass a check on the request and address nobody.
    const { service } = makeHarness({
      announcement: announcementRow({
        audience: AnnouncementAudience.DEPARTMENT,
        departmentId: "dept_1",
      }),
    });

    await assert.rejects(
      () =>
        service.updateAnnouncement(
          MANAGER,
          "ann_1",
          { audience: AnnouncementAudience.SECTION },
          NOW
        ),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  it("does NOT re-check the audience for an edit that does not touch it", async () => {
    // A title edit must not fail because a pre-existing row was inconsistent.
    const { service, calls } = makeHarness();

    await service.updateAnnouncement(MANAGER, "ann_1", { title: "Revised" }, NOW);

    assert.equal(calls.updated[0].title, "Revised");
    assert.equal("audience" in calls.updated[0], false);
  });

  it("REFUSES a merged window where publishAt is not before expiresAt", async () => {
    const { service } = makeHarness();

    await assert.rejects(
      () =>
        service.updateAnnouncement(
          MANAGER,
          "ann_1",
          {
            publishAt: "2026-07-01T00:00:00.000Z",
            expiresAt: "2026-06-01T00:00:00.000Z",
          },
          NOW
        ),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  it("404s when deleting an announcement that matches no row", async () => {
    const { service } = makeHarness({ deleteAnnouncementCount: 0 });

    await assert.rejects(
      () => service.deleteAnnouncement(MANAGER, "ann_1"),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });
});
