// ============================================================================
// OWNER  : Gauransh
// MODULE : Notification Center & Announcement System (Phase 27)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate param → parse body → validate →
//          controller → response.
// ACCESS : NOTIFICATION_CENTER_ROLES — all seven, each confined to their own.
// BACKEND: notificationCenterController → NotificationCenterService →
//          NotificationCenterRepository → Prisma.
// PURPOSE: The README's "Mark as Read", and — via `?archive` — its "Archive
//          Notification".
//
// WHY ARCHIVE LIVES HERE RATHER THAN AT ITS OWN ENDPOINT
//   The README lists "Archive Notification" as a feature but names no route for
//   it. Archiving on read is the ordinary bell interaction, and a client that
//   wants only to mark read omits the flag. Inventing a route the specification
//   does not name would be a bigger departure than an optional field on the one
//   it does.
//
// THE RECIPIENT PREDICATE IS PART OF THE WRITE
//   The update carries `userId = session.sub`, so a zero row count means the
//   notification is not the caller's — an unknown id, another tenant's, or
//   another person's. All three become the same 404; a 403 would confirm that a
//   notification with that id exists somewhere.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { notificationCenterController } from "@/lib/controllers/notificationCenter.controller";
import { requireNotificationAccess } from "@/lib/middleware/requireNotificationAccess";
import {
  markNotificationSchema,
  notificationParamSchema,
} from "@/lib/validations/notificationCenter.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "PATCH /api/notifications/[id]/read";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH
// ACCESS     : requireNotificationAccess.
// VALIDATION : notificationParamSchema for [id]; markNotificationSchema for the
//              body, .strict(). `readAt` and `userId` are absent and therefore
//              refused — accepting `readAt` would let a client backdate when it
//              claims to have seen something.
// FLOW       : Guard → validate param → parse → validate body → controller.
//
//              An ABSENT body is treated as {} — marking read without archiving
//              is the ordinary call. A PRESENT but unparseable body is a 400.
//
//              `readAt` is set to the server clock. Re-reading an already-read
//              notification is idempotent in effect; the repository's predicate
//              keeps it from reaching a soft-deleted row.
// RESPONSE   : { success: true, data: { id, readAt, archived } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const guard = await requireNotificationAccess();
    if (!guard.granted) return guard.response;

    const parsedParam = notificationParamSchema.safeParse(await context.params);
    if (!parsedParam.success) return validationFailure(parsedParam.error);

    let body: unknown = {};
    const raw = await request.text().catch(() => "");

    if (raw.trim().length > 0) {
      try {
        body = JSON.parse(raw);
      } catch {
        return malformedBody();
      }
    }

    const parsedBody = markNotificationSchema.safeParse(body);
    if (!parsedBody.success) return validationFailure(parsedBody.error);

    const result = await notificationCenterController.markRead(
      guard.access,
      parsedParam.data.id,
      parsedBody.data,
      new Date()
    );

    return NextResponse.json(ok(result, "Notification marked as read"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
