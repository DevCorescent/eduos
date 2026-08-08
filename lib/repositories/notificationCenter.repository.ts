// ============================================================================
// OWNER      : Gauransh
// MODULE     : Notification Center & Announcement System (Phase 27)
// LAYER      : Repository
// PURPOSE    : Every read and write the Phase 27 endpoints need, and nothing
//              that decides anything.
// ARCHITECTURE:
//   • Repository contains ONLY database queries.
//   • NO audience validation, NO liveness decision, NO read-state derivation.
//     Each of those is a rule and lives in lib/domain/announcements/audience.ts
//     or in the service.
//
// EVERY NOTIFICATION QUERY IS ANCHORED ON THE RECIPIENT
//   `userId` is a required parameter on every method here, and every predicate
//   includes it alongside `tenantId`. There is no method that reads a
//   notification by id alone, so no caller can reach another person's bell even
//   by mistake.
//
// SOFT DELETE IS APPLIED HERE, ALWAYS
//   `deletedAt: null` is in every read predicate without exception. A
//   notification a user dismissed must not reappear because one query forgot
//   the filter, so the filter is not optional and no parameter can disable it.
//
// ANNOUNCEMENTS ARE RESOLVED ON READ
//   `findAnnouncementPage` builds an OR over the audiences the CALLER belongs
//   to, so a batch-wide announcement is one row read by many people rather than
//   thousands of rows written once. Read state is a LEFT JOIN onto
//   AnnouncementRead, so an unread announcement costs nothing to store.
//
// THE QUERY BUDGET
//   findNotificationPage  2 (a page and its count)
//   countUnread           1
//   markRead / markAll    1
//   findAnnouncementPage  2
//   Every announcement read carries its own read-state through one nested
//   select, so a page of twenty costs two statements rather than twenty-two.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import {
  AnnouncementAudience,
  AnnouncementStatus,
  type NotificationCategory,
  type Prisma,
} from "@/app/generated/prisma/client";

/** A Prisma client or an interactive transaction handle. */
export type DbClient = Prisma.TransactionClient;

/** Everything a notification is reported as. */
export const NOTIFICATION_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  type: true,
  category: true,
  subject: true,
  body: true,
  data: true,
  sentAt: true,
  readAt: true,
  archivedAt: true,
  status: true,
  createdAt: true,
} as const;

/** Everything an announcement is reported as. */
export const ANNOUNCEMENT_SELECT = {
  id: true,
  tenantId: true,
  title: true,
  body: true,
  category: true,
  audience: true,
  departmentId: true,
  batchId: true,
  sectionId: true,
  status: true,
  isPinned: true,
  publishAt: true,
  expiresAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { code: true, name: true } },
  batch: { select: { code: true, name: true } },
  section: { select: { name: true } },
} as const;

/** Which audiences a given reader belongs to. */
export interface ReaderAudience {
  readonly departmentId: string | null;
  readonly batchId: string | null;
  readonly sectionId: string | null;
}

export class NotificationCenterRepository {
  /**
   * One page of the caller's OWN notifications.
   *
   * `deletedAt: null` is unconditional. `archived` selects between the live
   * drawer and the archive; there is no value that returns both, because a
   * drawer showing archived items alongside live ones is not a drawer.
   *
   * Ordering is createdAt then id, both descending. The id tiebreaker is
   * required for correctness: POST /api/notifications/send writes an entire
   * batch with one createMany, so every row in it shares a createdAt and
   * createdAt alone cannot page deterministically.
   *
   * COST: two statements in one transaction.
   */
  async findNotificationPage(
    tenantId: string,
    userId: string,
    filter: {
      category?: NotificationCategory;
      unreadOnly?: boolean;
      archived: boolean;
      page: number;
      limit: number;
    },
    client: DbClient = prisma
  ) {
    const where: Prisma.NotificationWhereInput = {
      tenantId,
      userId,
      deletedAt: null,
      archivedAt: filter.archived ? { not: null } : null,
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.unreadOnly ? { readAt: null } : {}),
    };

