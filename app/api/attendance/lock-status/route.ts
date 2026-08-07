// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Lock & Audit System (Phase 22)
// LAYER  : Route
// FLOW   : Guard (role → tenant) → validate query → controller → response.
// ACCESS : ATTENDANCE_LOCK_READ_ROLES — FACULTY · DEPARTMENT_HOD · HOD ·
//          UNIVERSITY_ADMIN. Every role the lock can affect may see its state;
//          a faculty member who cannot discover that their register is frozen
//          would experience the enforcement as an unexplained 409.
// BACKEND: attendanceLockController → AttendanceLockService →
//          AttendanceLockRepository → Prisma.
// PURPOSE: Report which teaching units are locked, over what window, by whom,
//          and — when a date is supplied — whether a write on that day would be
//          refused.
//
// THE ?date ANSWER COMES FROM THE ENFORCEMENT PREDICATE ITSELF
//   `blocksRequestedDate` is computed by the same windowCoversDate() the
//   attendance write path calls. It is not a re-derivation, so this endpoint
//   cannot tell a faculty member their mark will be accepted and then have the
//   write refuse it.
//
// STUDENT AND PARENT ARE ABSENT
//   Neither role can write attendance, so neither can be refused by a lock, and
//   the README's Phase 22 names only DEPARTMENT_HOD and FACULTY.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { attendanceLockController } from "@/lib/controllers/attendanceLock.controller";
import { requireAttendanceLockAccess } from "@/lib/middleware/requireAttendanceLockAccess";
import { ATTENDANCE_LOCK_READ_ROLES } from "@/lib/constants/attendanceLock";
import { lockStatusQuerySchema } from "@/lib/validations/attendanceLock.validation";
import { handleRouteError, validationFailure } from "@/lib/utils/api-response";
import { ok } from "@/types";

const SCOPE = "GET /api/attendance/lock-status";

// GET
// ACCESS     : requireAttendanceLockAccess(ATTENDANCE_LOCK_READ_ROLES).
// VALIDATION : lockStatusQuerySchema — every filter optional, so one endpoint
//              answers both "is THIS unit locked" and "what is locked in this
//              semester". .strict(), so an unrecognised parameter is a 400
//              rather than an inert filter the caller believes was applied.
// FLOW       : Guard → validate → controller.
//
//              RELEASED locks are returned alongside held ones. That is
//              deliberate: "this was locked and an HOD opened it on the 4th" is
//              usually the answer a faculty member actually wants, and hiding
//              released rows would make the endpoint unable to give it.
//              `status` distinguishes them.
// REPORTS    : Every matching lock, newest first, with its window as calendar
//              days rather than timestamps — the columns are @db.Date and
//              rendering them as instants invites a client to apply a timezone
//              and land a day early.
//
//              `blocksRequestedDate` is null when no ?date was supplied — the
//              honest answer to a question nobody asked, rather than a `false`
//              that reads as "this would be allowed".
// RESPONSE   : { success: true, data: { locks } }
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

    const parsed = lockStatusQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) return validationFailure(parsed.error);

    const locks = await attendanceLockController.getStatus(guard.access.tenantId, parsed.data);

    return NextResponse.json(ok({ locks }));
  } catch (err) {
    return handleRouteError(SCOPE, err);
  }
}
