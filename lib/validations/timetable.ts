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
