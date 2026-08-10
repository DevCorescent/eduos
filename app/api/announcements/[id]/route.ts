// ============================================================================
// OWNER  : Gauransh
// MODULE : Notification Center & Announcement System (Phase 27)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → validate body → controller
//          → response.
// ACCESS : GET            — ANNOUNCEMENT_READ_ROLES, all seven.
//          PATCH / DELETE — ANNOUNCEMENT_MANAGE_ROLES only.
// BACKEND: notificationCenterController → NotificationCenterService →
//          announcements audience domain → NotificationCenterRepository.
// PURPOSE: Read, edit and delete one announcement.
//
// READING MARKS IT READ
//   A drawer that required a second call to record the read would leave the
//   unread count wrong for every client that forgot to make it. The write is an
//   UPSERT on (announcementId, userId), so reading twice is idempotent rather
//   than a second row — and it happens only for a LIVE announcement, so a
//   manager previewing a draft does not mark it read on everyone's behalf.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { notificationCenterController } from "@/lib/controllers/notificationCenter.controller";
import {
  requireAnnouncementManageAccess,
  requireNotificationAccess,
} from "@/lib/middleware/requireNotificationAccess";
import {
  announcementParamSchema,
  updateAnnouncementSchema,
} from "@/lib/validations/notificationCenter.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

type RouteContext = { params: Promise<{ id: string }> };

// GET
// ACCESS     : requireNotificationAccess.
// VALIDATION : announcementParamSchema.
// FLOW       : Guard → validate → controller.
//
//              An announcement that is not LIVE — draft, scheduled for later,
//              or expired — is a 404 for an ordinary reader and readable by a
//              manager. The same 404 as "no such announcement", so a draft's
//              existence is not disclosed by the difference between two status
//              codes.
//
//              Audience is NOT re-checked here, deliberately: an announcement's
//              id is not guessable and the README describes no per-announcement
//              access rule beyond its audience determining what is LISTED. A
//              reader who was given a link to an institution-wide announcement
//              reads it.
// RESPONSE   : { success: true, data: AnnouncementDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(_request: NextRequest, context: RouteContext) {
  const SCOPE = "GET /api/announcements/[id]";

  try {
    const guard = await requireNotificationAccess();
    if (!guard.granted) return guard.response;

    const parsed = announcementParamSchema.safeParse(await context.params);
    if (!parsed.success) return validationFailure(parsed.error);

    const announcement = await notificationCenterController.getAnnouncement(
      guard.access,
      parsed.data.id,
      new Date()
    );

    return NextResponse.json(ok(announcement));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

// PATCH
// ACCESS     : requireAnnouncementManageAccess — the narrow set.
// VALIDATION : updateAnnouncementSchema, .strict(), refusing an EMPTY body —
//              an update with no fields would be a silent no-op that still
//              advanced updatedAt.
// FLOW       : Guard → validate param → parse → validate body → controller.
//
//              The audience is re-validated against the MERGED result, not
//              against the supplied fields alone. Supplying `audience: SECTION`
//              with no sectionId, while the stored row carries a departmentId,
//              would otherwise pass a check on the request and produce a row
//              addressed to nobody.
//
//              The check runs only when something audience-shaped moved, so an
//              edit to the title cannot fail because a pre-existing row was
//              already inconsistent.
//
//              publishAt/expiresAt ordering is re-checked against the merged
//              values for the same reason.
// RESPONSE   : { success: true, data: AnnouncementDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function PATCH(request: NextRequest, context: RouteContext) {
  const SCOPE = "PATCH /api/announcements/[id]";

  try {
    const guard = await requireAnnouncementManageAccess();
    if (!guard.granted) return guard.response;

    const parsedParam = announcementParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsedBody = updateAnnouncementSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const updated = await notificationCenterController.updateAnnouncement(
      guard.access,
      parsedParam.data.id,
      parsedBody.data,
      new Date()
    );

    return NextResponse.json(ok(updated, "Announcement updated"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

// DELETE
// ACCESS     : requireAnnouncementManageAccess.
// VALIDATION : announcementParamSchema.
// FLOW       : Guard → validate → controller.
//
//              A HARD delete, unlike a notification. An announcement is a post
//              its author controls, not a record that something was delivered
//              to a named person, so there is no institutional evidence to
//              preserve. AnnouncementRead cascades with it, which is why no
//              orphaned read rows are left behind.
//
//              Scoped by tenantId as well as id, so the write cannot reach
//              another tenant's row even if the id were guessed. A zero row
//              count is the 404.
// RESPONSE   : { success: true, data: null, message: "Announcement deleted" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const SCOPE = "DELETE /api/announcements/[id]";

  try {
    const guard = await requireAnnouncementManageAccess();
    if (!guard.granted) return guard.response;

    const parsed = announcementParamSchema.safeParse(await context.params);
    if (!parsed.success) return validationFailure(parsed.error);

    await notificationCenterController.deleteAnnouncement(guard.access, parsed.data.id);

    return NextResponse.json(ok(null, "Announcement deleted"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
