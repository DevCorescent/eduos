// ============================================================================
// OWNER  : Gauransh
// MODULE : Notification Center & Announcement System (Phase 27)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → controller → response.
// ACCESS : NOTIFICATION_CENTER_ROLES — all seven, each confined to their own.
// BACKEND: notificationCenterController → NotificationCenterService →
//          NotificationCenterRepository → Prisma.
// PURPOSE: The README's "Delete Notification".
//
// THIS IS A SOFT DELETE, AND THAT IS DELIBERATE
//   A notification is a record that something was communicated to someone. A
//   recipient dismissing it from their bell is a display preference, not
//   grounds to destroy the institution's evidence that the message was sent —
//   the same reasoning that makes certificate revocation a flag rather than a
//   DELETE (Phase 12), and the reason `deletedAt` was added rather than making
//   this a `prisma.delete`.
//
//   Every read path filters on `deletedAt: null` unconditionally, so from the
//   user's position the notification is gone and cannot return through any
//   combination of filters. From the institution's position it is still there.
//
// A REPEATED DELETE IS A 404, NOT A 200
//   The predicate includes `deletedAt: null`, so a second call matches zero
//   rows. That is the same answer an unknown id gets, which is correct: the
//   notification is not available to be deleted either way.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { notificationCenterController } from "@/lib/controllers/notificationCenter.controller";
import { requireNotificationAccess } from "@/lib/middleware/requireNotificationAccess";
import { notificationParamSchema } from "@/lib/validations/notificationCenter.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "DELETE /api/notifications/[id]";

type RouteContext = { params: Promise<{ id: string }> };

// DELETE
// ACCESS     : requireNotificationAccess. A caller may delete only their OWN
//              notifications — the update predicate carries userId, so a zero
//              row count covers an unknown id, another tenant's and another
//              person's alike, and all three answer 404.
// VALIDATION : notificationParamSchema.
// FLOW       : Guard → validate → controller.
// RESPONSE   : { success: true, data: null, message: "Notification deleted" }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireNotificationAccess();
    if (!guard.granted) return guard.response;

    const parsed = notificationParamSchema.safeParse(await context.params);
    if (!parsed.success) return validationFailure(parsed.error);

    await notificationCenterController.deleteNotification(
      guard.access,
      parsed.data.id,
      new Date()
    );

    return NextResponse.json(ok(null, "Notification deleted"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
