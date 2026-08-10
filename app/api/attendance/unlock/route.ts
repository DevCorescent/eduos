// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Lock & Audit System (Phase 22)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → parse body → validate → controller →
//          response.
// ACCESS : ATTENDANCE_UNLOCK_ROLES — DEPARTMENT_HOD · HOD · UNIVERSITY_ADMIN.
//
//          FACULTY IS EXCLUDED, AND THAT EXCLUSION IS THE PHASE.
//          The README's premise is that a finalised register may be changed
//          only when "explicitly unlocked by the HOD". If the role that locks
//          could also unlock, a faculty member wanting to alter a finalised
//          record would simply unlock, edit and relock — and the legal record
//          this phase exists to protect would be exactly as protected as it was
//          before the phase. The asymmetry between this route's role set and
//          /api/attendance/lock's is the entire security property.
// BACKEND: attendanceLockController → AttendanceLockService →
//          AttendanceLockRepository + AuditLogRepository → Prisma.
// PURPOSE: Release a lock so a teaching unit's attendance can be corrected.
//
// SECURITY: the actor is taken from session.sub inside the guard. The body
//          schema is .strict(), so a supplied unlockedById or status is a 400.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { attendanceLockController } from "@/lib/controllers/attendanceLock.controller";
import { requireAttendanceLockAccess } from "@/lib/middleware/requireAttendanceLockAccess";
import { ATTENDANCE_UNLOCK_ROLES } from "@/lib/constants/attendanceLock";
import { unlockAttendanceSchema } from "@/lib/validations/attendanceLock.validation";
import { handleRouteError, malformedBody, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";
// PHASE 22's "Faculty Notification" feature, and the Phase 27 faculty event
// "Attendance Unlock". This direction matters MORE than the lock: a faculty
// member who was refused a correction needs to know the window has reopened.
import {
  findFacultyUserIdsForUnit,
  notificationEmitter,
  notifyAfterCommit,
} from "@/lib/controllers/notificationEmitter.controller";

const SCOPE = "POST /api/attendance/unlock";

// POST
// ACCESS     : requireAttendanceLockAccess(ATTENDANCE_UNLOCK_ROLES) — the
//              narrow set. A FACULTY caller reaches a 403 here having been
//              permitted at /api/attendance/lock, which is intended.
// VALIDATION : unlockAttendanceSchema. The teaching unit is named in full, and
//              `reason` is REQUIRED — optional on lock, mandatory here.
//              Releasing a finalised academic record unexplained is the
//              unattributable-reversal shape TD-008 and TD-C39 already record
//              elsewhere in this project; this phase does not repeat it.
//
//              No window is accepted. An unlock releases the lock that exists;
//              carving a hole in a freeze would mean splitting one row into two
//              and the README describes neither.
// FLOW       : Guard → parse → validate → controller.
//
//              The service refuses a unit that was never locked (404) and one
//              already released (409) — genuinely different situations, and
//              "already unlocked" is actionable where "not found" would send an
//              HOD looking for a typo.
//
//              A concurrent unlock that wins the race leaves this one matching
//              zero rows; Prisma raises P2025 and the shared error mapper
//              answers 404 rather than reporting a release that did not happen.
//
//              The update and its audit entry share ONE transaction.
// RESPONSE   : { success: true, data: AttendanceLockDto }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 409 · 500
export async function POST(request: NextRequest) {
  try {
    const guard = await requireAttendanceLockAccess(ATTENDANCE_UNLOCK_ROLES, request.headers);
    if (!guard.granted) return guard.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return malformedBody();
    }

    const parsed = unlockAttendanceSchema.safeParse(body);
    if (!parsed.success) return validationFailure(parsed.error);

    const lock = await attendanceLockController.unlock(
      guard.access.tenantId,
      parsed.data,
      {
        userId: guard.access.userId,
        ipAddress: guard.access.ipAddress,
        userAgent: guard.access.userAgent,
      },
      new Date()
    );

    // PHASE 22 "Faculty Notification" / PHASE 27 "Attendance Unlock".
    // After the release has committed; emission throws nothing.
    const recipients = await findFacultyUserIdsForUnit(
      guard.access.tenantId,
      parsed.data.courseId,
      parsed.data.sectionId
    );

    await notifyAfterCommit("POST /api/attendance/unlock", async () => {
      await notificationEmitter.attendanceLockChanged({
        tenantId: guard.access.tenantId,
        recipientUserIds: recipients,
        locked: false,
        courseLabel: lock.unit.courseCode ?? lock.unit.courseId,
        sectionLabel: lock.unit.sectionName ?? lock.unit.sectionId,
        reason: lock.unlockReason,
        lockId: lock.id,
      });
    });

    return NextResponse.json(ok(lock, "Attendance unlocked"));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
