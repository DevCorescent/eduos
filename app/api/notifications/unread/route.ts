// ============================================================================
// OWNER  : Gauransh
// MODULE : Notification Center & Announcement System (Phase 27)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate query → controller → response.
// ACCESS : NOTIFICATION_CENTER_ROLES — all seven, each confined to their own.
// BACKEND: notificationCenterController → NotificationCenterService →
//          NotificationCenterRepository → Prisma.
// PURPOSE: The README's "Unread Count" and the notification drawer's contents.
//
// THE COUNT IS OVER THE WHOLE UNREAD SET, NOT THE RETURNED PAGE
//   A bell badge reading "20" when there are two hundred unread notifications
//   would be worse than useless. `unreadCount` is a separate COUNT over the
//   same predicate, so the badge is right however few items the drawer shows.
//
// THIS PATH DOES NOT COLLIDE WITH /api/notifications/[id]
//   `unread` is a static segment; no `[id]` sibling exists at this level in any
//   case, and Next.js resolves static before dynamic regardless.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { notificationCenterController } from "@/lib/controllers/notificationCenter.controller";
import { requireNotificationAccess } from "@/lib/middleware/requireNotificationAccess";
import { unreadNotificationQuerySchema } from "@/lib/validations/notificationCenter.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/notifications/unread";

// GET
// ACCESS     : requireNotificationAccess.
// VALIDATION : unreadNotificationQuerySchema, .strict(). Deliberately narrower
//              than the list schema: `unreadOnly` and `archived` are absent
//              because this endpoint IS the unread, unarchived view. Offering
//              them would create two ways to ask the same question that could
//              disagree.
// FLOW       : Guard → validate → controller.
//
//              Archived notifications are excluded: a user who archived
//              something has dealt with it, and counting it would make the
//              badge un-clearable. Soft-deleted ones are excluded
//              unconditionally by the repository.
// REPORTS    : `unreadCount` — the true total — plus up to ?limit items,
//              newest first.
// RESPONSE   : { success: true, data: { unreadCount, items } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
//              This handler performs no writes of any kind. Reading the drawer
//              does NOT mark anything read; that is an explicit action with its
//              own endpoint, so opening a bell cannot silently clear a badge.
export async function GET(request: NextRequest) {
  try {
    const guard = await requireNotificationAccess();
    if (!guard.granted) return guard.response;

    const parsed = unreadNotificationQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) return validationFailure(parsed.error);

    const result = await notificationCenterController.unread(guard.access, parsed.data);

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
