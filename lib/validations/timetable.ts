// ============================================================================
// OWNER  : Gauransh
// MODULE : Timetable — Timetable Validation
// FLOW   : Validates the timetable route params and creation body before either
//          reaches the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Keep timetable request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { DayOfWeek, SessionType } from "@/app/generated/prisma/client";
import { paginationQuerySchema } from "@/lib/validations/pagination";

/**
 * Strict 24-hour HH:mm.
 *
 * Hours are 00–23 and minutes 00–59, both zero-padded to exactly two digits, so
 * "09:00", "13:45" and "23:59" pass while "9:00", "09:00:00", "9 AM", "24:00" and
 * an ISO instant are all rejected.
 *
 * Timetable.startTime and endTime are plain String columns in the schema — not
 * DateTime and not @db.Time — so the database enforces no format whatsoever and
 * this pattern is the only thing that does.
 *
 * The fixed width is what makes the endTime > startTime comparison below sound:
 * zero-padded HH:mm sorts identically as text and as time, which would not hold
 * for a variable-width format such as "9:00".
 */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A time-of-day column.
 *
 * Trimmed before matching, following the project-wide convention for string
 * inputs, so surrounding whitespace is tolerated while the value itself must
 * conform exactly. An empty or whitespace-only string cannot match the pattern
 * and is rejected.
 */
const timeOfDay = z.string().trim().regex(HH_MM);

/**
 * Route param schema for /api/timetables/[id].
 *
 * Timetable.id is a cuid, not a UUID, so no UUID assertion is applied — it would
 * reject every legitimate id. The value is an opaque key, and an
 * unrecognised-but-well-formed one is a 404 rather than a 400. Only an empty or
 * whitespace-only segment is rejected outright.
 */
export const timetableIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type TimetableIdParam = z.infer<typeof timetableIdParamSchema>;

/**
 * Route param schema for /api/timetables/section/[sectionId].
 *
 * Keyed on sectionId rather than id, because that is the segment name and so the
 * key Next.js supplies. sectionIdParamSchema in the section module is keyed on id
 * for /api/sections/[id] and cannot be reused here: a plain z.object() strips
 * unknown keys, so parsing { sectionId } against it would drop the value and then
 * fail on a missing id. Same reasoning as documentIdParamSchema in the student
 * module.
 */
export const timetableSectionParamSchema = z.object({
  sectionId: z.string().trim().min(1),
});

export type TimetableSectionParam = z.infer<typeof timetableSectionParamSchema>;

/**
 * Route param schema for /api/timetables/faculty/[facultyId].
 *
 * Keyed on facultyId for the same reason as above — facultyIdParamSchema in the
 * faculty module is keyed on id and would strip this segment.
 */
export const timetableFacultyParamSchema = z.object({
  facultyId: z.string().trim().min(1),
});

export type TimetableFacultyParam = z.infer<typeof timetableFacultyParamSchema>;

/**
 * Body schema for POST /api/timetables.
 *
 * Mirrors the writable scalar columns of the Timetable model, in column order.
 * semesterId, sectionId, courseId, facultyId, day, startTime and endTime are
 * required — day has no schema default, so it must always be supplied. roomNo is
 * nullable, and sessionType and isActive carry schema defaults (LECTURE and true),
 * so an omitted key lets the database default apply.
 *
 * tenantId is intentionally absent, along with id and createdAt: the tenant is
 * derived from the validated request context by requireTenant, never accepted from
 * the client, so a timetable entry cannot be created against another tenant. A
 * body supplying any of the three has it stripped rather than rejected.
 *
 * The four references are validated here only for shape. That each referenced row
 * exists AND belongs to the authenticated tenant is enforced against the database
 * in the route. All four carry real foreign keys, but a foreign key proves
 * existence rather than ownership, so each still needs its own tenant-scoped
 * lookup — and Timetable.tenantId carries no foreign key at all, so nothing in the
 * schema ties the entry to the rows it points at.
 *
 * roomNo is a free-text column. The schema declares no Room model, so there is
 * nothing to validate a room against and no normalisation is applied: "A101" and
 * "a101" are distinct values.
 *
 * No collision validation of any kind is declared, per the approved Phase 9
 * decisions. Timetable has no unique constraint in the schema — not one — so the
 * database permits the same section booked for two courses at one time, the same
 * faculty member in two places at once, the same room used twice, and byte-identical
 * duplicate rows. All of that is allowed here rather than rejected, because
 * inventing a scheduling rule the schema does not express is out of scope. The one
 * cross-field rule below comes from the approved time-format decision, not from
 * any scheduling policy.
 *
 * isActive is writable on create only. No update schema exists — see the note
 * after this schema.
 */
export const createTimetableSchema = z
  .object({
    semesterId: z.string().trim().min(1),
    sectionId: z.string().trim().min(1),
    courseId: z.string().trim().min(1),
    facultyId: z.string().trim().min(1),
    day: z.enum(DayOfWeek),
    startTime: timeOfDay,
    endTime: timeOfDay,
    roomNo: z.string().trim().min(1).optional(),
    sessionType: z.enum(SessionType).optional(),
    isActive: z.boolean().optional(),
  })
  // Applied after both fields have passed the HH:mm pattern, so the comparison is
  // between two zero-padded fixed-width strings and text order matches clock
  // order. Strictly greater than, so a zero-length slot is rejected as well as an
  // inverted one. This says nothing about how long a session may be or when the
  // day starts and ends — no such rule exists in the schema or README.
  .refine((data) => data.endTime > data.startTime);

export type CreateTimetableInput = z.infer<typeof createTimetableSchema>;

// No update schema is declared. The README defines GET and POST for
// /api/timetables and DELETE only for /api/timetables/[id] — there is no PATCH for
// a timetable entry anywhere in the phase, and the model has no updatedAt column
// to record one. An update schema would be unreachable code.

