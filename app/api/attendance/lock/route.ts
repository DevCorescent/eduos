// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Lock & Audit System (Phase 22)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → parse body → validate → controller →
//          response.
// ACCESS : ATTENDANCE_LOCK_ROLES — FACULTY · DEPARTMENT_HOD · HOD ·
//          UNIVERSITY_ADMIN. See lib/constants/attendanceLock.ts.
//
//          FACULTY is admitted DELIBERATELY: the person who marked the register
//          is the person who knows when it is finished. The asymmetry that
//          makes this safe is at /api/attendance/unlock, which excludes them.
// BACKEND: attendanceLockController → AttendanceLockService → domain window
//          predicate → AttendanceLockRepository + AuditLogRepository → Prisma.
// PURPOSE: Finalise one teaching unit's attendance, so no further mark or
//          correction can be written for it until an HOD releases the lock.
//
// THIS ROUTE SITS IN FRONT OF /api/attendance/[id], NOT INSIDE IT
//   `lock` is a static segment and `[id]` is dynamic, so Next.js resolves this
//   path here rather than treating "lock" as an attendance id. The same
//   arrangement already works for /api/attendance/analytics.
//
// SECURITY: the actor is taken from session.sub inside the guard and written to
//          both the lock row and its audit entry. The body schema is .strict(),
//          so a supplied lockedById, tenantId or status is a 400 rather than a
//          silent strip — a client that believes it set the actor of a legal
//          finalisation must be told it did not.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { attendanceLockController } from "@/lib/controllers/attendanceLock.controller";
import { requireAttendanceLockAccess } from "@/lib/middleware/requireAttendanceLockAccess";
import { ATTENDANCE_LOCK_ROLES } from "@/lib/constants/attendanceLock";
import { lockAttendanceSchema } from "@/lib/validations/attendanceLock.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";
// PHASE 22's "Faculty Notification" feature, and the Phase 27 faculty event
// "Attendance Lock". Emitted AFTER the lock has committed — see below.
import {
  findFacultyUserIdsForUnit,
  notificationEmitter,
  notifyAfterCommit,
} from "@/lib/controllers/notificationEmitter.controller";

const SCOPE = "POST /api/attendance/lock";

// POST
// ACCESS     : requireAttendanceLockAccess(ATTENDANCE_LOCK_ROLES).
// VALIDATION : lockAttendanceSchema. courseId, sectionId and semesterId are all
//              REQUIRED — a partially-named unit cannot be matched by the
//              enforcement predicate. fromDate/toDate are optional and both
//              omitted means the whole semester (the README's "Semester Lock");
//              a supplied pair is its "Attendance Freeze". The pair is refused
//              if reversed.
//
//              Dates are parsed as calendar dates rather than coerced. TD-002
//              records that the project's z.coerce.date() maps null and false
//              to the Unix epoch — tolerable for a due date, not for the
//              boundary of a freeze, where an epoch fromDate silently widens the
//              lock to every record the tenant holds.
// FLOW       : Guard → parse → validate → controller.
//
//              The service refuses an unknown course, section or semester (404,
//              naming which), and a unit that is already locked (409). The lock
//              row and its audit entry are written in ONE transaction, so a
//              history entry cannot survive a rollback of the finalisation it
//              describes.
//
//              `now` is taken once here and stamped on both the row and the
//              audit entry, so the two cannot disagree about when the unit was
//              finalised.
// RESPONSE   : { success: true, data: AttendanceLockDto }
// STATUS     : 201 Created · 400 · 401 · 403 · 404 · 409 · 500
export async function POST(request: NextRequest) {
  try {
    const guard = await requireAttendanceLockAccess(ATTENDANCE_LOCK_ROLES, request.headers);
    if (!guard.granted) return guard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsed = lockAttendanceSchema.safeParse(body);
    if (!parsed.success) return validationFailure(parsed.error);

    const lock = await attendanceLockController.lock(
      guard.access.tenantId,
      parsed.data,
      {
        userId: guard.access.userId,
        ipAddress: guard.access.ipAddress,
        userAgent: guard.access.userAgent,
      },
      new Date()
    );

    // PHASE 22 "Faculty Notification" / PHASE 27 "Attendance Lock".
    //
    // AFTER the lock transaction has committed, and deliberately so. Emission
    // is inside no transaction and throws nothing — a lock that succeeded but
    // could not notify must still be a lock, and rolling back a legal academic
    // record because a bell entry failed would be the wrong trade in every
    // case. `emitQuietly` swallows and logs its own failures.
    const recipients = await findFacultyUserIdsForUnit(
      guard.access.tenantId,
      parsed.data.courseId,
      parsed.data.sectionId
    );

    await notifyAfterCommit("POST /api/attendance/lock", async () => {
      await notificationEmitter.attendanceLockChanged({
        tenantId: guard.access.tenantId,
        recipientUserIds: recipients,
        locked: true,
        courseLabel: lock.unit.courseCode ?? lock.unit.courseId,
        sectionLabel: lock.unit.sectionName ?? lock.unit.sectionId,
        reason: lock.reason,
        lockId: lock.id,
      });
    });

    return NextResponse.json(ok(lock, "Attendance locked"), { status: 201 });
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
