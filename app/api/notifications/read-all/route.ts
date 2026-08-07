// ============================================================================
// OWNER  : Gauransh
// MODULE : Notification Center & Announcement System (Phase 27)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → parse body → validate → controller →
//          response.
// ACCESS : NOTIFICATION_CENTER_ROLES — all seven, each confined to their own.
// BACKEND: notificationCenterController → NotificationCenterService →
//          NotificationCenterRepository → Prisma.
// PURPOSE: The README's "Mark All Read".
//
// UNBOUNDED, DELIBERATELY
//   It is ONE update with a WHERE clause, so its cost does not grow with the
//   number of rows the way a per-row loop would. An artificial cap would leave
//   a user pressing the button repeatedly with no indication of how many
//   remained, which is a worse outcome than one slightly larger statement.
//
// SCOPED TO THE CALLER, ALWAYS
//   The predicate carries `userId = session.sub` and the resolved tenant. There
//   is no parameter naming another recipient, so this cannot clear anyone
//   else's badge.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { notificationCenterController } from "@/lib/controllers/notificationCenter.controller";
import { requireNotificationAccess } from "@/lib/middleware/requireNotificationAccess";
import { markAllReadSchema } from "@/lib/validations/notificationCenter.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "PATCH /api/notifications/read-all";

// PATCH
// ACCESS     : requireNotificationAccess.
// VALIDATION : markAllReadSchema, .strict(). An optional ?category narrows the
//              sweep, so a per-tab "mark all read" is possible without a second
//              endpoint. `userId` is absent and therefore refused.
// FLOW       : Guard → parse → validate → controller.
//
//              An ABSENT body is treated as {} — clearing every unread
//              notification is the ordinary call and should not require a
//              payload. A PRESENT but unparseable body is still a 400.
//
//              Already-read notifications are untouched: the predicate carries
//              `readAt: null`, so a second call does not move the timestamp and
//              lose when the user first saw each one.
// REPORTS    : `updated` — how many rows changed, so a client can reconcile its
//              badge without a follow-up read.
// RESPONSE   : { success: true, data: { updated } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function PATCH(request: NextRequest) {
  try {
    const guard = await requireNotificationAccess();
    if (!guard.granted) return guard.response;

    // An absent body is the ordinary case for this endpoint, so it parses as {}
    // rather than failing. Only a present-but-malformed payload is an error.
    let body: unknown = {};
    const raw = await request.text().catch(() => "");

    if (raw.trim().length > 0) {
      try {
        body = JSON.parse(raw);
      } catch {
        return malformedBody();
      }
    }

    const parsed = markAllReadSchema.safeParse(body);
    if (!parsed.success) return validationFailure(parsed.error);

    const result = await notificationCenterController.markAllRead(
      guard.access,
      parsed.data,
      new Date()
    );

    return NextResponse.json(ok(result, "Notifications marked as read"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
