// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance Analytics — Route Validation
// FLOW   : Validates the [studentId] route param shared by every Phase 15
//          analytics endpoint before it reaches the controller.
// ACCESS : UNIVERSITY_ADMIN · FACULTY — any student in the tenant.
//          STUDENT — their own analytics only. Enforced in the route, not here.
// BACKEND: No database access — Zod schema definitions only.
// PURPOSE: Single param contract for every /api/attendance/analytics/**
//          endpoint keyed on studentId, so five routes don't each declare
//          their own copy.
//
// FIX (Phase 15 review): this file previously declared
// attendanceAnalyticsParamSchema twice back to back, which fails `tsc` outright
// ("Cannot redeclare block-scoped variable"), and also carried
// createAttendanceSchema / updateAttendanceSchema / attendanceQuerySchema —
// CRUD body schemas that duplicate lib/validations/attendance.ts and describe
// a POST/PATCH body no analytics route accepts. Every analytics endpoint is a
// read keyed on studentId; none of those schemas apply here, so they are
// removed rather than fixed in place.
// ============================================================================

import { z } from "zod";

/**
 * Route param schema for every /api/attendance/analytics/** endpoint keyed on
 * [studentId] — the main analytics, subject-wise, leave-calculator and
 * prediction routes.
 *
 * Student.id is a cuid, not a UUID, so no UUID assertion is applied. An
 * unrecognised-but-well-formed id is a 404 (or a 403 for a student asking
 * about someone else), never a 400 — matching attendanceStudentParamSchema in
 * lib/validations/attendance.ts, which this mirrors for the same reason: the
 * segment name here is also studentId, so that schema cannot be reused as-is
 * without dropping the value on a plain z.object() parse.
 */
export const attendanceAnalyticsParamSchema = z.object({
  studentId: z.string().trim().min(1, "Student ID is required"),
});

export type AttendanceAnalyticsParam = z.infer<typeof attendanceAnalyticsParamSchema>;