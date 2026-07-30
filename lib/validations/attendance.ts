// ============================================================================
// OWNER  : Gauransh
// MODULE : Attendance — Attendance Validation
// FLOW   : Validates the attendance route params and bulk creation body before
//          either reaches the database.
// ACCESS : FACULTY · UNIVERSITY_ADMIN (write and read)
//          STUDENT may read only their own attendance; PARENT is not implemented.
//          Role precedence is UNIVERSITY_ADMIN > FACULTY > STUDENT. None of that
//          is enforced here — access control belongs to requireRole and the
//          routes, and this module performs no authorisation of any kind.
// BACKEND: No database access — Zod schema definitions only.
// PURPOSE: Keep attendance request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { AttendanceStatus, SessionType } from "@/app/generated/prisma/client";

/**
 * One attendance record inside a bulk submission.
 *
 * Mirrors the writable scalar columns of the Attendance model, in column order.
 * Module-private rather than exported, following the convention set by timeOfDay
 * in the timetable module: it is a building block of the exported schema, not a
 * request contract of its own. A route that needs the element type derives it
 * from the exported one as CreateAttendanceInput["records"][number], so the
 * shape stays defined in exactly one place.
 *
 * studentId is the only required reference. facultyId, sectionId and courseId are
 * all nullable in the schema and so are optional here — the model permits a
 * record that names none of them.
 *
 * date is required and coerced, matching the project-wide z.coerce.date()
 * convention used for every other date column. Attendance.date is @db.Date, so
 * Postgres stores the day and discards any time component; no truncation is
 * applied here because doing so would be a transformation the schema already
 * performs. No bound is placed on the value: nothing in the schema or README
 * forbids a past or future date, and inventing one would be a business rule.
 *
 * status and sessionType carry schema defaults (PRESENT and LECTURE), so an
 * omitted key lets the database default apply rather than being restated here.
 * Both are validated directly against the Prisma enums, so the accepted values
 * cannot drift from the database.
 *
 * remarks is free text and optional, trimmed like every other string input, with
 * an empty or whitespace-only value rejected rather than stored as "".
 *
 * Deliberately absent:
 *   id, tenantId — server-managed. The tenant is derived from the validated
 *     request context by requireTenant, never accepted from the client, so a
 *     record cannot be created against another tenant.
 *   markedAt — carries @default(now()), so it is the server clock. Supplying it
 *     would let a client backdate when a mark was recorded.
 *   markedBy — set by the route from the authenticated session. Accepting it
 *     from the body would let any caller attribute a mark to another user.
 * A body supplying any of the four has it stripped rather than rejected, which is
 * the project-wide behaviour of a plain z.object(): no schema in this project
 * uses .strict(), and attendance does not become the first.
 *
 * Attendance has no createdAt or updatedAt column at all, so neither appears
 * here and neither can be reported by a route.
 *
 * No cross-field rule is declared. @@unique([studentId, courseId, date,
 * sessionType]) exists in the schema, but courseId is nullable and PostgreSQL
 * treats NULL as distinct within a unique index, so that constraint does not
 * express what it appears to — the same shape already recorded as TD-001 for
 * FacultyCourseAssignment. Resolving what uniqueness should mean when courseId is
 * absent is an open decision, so nothing is asserted about it here; validation
 * accepts what the model accepts and the consequence is left to the route.
 */
const attendanceRecordSchema = z.object({
  studentId: z.string().trim().min(1),
  facultyId: z.string().trim().min(1).optional(),
  sectionId: z.string().trim().min(1).optional(),
  courseId: z.string().trim().min(1).optional(),
  date: z.coerce.date(),
  status: z.enum(AttendanceStatus).optional(),
  sessionType: z.enum(SessionType).optional(),
  remarks: z.string().trim().min(1).optional(),
});

/**
 * Body schema for POST /api/attendance.
 *
 * The README describes this endpoint as marking attendance in bulk, so the body
 * carries a named array rather than a single record. The array is wrapped in an
 * object rather than being the body itself: every other POST in the project takes
 * an object, and an envelope leaves room for batch-level fields to be added later
 * without breaking a client.
 *
 * At least one record is required. An empty array would be a request that asks
 * for nothing to happen, which is a malformed submission rather than a valid
 * no-op. No upper bound is imposed — none is defined by the schema or the README,
 * and inventing a batch limit here would be a business rule.
 *
 * No rule relates the records to one another. Two records naming the same student
 * on the same date, or the same student twice outright, are accepted by this
 * schema: the database's unique constraint is what governs that, and it cannot be
 * restated faithfully here while courseId remains nullable. Nothing is asserted
 * about whether the batch is applied atomically either — that is the route's
 * contract, not the body's.
 */
export const createAttendanceSchema = z.object({
  records: z.array(attendanceRecordSchema).min(1),
});

export type CreateAttendanceInput = z.infer<typeof createAttendanceSchema>;

/**
 * Route param schema for /api/attendance/[id].
 *
 * Attendance.id is a cuid, not a UUID, so no UUID assertion is applied — it would
 * reject every legitimate id. The value is an opaque key, and an
 * unrecognised-but-well-formed one is a 404 rather than a 400. Only an empty or
 * whitespace-only segment is rejected outright, matching every other detail route
 * in the project.
 */
export const attendanceIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type AttendanceIdParam = z.infer<typeof attendanceIdParamSchema>;

/**
 * Route param schema for /api/attendance/report/[studentId].
 *
 * Keyed on studentId rather than id, because that is the segment name and so the
 * key Next.js supplies. studentIdParamSchema in the student module is keyed on id
 * for /api/students/[id] and cannot be reused here: a plain z.object() strips
 * unknown keys, so parsing { studentId } against it would drop the value and then
 * fail on a missing id. Same reasoning as timetableSectionParamSchema and
 * timetableFacultyParamSchema in the timetable module.
 */
export const attendanceStudentParamSchema = z.object({
  studentId: z.string().trim().min(1),
});

export type AttendanceStudentParam = z.infer<typeof attendanceStudentParamSchema>;

// No query schema is declared for GET /api/attendance. The README names student,
// section and date as the dimensions it answers on, but defines no parameter
// contract — whether date is a single day or a range, whether any filter is
// required, and whether the collection pages are all undecided. No pagination
// decision exists for attendance either, so paginationQuerySchema is deliberately
// not reused: importing it would decide that question by accident. Exporting a
// schema built on guesses would be worse than exporting none.

// No query schema is declared for GET /api/attendance/report/[studentId] either.
// No query parameter is defined for that endpoint anywhere in the schema, the
// README or the approved decisions, so there is nothing to validate and an empty
// schema would be dead code. How the attendance percentage is computed — in
// particular what its denominator is — is a route concern that reaches no request
// field, so it does not change this either way.

// No update schema is declared. PATCH /api/attendance/[id] corrects a record, but
// which columns a correction may touch, and whether a correction is recorded
// rather than applied in place, are undecided. Attendance has no updatedAt column
// to record one, and markedAt/markedBy describe the original mark. Declaring an
// update body before that behaviour is settled would fix a contract by accident.
