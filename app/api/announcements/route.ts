// ============================================================================
// OWNER  : Gauransh
// MODULE : Notification Center & Announcement System (Phase 27)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate → controller → response.
// ACCESS : GET  — ANNOUNCEMENT_READ_ROLES, all seven, each seeing only what is
//                 addressed to them.
//          POST — ANNOUNCEMENT_MANAGE_ROLES: UNIVERSITY_ADMIN · CAMPUS_ADMIN ·
//                 DEPARTMENT_HOD · HOD. FACULTY, STUDENT and PARENT read
//                 announcements and write none; the README's "HOD
//                 Announcement" among the FACULTY notifications confirms the
//                 direction of travel.
// BACKEND: notificationCenterController → NotificationCenterService →
//          announcements audience domain → NotificationCenterRepository.
// PURPOSE: Create an announcement, and list the ones a caller may see.
//
// RESOLVED ON READ, NEVER FANNED OUT
//   Publishing writes ONE row. A batch-wide announcement in a large university
//   would otherwise be tens of thousands of Notification rows per post; editing
//   one would then have to find and rewrite all of them, and deleting one would
//   leave orphans. The audience is stored on the row and each caller's
//   entitlement is computed at query time from their own department, batch and
//   section.
//
// SCHEDULING AND PINNING
//   `publishAt` is compared against now() by the query — nothing flips a status
//   on a timer, because this project has no job runner. `isPinned` is an
//   ORDERING key, not a visibility rule: a pinned announcement sorts first and
//   is otherwise ordinary.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { notificationCenterController } from "@/lib/controllers/notificationCenter.controller";
import {
  requireAnnouncementManageAccess,
  requireNotificationAccess,
} from "@/lib/middleware/requireNotificationAccess";
import {
  announcementListQuerySchema,
  createAnnouncementSchema,
} from "@/lib/validations/notificationCenter.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

// GET
// ACCESS     : requireNotificationAccess — every role, narrowed by AUDIENCE
//              rather than by role.
// VALIDATION : announcementListQuerySchema, .strict().
//
//              `?includeUnpublished` is honoured ONLY for a caller who may
//              manage announcements. A student who sets it receives the
//              ordinary live list — the parameter is not rejected, because
//              rejecting it would tell them the capability exists.
// FLOW       : Guard → validate → controller.
//
//              The caller's audiences are resolved first: a student's batch and
//              section from their Student row, a faculty member's department
//              from their FacultyMember row, and a student's department through
//              their programme. A user who is neither belongs only to the
//              institution-wide audience — correct for an administrator.
//
//              A reader with a NULL scope for a dimension contributes no clause
//              for it, so "unknown" is never treated as "all". That is the
//              difference between a section-scoped message reaching one section
//              and reaching the whole university.
// REPORTS    : Pinned first, then publish time, then creation — all descending.
//              Each row carries `isRead` for the caller, read through a
//              filtered nested select so a page of twenty costs two statements
//              rather than twenty-two.
// RESPONSE   : { success: true, data: { items, pagination } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
export async function GET(request: NextRequest) {
  const SCOPE = "GET /api/announcements";

  try {
    const guard = await requireNotificationAccess();
    if (!guard.granted) return guard.response;

    const parsed = announcementListQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) return validationFailure(parsed.error);

    const result = await notificationCenterController.listAnnouncements(
      guard.access,
      parsed.data,
      new Date()
    );

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}

// POST
// ACCESS     : requireAnnouncementManageAccess — the NARROW set. A distinct
//              guard rather than a boolean on the read guard, so the write
//              check cannot be forgotten at a call site.
// VALIDATION : createAnnouncementSchema, .strict(). The audience and its target
//              must agree, checked by the SAME domain function the service uses
//              — an INSTITUTION announcement carrying a batchId is REFUSED
//              rather than having the target silently ignored, which is how an
//              author ends up broadcasting to everyone while believing they
//              narrowed the audience.
//
//              `publishAt` must precede `expiresAt`. `createdById` is absent
//              and taken from session.sub.
// FLOW       : Guard → parse → validate → controller.
//
//              The service additionally verifies the target EXISTS in this
//              tenant: a DEPARTMENT announcement naming another university's
//              department would otherwise be addressed to nobody and report
//              success.
//
//              `status` defaults to DRAFT. The README names no separate publish
//              route for announcements, so PUBLISHED is reachable from create
//              and update — and the liveness rule is evaluated on read
//              regardless of how the row got there.
// RESPONSE   : { success: true, data: AnnouncementDto }
// STATUS     : 201 · 400 · 401 · 403 · 404 · 500
export async function POST(request: NextRequest) {
  const SCOPE = "POST /api/announcements";

  try {
    const guard = await requireAnnouncementManageAccess();
    if (!guard.granted) return guard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsed = createAnnouncementSchema.safeParse(body);
    if (!parsed.success) return validationFailure(parsed.error);

    const created = await notificationCenterController.createAnnouncement(
      guard.access,
      parsed.data,
      new Date()
    );

    return NextResponse.json(ok(created, "Announcement created"), { status: 201 });
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