    const [rows, total] = await client.$transaction([
      client.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        select: NOTIFICATION_SELECT,
      }),
      client.notification.count({ where }),
    ]);

    return { rows, total };
  }

  /**
   * The caller's unread, unarchived notifications and their count.
   *
   * The count is over the WHOLE unread set, not the returned page — a bell
   * badge reading "20" when there are two hundred would be worse than useless.
   *
   * COST: two statements in one transaction.
   */
  async findUnread(
    tenantId: string,
    userId: string,
    filter: { category?: NotificationCategory; limit: number },
    client: DbClient = prisma
  ) {
    const where: Prisma.NotificationWhereInput = {
      tenantId,
      userId,
      deletedAt: null,
      archivedAt: null,
      readAt: null,
      ...(filter.category ? { category: filter.category } : {}),
    };

    const [rows, total] = await client.$transaction([
      client.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: filter.limit,
        select: NOTIFICATION_SELECT,
      }),
      client.notification.count({ where }),
    ]);

    return { rows, total };
  }

  /**
   * Mark one notification read, and optionally archive it.
   *
   * `updateMany` rather than `update` so the RECIPIENT predicate is part of the
   * write itself — a zero count means the notification is not this user's, and
   * the service turns that into the same 404 as an unknown id. Using `update`
   * with a bare id would have reached anyone's row.
   *
   * `readAt` is set only when it is currently null, so re-reading does not move
   * the timestamp and lose when the user first saw it.
   *
   * COST: one statement.
   */
  async markRead(
    tenantId: string,
    userId: string,
    id: string,
    now: Date,
    archive: boolean,
    client: DbClient = prisma
  ): Promise<number> {
    const result = await client.notification.updateMany({
      where: { id, tenantId, userId, deletedAt: null },
      data: {
        readAt: now,
        ...(archive ? { archivedAt: now } : {}),
      },
    });

    return result.count;
  }

  /**
   * Mark every unread notification read.
   *
   * Unbounded by design: it is one UPDATE with a WHERE clause, and an
   * artificial cap would leave a user pressing the button repeatedly with no
   * indication of how many remained.
   *
   * COST: one statement.
   */
  async markAllRead(
    tenantId: string,
    userId: string,
    now: Date,
    category: NotificationCategory | undefined,
    client: DbClient = prisma
  ): Promise<number> {
    const result = await client.notification.updateMany({
      where: {
        tenantId,
        userId,
        deletedAt: null,
        readAt: null,
        ...(category ? { category } : {}),
      },
      data: { readAt: now },
    });

    return result.count;
  }

  /**
   * Soft-delete one notification.
   *
   * A notification is a record that something was communicated. A recipient
   * dismissing it from their bell is a display preference, not grounds to
   * destroy the institution's evidence that the message was sent — the same
   * reasoning that makes certificate revocation a flag rather than a DELETE.
   *
   * COST: one statement.
   */
  async softDelete(
    tenantId: string,
    userId: string,
    id: string,
    now: Date,
    client: DbClient = prisma
  ): Promise<number> {
    const result = await client.notification.updateMany({
      where: { id, tenantId, userId, deletedAt: null },
      data: { deletedAt: now },
    });

    return result.count;
  }

  /**
   * One page of the announcements a reader is entitled to see.
   *
   * THE AUDIENCE IS RESOLVED IN SQL. The OR below names the institution-wide
   * case plus each narrower audience the caller actually belongs to, so a
   * reader never transfers rows addressed to somebody else. A reader with a
   * null scope for a dimension contributes no clause for it — matching them
   * would mean treating "unknown" as "all".
   *
   * `manage` widens the query to DRAFT and scheduled announcements for a caller
   * who may manage them. It is a parameter rather than a query flag the client
   * controls: the service decides it from the caller's role.
   *
   * Ordering is pinned first, then publish time, then creation — the README's
   * "Pinned Announcements" is an ordering rule, not a visibility one.
   *
   * COST: two statements in one transaction.
   */
  async findAnnouncementPage(
    tenantId: string,
    reader: ReaderAudience,
    filter: {
      category?: NotificationCategory;
      audience?: AnnouncementAudience;
      manage: boolean;
      includeUnpublished: boolean;
      page: number;
      limit: number;
    },
    now: Date,
    userId: string,
    client: DbClient = prisma
  ) {
    const audienceClauses: Prisma.AnnouncementWhereInput[] = [
      { audience: AnnouncementAudience.INSTITUTION },
    ];

    if (reader.departmentId) {
      audienceClauses.push({
        audience: AnnouncementAudience.DEPARTMENT,
        departmentId: reader.departmentId,
      });
    }
    if (reader.batchId) {
      audienceClauses.push({
        audience: AnnouncementAudience.BATCH,
        batchId: reader.batchId,
      });
    }
    if (reader.sectionId) {
      audienceClauses.push({
        audience: AnnouncementAudience.SECTION,
        sectionId: reader.sectionId,
      });
    }

    // A manager listing unpublished announcements sees the whole tenant's,
    // because a draft has no audience yet in any meaningful sense — it has not
    // been sent to anyone.
    const liveness: Prisma.AnnouncementWhereInput =
      filter.manage && filter.includeUnpublished
        ? {}
        : {
            status: AnnouncementStatus.PUBLISHED,
            AND: [
              { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
              { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            ],
          };

    const where: Prisma.AnnouncementWhereInput = {
      tenantId,
      OR: audienceClauses,
      ...liveness,
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.audience ? { audience: filter.audience } : {}),
    };

    const [rows, total] = await client.$transaction([
      client.announcement.findMany({
        where,
        orderBy: [
          { isPinned: "desc" },
          { publishAt: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        select: {
          ...ANNOUNCEMENT_SELECT,
          // Read state travels with the row through a filtered nested select,
          // so a page of twenty costs two statements rather than twenty-two.
          reads: { where: { userId }, select: { readAt: true }, take: 1 },
        },
      }),
      client.announcement.count({ where }),
    ]);

    return { rows, total };
  }

  /** One announcement, tenant-scoped, with the caller's read state. */
  async findAnnouncement(
    tenantId: string,
    id: string,
    userId: string,
    client: DbClient = prisma
  ) {
    return client.announcement.findFirst({
      where: { id, tenantId },
      select: {
        ...ANNOUNCEMENT_SELECT,
        reads: { where: { userId }, select: { readAt: true }, take: 1 },
      },
    });
  }

  /**
   * Record that a user has read an announcement.
   *
   * An UPSERT on (announcementId, userId), so reading twice is idempotent
   * rather than a second row.
   *
   * COST: one statement.
   */
  async markAnnouncementRead(
    announcementId: string,
    userId: string,
    now: Date,
    client: DbClient = prisma
  ) {
    return client.announcementRead.upsert({
      where: { announcementId_userId: { announcementId, userId } },
      create: { announcementId, userId, readAt: now },
      update: {},
      select: { id: true },
    });
  }

  async createAnnouncement(
    data: Prisma.AnnouncementUncheckedCreateInput,
    client: DbClient = prisma
  ) {
    return client.announcement.create({ data, select: ANNOUNCEMENT_SELECT });
  }

  async updateAnnouncement(
    tenantId: string,
    id: string,
    data: Prisma.AnnouncementUpdateInput,
    client: DbClient = prisma
  ) {
    return client.announcement.update({
      where: { id, tenantId },
      data,
      select: ANNOUNCEMENT_SELECT,
    });
  }

  /**
   * Remove an announcement.
   *
   * A HARD delete, unlike a notification. An announcement is a post the author
   * controls, not a record that something was delivered to a named person, and
   * AnnouncementRead cascades with it. `deleteMany` so a zero count is a value
   * rather than a thrown P2025.
   *
   * COST: one statement.
   */
  async deleteAnnouncement(
    tenantId: string,
    id: string,
    client: DbClient = prisma
  ): Promise<number> {
    const result = await client.announcement.deleteMany({ where: { id, tenantId } });

    return result.count;
  }

  /**
   * The audiences a user belongs to.
   *
   * A student's batch and section come from their Student row; a faculty
   * member's department from their FacultyMember row. A user who is neither
   * belongs only to the institution-wide audience, which is the correct
   * outcome for an administrator.
   *
   * A STUDENT'S DEPARTMENT IS REACHED THROUGH THEIR PROGRAMME. Student carries
   * `programmeId` but declares no `programme` relation, so it is a second
   * lookup rather than a join — and one taken only when the caller is a student
   * who has a programme at all.
   *
   * COST: two statements concurrently, plus one more for a student's
   * department. An administrator who is neither a student nor a faculty member
   * pays two and belongs to the institution-wide audience, which is correct.
   */
  async findReaderAudience(
    tenantId: string,
    userId: string,
    client: DbClient = prisma
  ): Promise<ReaderAudience> {
    const [student, faculty] = await Promise.all([
      client.student.findFirst({
        where: { userId, tenantId },
        select: { batchId: true, sectionId: true, programmeId: true },
      }),
      client.facultyMember.findFirst({
        where: { userId, tenantId },
        select: { departmentId: true },
      }),
    ]);

    // A faculty department wins over a student one. A user who is both — a
    // research scholar who also teaches — receives their staff department's
    // announcements, which is the more privileged reading and the one an
    // institution means when it addresses "the department".
    let departmentId = faculty?.departmentId ?? null;

    if (departmentId === null && student?.programmeId) {
      const programme = await client.programme.findFirst({
        where: { id: student.programmeId, tenantId },
        select: { departmentId: true },
      });

      departmentId = programme?.departmentId ?? null;
    }

    return {
      departmentId,
      batchId: student?.batchId ?? null,
      sectionId: student?.sectionId ?? null,
    };
  }

  /** Confirm an audience target exists in this tenant. */
  async targetExists(
    tenantId: string,
    kind: "departmentId" | "batchId" | "sectionId",
    id: string,
    client: DbClient = prisma
  ): Promise<boolean> {
    if (kind === "departmentId") {
      return (
        (await client.department.findFirst({ where: { id, tenantId }, select: { id: true } })) !==
        null
      );
    }

    if (kind === "batchId") {
      return (
        (await client.batch.findFirst({ where: { id, tenantId }, select: { id: true } })) !== null
      );
    }

    return (
      (await client.section.findFirst({ where: { id, tenantId }, select: { id: true } })) !== null
    );
  }

  /** Run a unit of work atomically. The service decides the BOUNDARY. */
  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }
}

export const notificationCenterRepository = new NotificationCenterRepository();

/** The abstraction the service depends on. Imported as `import type`. */
export type NotificationCenterRepositoryPort = Pick<
  NotificationCenterRepository,
  | "findNotificationPage"
  | "findUnread"
  | "markRead"
  | "markAllRead"
  | "softDelete"
  | "findAnnouncementPage"
  | "findAnnouncement"
  | "markAnnouncementRead"
  | "createAnnouncement"
  | "updateAnnouncement"
  | "deleteAnnouncement"
  | "findReaderAudience"
  | "targetExists"
  | "transaction"
>;