// No query schema is declared either. The approved decisions state that the
// timetable read endpoints return the full schedule, so no pagination contract
// applies, and the README defines no filter parameters for /api/timetables — unlike
// /api/attendance, which names student, section and date. With neither pagination
// nor filters there is nothing for a query schema to validate, so exporting an
// empty one would be dead code.

// ============================================================================
// CLASS SCHEDULING
//
// Everything below was added for the Class Scheduling feature. The notes above
// describe the endpoint as it was first built — GET and POST for administrators
// only, no filters, no update, and explicitly no collision checking. All three
// of those gaps are what this section closes, so the reasoning that follows
// supersedes the "no query schema" and "no update schema" notes above rather
// than contradicting them.
// ============================================================================

/**
 * A filter value that may legitimately arrive empty.
 *
 * The same helper courseQuerySchema and batchQuerySchema declare, restated here
 * because each module in this project keeps its own copy. "" means "no filter":
 * every ListFilter reset writes an empty value, and a bookmarked "?sectionId="
 * must mean the same thing rather than answer 400.
 *
 * No format assertion on the id — it is an opaque cuid, and one naming nothing
 * (or naming another tenant's row) simply matches no slots, because the tenant
 * predicate is ANDed alongside it in the route.
 */
const optionalFilter = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value === undefined || value === "" ? undefined : value));

/**
 * Treat "" as absent BEFORE an enum check.
 *
 * "All days" and "All session types" write an empty value. Without this, "no
 * filter" would be reported as an invalid DayOfWeek — the same reason
 * courseQuerySchema preprocesses its `type`.
 */
function optionalEnumFilter<T extends z.ZodTypeAny>(schema: T) {
  return z
    .preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      schema.optional()
    )
    .optional();
}

/**
 * Query schema for GET /api/timetables.
 *
 * WHAT WAS WRONG
 *   This route parsed `paginationQuerySchema` directly, so Zod dropped every
 *   other key before the handler saw it and the route read the whole tenant's
 *   schedule regardless of what was asked for. That is the same defect class as
 *   tester issues #22, #23, #26, #28 and #30, and it is fixed the same way.
 *
 * WHY THESE SIX
 *   Exactly the controls the Timetable screen offers: semester, section, course,
 *   faculty, day and session type. Nothing accepts a parameter no toolbar sends.
 *
 * NO ?isActive FILTER and no ?q. A cancelled slot lists alongside a live one
 * with the client reading the flag — the same convention the Courses screen
 * follows — and roomNo is free text on a grid that is read by day, not searched.
 */
export const timetableQuerySchema = paginationQuerySchema.extend({
  semesterId: optionalFilter,
  sectionId: optionalFilter,
  courseId: optionalFilter,
  facultyId: optionalFilter,
  day: optionalEnumFilter(z.enum(DayOfWeek)),
  sessionType: optionalEnumFilter(z.enum(SessionType)),
});

export type TimetableQuery = z.infer<typeof timetableQuerySchema>;

/**
 * Body schema for PATCH /api/timetables/[id].
 *
 * WHY AN UPDATE SCHEMA NOW EXISTS
 *   The note above is right that the original phase defined no PATCH. Class
 *   Scheduling requires rescheduling and cancellation, and both are updates:
 *   moving a slot to another period must not destroy and recreate the row,
 *   because Attendance references Timetable and a new id would orphan every
 *   register already taken against it.
 *
 * WHY NOT createTimetableSchema.partial()
 *   Two reasons. The create schema carries a `.refine`, and calling .partial()
 *   on a refined schema is not available in Zod 4 — the refinement wraps the
 *   object rather than living on it. And the rule itself has to change: on a
 *   partial body, "endTime after startTime" can only be checked when BOTH
 *   arrive, so the route re-checks the merged pair against the stored row. That
 *   is a genuinely different rule, not the same one applied loosely.
 *
 * roomNo accepts null so a room can be cleared. sessionType and isActive are
 * plain optionals — isActive is how a class is cancelled and restored, which is
 * why there is no DELETE in the scheduling flow at all.
 */
export const updateTimetableSchema = z
  .object({
    semesterId: z.string().trim().min(1).optional(),
    sectionId: z.string().trim().min(1).optional(),
    courseId: z.string().trim().min(1).optional(),
    facultyId: z.string().trim().min(1).optional(),
    day: z.enum(DayOfWeek).optional(),
    startTime: timeOfDay.optional(),
    endTime: timeOfDay.optional(),
    roomNo: z.string().trim().min(1).nullable().optional(),
    sessionType: z.enum(SessionType).optional(),
    isActive: z.boolean().optional(),
  })
  // An empty body is a no-op the caller almost certainly did not intend, and it
  // would otherwise re-run every conflict check and re-notify every student
  // about a change that did not happen.
  .refine((data) => Object.keys(data).length > 0, {
    message: "Supply at least one field to update",
  })
  // Only when BOTH are present. A body moving only the start time is checked
  // against the stored end time in the route, where that value is known.
  .refine(
    (data) =>
      data.startTime === undefined || data.endTime === undefined || data.endTime > data.startTime,
    { message: "End time must be after start time", path: ["endTime"] }
  );

export type UpdateTimetableInput = z.infer<typeof updateTimetableSchema>;

/**
 * The one place the time comparison is spelled out.
 *
 * Sound only because timeOfDay above requires zero-padded 24-hour HH:mm: two
 * fixed-width strings sort identically as text and as clock time. Exported so
 * the scheduling service compares times the same way the schema validates them,
 * rather than growing a second notion of "later".
 */
export function isBefore(earlier: string, later: string): boolean {
  return earlier < later;
}
