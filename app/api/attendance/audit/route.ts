// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Lock & Audit System (Phase 22)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate query → controller → response.
// ACCESS : ATTENDANCE_LOCK_READ_ROLES — FACULTY · DEPARTMENT_HOD · HOD ·
//          UNIVERSITY_ADMIN.
// BACKEND: attendanceLockController → AttendanceLockService →
//          AttendanceLockRepository → AuditLog → Prisma.
// PURPOSE: The history of every lock and unlock this tenant has performed.
//
// THIS READS AuditLog, NOT A PHASE-22 TABLE
//   AttendanceLock holds only the CURRENT state of each teaching unit — one row
//   per unit, updated in place by a re-lock. The sequence of transitions lives
//   in the shared AuditLog, written inside the same transaction as each change.
//   That is why the audit survives a unit being locked, released and locked
//   again, which a state table alone could not record.
//
//   AuditLog has no course, section or semester column, so the unit filters are
//   applied against the `after` snapshot the service writes. That snapshot
//   exists precisely so this filtering is possible.
//
// BOTH DIRECTIONS ARE RECORDED
//   A history containing only releases could not answer "when was this
//   finalised", which is the question a disputed attendance record actually
//   raises. ?action narrows to one when a caller wants it.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { attendanceLockController } from "@/lib/controllers/attendanceLock.controller";
import { requireAttendanceLockAccess } from "@/lib/middleware/requireAttendanceLockAccess";
import { ATTENDANCE_LOCK_READ_ROLES } from "@/lib/constants/attendanceLock";
import { attendanceAuditQuerySchema } from "@/lib/validations/attendanceLock.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/attendance/audit";

// GET
// ACCESS     : requireAttendanceLockAccess(ATTENDANCE_LOCK_READ_ROLES).
// VALIDATION : attendanceAuditQuerySchema — optional course/section/semester
//              and action filters, plus ?page and ?limit (default 20, max 100).
//              PAGINATED because an audit history is unbounded by nature: a
//              busy department locks and unlocks continuously across a
//              semester, and the lock-status endpoint's unpaginated shape would
//              be wrong here.
// FLOW       : Guard → validate → controller.
//
//              The page and its total are read in one transaction so the count
//              cannot describe a wider set than the page. Ordering is createdAt
//              then id, both descending — the id tiebreaker is required for
//              correctness, not presentation: offset pagination over rows
//              sharing a timestamp can repeat or skip entries, and a bulk lock
//              writes several within one millisecond.
// REPORTS    : Entries exactly as stored, including their before/after
//              snapshots. Nothing is derived and nothing is reshaped — an audit
//              record rewritten on the way out is evidence of what the reader
//              wanted rather than of what happened.
//
//              Only this module's entries are visible: the query is filtered to
//              resource = "AttendanceLock", so a Phase 22 audit view can never
//              surface another module's history.
// RESPONSE   : { success: true, data: { entries, pagination } }
// STATUS     : 200 · 400 · 401 · 403 · 404 · 500
//
//              This handler performs no writes of any kind.
export async function GET(request: NextRequest) {
  try {
    const guard = await requireAttendanceLockAccess(
      ATTENDANCE_LOCK_READ_ROLES,
      request.headers
    );
    if (!guard.granted) return guard.response;

    const parsed = attendanceAuditQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) return validationFailure(parsed.error);

    const result = await attendanceLockController.getAudit(guard.access.tenantId, parsed.data);

    return NextResponse.json(ok(result));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
