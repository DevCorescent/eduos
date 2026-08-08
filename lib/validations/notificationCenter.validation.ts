// ============================================================================
// OWNER  : Gauransh
// MODULE : Notification Center & Announcement System (Phase 27)
// LAYER  : Validation
// PURPOSE: The request contracts for the ten Phase 27 endpoints.
//
// NO NOTIFICATION SCHEMA CARRIES A userId
//   Every notification endpoint operates on the CALLER'S own notifications, and
//   the recipient is resolved from session.sub. There is no key to supply
//   someone else's, so reading another person's bell is unexpressible rather
//   than merely refused.
//
// THE ANNOUNCEMENT SCHEMAS ENFORCE WHAT THE SCHEMA CANNOT
//   `audience` and its target column must agree. Three nullable columns and an
//   enum have no CHECK constraint tying them together, so the invariant is
//   checked here (for shape) and in the service (against the database). Both
//   consult the SAME domain function, so they cannot enforce different rules.
// ============================================================================

import { z } from "zod";
import {
  AnnouncementAudience,
  AnnouncementStatus,
  NotificationCategory,
} from "@/app/generated/prisma/enums";
import { identifier } from "@/lib/validations/shared";
import { isAudienceConsistent } from "@/lib/domain/announcements/audience";
import {
  NOTIFICATION_DEFAULT_LIMIT,
  NOTIFICATION_MAX_LIMIT,
} from "@/lib/constants/notificationCenter";

/** A boolean arriving as a search param. */
const queryBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

// --- Notifications ----------------------------------------------------------

/** The [id] route segment naming a notification. */
export const notificationParamSchema = z.object({ id: identifier });

export type NotificationParam = z.infer<typeof notificationParamSchema>;

/**
 * GET /api/notifications — the notification centre list.
 *
 * `archived` defaults to FALSE, so the drawer shows live notifications and an
 * archived one has to be asked for. Deleted notifications are never returned by
 * any value of any parameter — the soft delete is a removal from the user's
 * view, not a filter they can undo.
 */
export const notificationListQuerySchema = z
  .object({
    category: z.enum(NotificationCategory).optional(),
    unreadOnly: queryBoolean.optional(),
    archived: queryBoolean.default(false),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(NOTIFICATION_MAX_LIMIT)
      .default(NOTIFICATION_DEFAULT_LIMIT),
  })
  .strict();

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

/**
 * GET /api/notifications/unread.
 *
 * Deliberately narrower than the list schema: `unreadOnly` and `archived` are
 * absent because this endpoint IS the unread, unarchived view. Offering them
 * would create two ways to ask the same question that could disagree.
 */
export const unreadNotificationQuerySchema = z
  .object({
    category: z.enum(NotificationCategory).optional(),
    limit: z.coerce.number().int().min(1).max(NOTIFICATION_MAX_LIMIT).default(NOTIFICATION_DEFAULT_LIMIT),
  })
  .strict();

export type UnreadNotificationQuery = z.infer<typeof unreadNotificationQuerySchema>;

/**
 * PATCH /api/notifications/[id]/read.
 *
 * `archive` is accepted here rather than at a separate endpoint. The README
 * lists "Archive Notification" as a feature but names no route for it, and a
 * bell that archives on read is the ordinary interaction — a client that wants
 * only to mark read omits the flag.
 */
export const markNotificationSchema = z
  .object({
    archive: z.boolean().optional(),
  })
  .strict();

export type MarkNotificationInput = z.infer<typeof markNotificationSchema>;

/** PATCH /api/notifications/read-all. No body fields. */
export const markAllReadSchema = z
  .object({
    /** Narrow the sweep to one category, for a per-tab "mark all read". */
    category: z.enum(NotificationCategory).optional(),
  })
  .strict();

export type MarkAllReadInput = z.infer<typeof markAllReadSchema>;

// --- Announcements ----------------------------------------------------------

/** The [id] route segment naming an announcement. */
export const announcementParamSchema = z.object({ id: identifier });

export type AnnouncementParam = z.infer<typeof announcementParamSchema>;

const audienceShape = {
  audience: z.enum(AnnouncementAudience).default(AnnouncementAudience.INSTITUTION),
  departmentId: identifier.nullish(),
  batchId: identifier.nullish(),
  sectionId: identifier.nullish(),
};

/**
 * POST /api/announcements
 *
 * `status` IS accepted, unlike Phase 26's resources. The README lists no
 * separate publish route for announcements, so DRAFT and PUBLISHED must both be
 * reachable from create and update — and the liveness rule (status plus
 * schedule plus expiry) is evaluated on read regardless of how the row got
 * there.
 */
export const createAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(20_000),
    category: z.enum(NotificationCategory).default(NotificationCategory.ANNOUNCEMENT),
    status: z.enum(AnnouncementStatus).default(AnnouncementStatus.DRAFT),
    isPinned: z.boolean().default(false),
    publishAt: z.iso.datetime().nullish(),
    expiresAt: z.iso.datetime().nullish(),
    ...audienceShape,
  })
  .strict()
  .refine(
    (value) =>
      isAudienceConsistent({
        audience: value.audience,
        departmentId: value.departmentId ?? null,
        batchId: value.batchId ?? null,
        sectionId: value.sectionId ?? null,
      }),
    {
      message:
        "Exactly the target matching the audience must be supplied (none for INSTITUTION)",
      path: ["audience"],
    }
  )
  .refine(
    (value) =>
      !value.publishAt ||
      !value.expiresAt ||
      new Date(value.publishAt).getTime() < new Date(value.expiresAt).getTime(),
    { message: "publishAt must be before expiresAt", path: ["expiresAt"] }
  );

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

/**
 * PATCH /api/announcements/[id]
 *
 * The audience fields travel TOGETHER or not at all. A partial audience change
 * — supplying `audience: SECTION` without a sectionId, expecting the stored one
 * to serve — would be checked against a mixture of old and new values, which is
 * exactly how an announcement ends up addressed to the wrong cohort. The
 * service re-validates the MERGED result for the same reason.
 */
export const updateAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    body: z.string().trim().min(1).max(20_000).optional(),
    category: z.enum(NotificationCategory).optional(),
    status: z.enum(AnnouncementStatus).optional(),
    isPinned: z.boolean().optional(),
    publishAt: z.iso.datetime().nullish(),
    expiresAt: z.iso.datetime().nullish(),
    audience: z.enum(AnnouncementAudience).optional(),
    departmentId: identifier.nullish(),
    batchId: identifier.nullish(),
    sectionId: identifier.nullish(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be supplied",
  });

export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;

/**
 * GET /api/announcements
 *
 * `includeUnpublished` is available to managers only — the service ignores it
 * for a reader who cannot manage announcements, so a student cannot read a
 * draft by setting a query parameter.
 */
export const announcementListQuerySchema = z
  .object({
    category: z.enum(NotificationCategory).optional(),
    audience: z.enum(AnnouncementAudience).optional(),
    includeUnpublished: queryBoolean.optional(),
    unreadOnly: queryBoolean.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(NOTIFICATION_MAX_LIMIT)
      .default(NOTIFICATION_DEFAULT_LIMIT),
  })
  .strict();

export type AnnouncementListQuery = z.infer<typeof announcementListQuerySchema>;
