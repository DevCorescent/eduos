// ============================================================================
// OWNER  : Gauransh
// MODULE : Assessments — Examination Validation
// FLOW   : Validates the examination route params and request bodies before
//          either reaches the database.
// ACCESS : UNIVERSITY_ADMIN · FACULTY
//          No access control is performed here — that stays in requireRole and
//          the routes.
// BACKEND: No database access — Zod schema definitions only.
// PURPOSE: Keep examination request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { ExaminationType } from "@/app/generated/prisma/client";

/**
 * Strict 24-hour HH:mm.
 *
 * Hours are 00–23 and minutes 00–59, both zero-padded to exactly two digits, so
 * "09:00", "13:45" and "23:59" pass while "9:00", "09:00:00", "9 AM", "24:00" and
 * an ISO instant are all rejected.
 *
 * Examination.startTime and endTime are plain String columns in the schema — not
 * DateTime and not @db.Time — so the database enforces no format whatsoever and
 * this pattern is the only thing that does. It restates the identical rule
 * already applied to Timetable.startTime and endTime, which share the column
 * type and the purpose.
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
 * The writable scalar columns of the Examination model, in column order.
 *
 * Declared as a bare object rather than as the exported create schema because
 * both exported body schemas need it: .refine() returns an effects wrapper with
 * no .partial() method, so an object carrying cross-field rules cannot be made
 * partial afterwards. The update schema is therefore derived from this object and
 * re-applies the same cross-field rules, which keeps the field rules defined
 * once. This differs structurally from lib/validations/assignment.ts, whose
 * create schema carries no cross-field rule and so could be made partial
 * directly.
 *
 * semesterId and courseId are required: both columns are NOT NULL and both carry
 * real foreign keys. They are validated here only for shape — that each
 * referenced row exists AND belongs to the authenticated tenant is enforced
 * against the database in the route, never here, because a foreign key proves
 * existence rather than ownership.
 *
 * title is required and trimmed. type carries the schema default INTERNAL and is
 * validated directly against the Prisma enum, so the accepted values cannot drift
 * from the database.
 *
 * date is optional and coerced, matching the project-wide z.coerce.date()
 * convention. The column is nullable, so an examination may be created before its
 * date is fixed. No bound is placed on the value: nothing in the schema or README
 * forbids a past or future examination date, and inventing one would be a
 * business rule. Note this column is a full DateTime, unlike Attendance.date
 * which is @db.Date, so any time component supplied is stored rather than
 * truncated.
 *
 * startTime and endTime are optional strict HH:mm. venue is optional free text —
 * the schema declares no Room model, so there is nothing to validate a venue
 * against and no normalisation is applied.
 *
 * maxMarks is required and bounded to a positive integer. The column carries a
 * default of 100 and no check constraint, so the database would accept zero, a
 * negative figure, or an omitted value. It is required here rather than optional
 * — unlike Assignment.maxMarks — because the passMark rule below is only
 * enforceable when the ceiling is known: an omitted maxMarks with a supplied
 * passMark would store the default 100 alongside an unchecked pass mark, which is
 * exactly the incoherence that rule exists to prevent.
 *
 * passMark is optional and bounded to a non-negative integer. Zero is permitted:
 * an examination that everyone passes is expressible, and nothing in the schema
 * forbids it.
 *
 * duration is optional and bounded to a positive integer. The schema states no
 * unit; minutes is the only unit for which an Int is a natural fit for an
 * examination. It is deliberately not reconciled with startTime and endTime — the
 * two may contradict each other, and no rule anywhere relates them, so inventing
 * one is out of scope.
 *
 * instructions is optional and trimmed.
 *
 * Deliberately absent, and therefore stripped from any body that supplies them:
 *   id, tenantId  — server-managed. The tenant is derived from the validated
 *                   request context by requireTenant, never accepted from the
 *                   client, so an examination cannot be created against another
 *                   tenant.
 *   status        — server-managed lifecycle state, the same treatment
 *                   Assignment.status receives. ExamStatus is never written from
 *                   a request body.
 *   createdAt,
 *   updatedAt     — schema-managed timestamps.
 *
 * A body supplying any of them has it stripped rather than rejected, which is the
 * project-wide behaviour of a plain z.object(): no schema in this project uses
 * .strict().
 */
