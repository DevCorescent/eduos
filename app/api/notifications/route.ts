// ============================================================================
// OWNER  : Gauransh
// MODULE : Notifications — Notification List
// FLOW   : Guard → tenant → query → recipient-scoped paginated read → response.
// ACCESS : ALL SEVEN ROLES, each confined to their OWN notifications.
// BACKEND: notificationCenterController → NotificationCenterService →
//          NotificationCenterRepository → Prisma.
// PURPOSE: The Notification Center's list — the caller's own notifications,
//          filterable by category and read state.
//
// ============================================================================
// PHASE 27 REWROTE THIS PHASE 13 ROUTE. WHAT CHANGED, AND WHY.
//
//   BEFORE: `requireRole("UNIVERSITY_ADMIN")`, returning EVERY notification in
//           the tenant, unfiltered, with only ?page and ?limit honoured.
//
//   AFTER:  every role the README's Phase 27 names, each seeing ONLY their own
//           notifications, with ?category, ?unreadOnly and ?archived honoured.
//
// WHY THE CHANGE WAS UNAVOIDABLE
//   Phase 27 is a Notification Center for SUPER_ADMIN, UNIVERSITY_ADMIN,
//   CAMPUS_ADMIN, DEPARTMENT_HOD, FACULTY, STUDENT and PARENT. Under the
//   previous guard no student and no faculty member could read even their own
//   notifications — the bell would have been empty for everyone but one role.
//   The alternative, a second list endpoint at a different path, would have
//   left two routes over one table disagreeing about what a notification list
//   means.
//
// WHAT WIDENING THE ROLES DID *NOT* DO
//   It did not widen what anyone SEES. The previous handler returned the whole
//   tenant's notifications to an administrator; this one returns each caller's
//   own, including for an administrator. That is a NARROWING for the only role
//   that previously had access, and it is deliberate: an administrator's bell
//   should hold their notifications, not everyone's. A tenant-wide operational
//   view of what was sent is a reporting concern this endpoint never served
//   well and does not claim to serve now.
//
// WHAT IS PRESERVED EXACTLY
//   The response envelope, the pagination shape, the newest-first ordering with
//   the id tiebreaker, and the reason for that tiebreaker: POST
//   /api/notifications/send writes an entire batch with one createMany, so
//   every row in it shares a createdAt and createdAt alone cannot page
//   deterministically.
//
//   POST /api/notifications/send and the notification-template routes are
//   UNTOUCHED by this phase.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { notificationCenterController } from "@/lib/controllers/notificationCenter.controller";
import { requireNotificationAccess } from "@/lib/middleware/requireNotificationAccess";
import { notificationListQuerySchema } from "@/lib/validations/notificationCenter.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/notifications";

// GET
// ACCESS     : requireNotificationAccess — role then tenant, in that order, so
//              an unauthenticated caller receives requireAuth's 401 and a
//              caller with no recognised role receives 403 without the tenant
//              lookup being performed.
// VALIDATION : notificationListQuerySchema, .strict(). ?category, ?unreadOnly,
//              ?archived (default false), ?page and ?limit. An unrecognised
//              parameter is now a 400 rather than being silently stripped —
//              the previous handler ignored thirteen inert parameters, which
//              let a client believe a filter had been applied.
// FLOW       : Guard → validate → controller.
//
//              Every query is anchored on `userId = session.sub` AND the
//              resolved tenant. There is no parameter that names another
//              recipient, so reading someone else's bell is unexpressible.
//
//              `deletedAt: null` is unconditional in the repository — a
//              notification the user dismissed cannot reappear through any
//              combination of filters.
//
//              The page and its total are read in one transaction, so the count
//              cannot describe a wider set than the page.
// REPORTS    : Each notification with its delivery `type` (Phase 13's channel:
//              EMAIL, SMS, PUSH, IN_APP) AND its `category` (Phase 27's subject
//              matter). The two are independent axes — an EMAIL about
//              attendance and an IN_APP about attendance share a category and
//              differ in channel. `category` is null for every row written
//              before the concept existed, which is the correct reading.
// RESPONSE   : { success: true, data: { items, pagination } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
//              This handler performs no writes of any kind.
export async function GET(request: NextRequest) {
  try {
    const guard = await requireNotificationAccess();
    if (!guard.granted) return guard.response;

    const parsed = notificationListQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) return validationFailure(parsed.error);

    const result = await notificationCenterController.listNotifications(
      guard.access,
      parsed.data
    );

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