const examinationFields = z.object({
  semesterId: z.string().trim().min(1),
  courseId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  type: z.enum(ExaminationType).optional(),
  date: z.coerce.date().optional(),
  startTime: timeOfDay.optional(),
  endTime: timeOfDay.optional(),
  venue: z.string().trim().min(1).optional(),
  maxMarks: z.number().int().positive(),
  passMark: z.number().int().nonnegative().optional(),
  duration: z.number().int().positive().optional(),
  instructions: z.string().trim().min(1).optional(),
});

/**
 * endTime must be strictly greater than startTime.
 *
 * Applied only when both are supplied, because both columns are nullable and an
 * examination may legitimately record one without the other. The comparison is
 * between two zero-padded fixed-width strings, so text order matches clock order.
 * Strictly greater than, so a zero-length examination is rejected as well as an
 * inverted one. This says nothing about how long an examination may be or when
 * the day starts and ends — no such rule exists in the schema or README.
 */
function timesOrdered(data: { startTime?: string; endTime?: string }): boolean {
  if (data.startTime === undefined || data.endTime === undefined) return true;
  return data.endTime > data.startTime;
}

/**
 * passMark must not exceed maxMarks.
 *
 * Applied only when both are supplied. On create maxMarks is required, so the
 * rule engages whenever a pass mark is given. On update either key may be absent,
 * and this module cannot read the stored value — the route re-evaluates the rule
 * against the merged values after loading the examination, which is the same
 * split already used for marks <= Assignment.maxMarks in the grading route.
 *
 * A pass mark above the maximum would make every result a fail, which is why the
 * bound matters: ExamResult.isPassed is derived from this comparison.
 */
function passMarkWithinMax(data: { maxMarks?: number; passMark?: number }): boolean {
  if (data.maxMarks === undefined || data.passMark === undefined) return true;
  return data.passMark <= data.maxMarks;
}

/**
 * Body schema for POST /api/examinations.
 *
 * The field rules and the two cross-field rules are described above.
 */
export const createExaminationSchema = examinationFields
  .refine(timesOrdered)
  .refine(passMarkWithinMax);

export type CreateExaminationInput = z.infer<typeof createExaminationSchema>;

/**
 * Body schema for PATCH /api/examinations/[id].
 *
 * Derived from the same field object as the create schema, so the enum
 * membership, date coercion, time format, numeric bounds and trimming rules stay
 * defined in one place and cannot drift apart.
 *
 * Nothing is omitted before .partial(). semesterId and courseId stay mutable,
 * matching Course.departmentId and Assignment.courseId, whose detail routes
 * re-validate a changed reference rather than freezing it; the route applies the
 * same tenant-scoped check to a supplied semesterId or courseId that the create
 * path does. This differs from FacultyMember.userId and Student.userId, which are
 * omitted from their update schemas because they are @unique identity bindings —
 * neither of these is.
 *
 * tenantId and status are absent from the field object, so .partial() cannot
 * introduce them: an examination can never be moved between tenants, nor advanced
 * through its lifecycle, by this endpoint.
 *
 * Every remaining key is optional, but at least one must be present: an empty
 * body is a client error, not a silent no-op that would still advance updatedAt.
 *
 * Both cross-field rules are re-applied and both remain conditional on their two
 * keys being present together. A PATCH that supplies only passMark is therefore
 * not checked here against the stored maxMarks; the route performs that
 * comparison on the merged values.
 *
 * As elsewhere, omitting a key leaves the column unchanged; there is no way to
 * clear a nullable column back to null through this endpoint.
 */
export const updateExaminationSchema = examinationFields
  .partial()
  .refine((data) => Object.keys(data).length > 0)
  .refine(timesOrdered)
  .refine(passMarkWithinMax);

export type UpdateExaminationInput = z.infer<typeof updateExaminationSchema>;

/**
 * Route param schema for /api/examinations/[id].
 *
 * Examination.id is a cuid, but no format assertion is applied: the id is an
 * opaque key, and asserting a shape would turn an unrecognised-but-well-formed id
 * into a 400 when 404 is the accurate answer. Only an empty or whitespace-only
 * segment is rejected outright. Identical in form to assignmentIdParamSchema,
 * and keyed on id because that is the segment name.
 */
export const examinationIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type ExaminationIdParam = z.infer<typeof examinationIdParamSchema>;

// No query schema is declared. GET /api/examinations pages on the shared
// contract, and paginationQuerySchema is consumed directly by the route exactly
// as the timetable, attendance and assignment routes consume it. No filter
// parameter is defined for this phase.

// No results schema is declared here. The bulk result upload body for
// POST /api/examinations/[id]/results is a separate contract with its own
// per-record rules, and this module is specified to export exactly the three
// schemas above.
