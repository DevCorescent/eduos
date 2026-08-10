// ============================================================================
// OWNER  : Gauransh
// MODULE : Initial University Data Import (W1.6 — PRD §5.1 #14, §54, §55)
// LAYER  : Validation
// PURPOSE: The request contract for the import endpoint, and the per-row
//          schemas each importable entity is checked against.
//
// EVERY ROW SCHEMA MIRRORS ITS PRISMA MODEL AND NOTHING ELSE
//   §54 names the migration modules and defines no columns, so each schema
//   below validates writable fields of the existing model. Nothing is invented.
//
// CSV VALUES ARE ALWAYS STRINGS
//   A cell arrives as text, so numbers and enums are coerced here rather than
//   in the service. Blank means ABSENT, not empty: an untouched spreadsheet
//   cell must fall back to the column default rather than writing "" into a
//   nullable text column or failing an enum check.
// ============================================================================

import { z } from "zod";
import { IMPORT_ENTITY_KEYS } from "@/lib/constants/importEntities";
import {
  CourseType,
  DurationUnit,
  EmployeeStatus,
  EmployeeType,
  ProgrammeType,
  StudentStatus,
} from "@/app/generated/prisma/client";

/**
 * Upper bound on rows in one import.
 *
 * Not a business rule — the PRD states no limit. It bounds the request, the
 * transaction and the memory the parsed file occupies, so a mis-sized upload
 * fails fast with a clear message instead of holding a database transaction
 * open until it times out. Stated in the error so it is never a mystery.
 */
export const MAX_IMPORT_ROWS = 2000;

/** Upper bound on the uploaded text, before parsing. ~2MB of CSV. */
export const MAX_CSV_BYTES = 2_000_000;

/**
 * Upper bound on rows when the entity creates a User.
 *
 * Much lower than MAX_IMPORT_ROWS, and the reason is measured rather than
 * guessed: bcrypt at the project's cost factor takes ~520ms per hash on this
 * hardware, and every imported person needs one. 200 rows is therefore about
 * 105 seconds of hashing — already a long request. 2000 would be seventeen
 * minutes and would simply time out.
 *
 * Not a business rule: the PRD states no limit. It is the point past which the
 * request stops completing, made explicit and reported in the error so an
 * operator splits the file instead of watching an import hang.
 *
 * The hashing happens BEFORE the transaction opens, so a slow import holds no
 * database locks while it runs.
 */
export const MAX_PERSON_IMPORT_ROWS = 200;

/**
 * Body schema for POST /api/platform/tenants/[id]/import.
 *
 * `mode` is what separates the two halves of §55 Stage 3: "preview" performs
 * every check and writes NOTHING ("Test imports"), "commit" performs the same
 * checks and then writes in one transaction ("Final migration"). One endpoint
 * with one code path, so a preview can never disagree with the import that
 * follows it.
 *
 * The tenant is NOT in this body. It comes from the route segment, which is
 * the whole of "never trust a tenantId from the CSV or the client": there is no
 * key here to supply one through.
 */
export const importRequestSchema = z
  .object({
    entity: z.enum(IMPORT_ENTITY_KEYS as [string, ...string[]]),
    csv: z.string().min(1).max(MAX_CSV_BYTES),
    mode: z.enum(["preview", "commit"]),
  })
  .strict();

export type ImportRequestInput = z.infer<typeof importRequestSchema>;

/**
 * A blank cell means "not supplied".
 *
 * Applied before every optional field so an empty column falls through to the
 * model's own default. Without it, `credits` = "" would fail a number check on
 * a row the operator never intended to fill in.
 */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/** A required text cell. Trimmed, because trailing spaces in CSV are invisible. */
const requiredText = (max: number) => z.string().trim().min(1).max(max);

/** An optional text cell. */
const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().min(1).max(max).optional());

/**
 * An optional whole number from a cell.
 *
 * Rejects a fractional or non-numeric value rather than truncating it —
 * silently turning "3.5 credits" into 3 is a data-corruption bug that nobody
 * would ever notice.
 */
const optionalInt = (min: number, max: number) =>
  z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(min).max(max).optional()
  );

const requiredInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

/** An optional enum cell, upper-cased so "core" and "CORE" both parse. */
const optionalEnum = <T extends Record<string, string>>(values: T) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() !== "" ? value.trim().toUpperCase() : undefined,
    z.enum(values).optional()
  );

/**
 * Row schema for the Course entity.
 *
 * Mirrors the writable scalars of Prisma model Course. `tenantId` is absent by
 * construction — it comes from the route. `departmentCode` is a LOOKUP key, not
 * a column: the service resolves it to a departmentId within this tenant, so a
 * CSV can never attach a course to another university's department.
 */
export const courseRowSchema = z
  .object({
    code: requiredText(32),
    name: requiredText(200),
    type: optionalEnum(CourseType),
    credits: optionalInt(0, 100),
    departmentCode: optionalText(32),
    description: optionalText(2000),
  })
  .strict();

export type CourseRow = z.infer<typeof courseRowSchema>;

/**
 * Row schema for the Programme entity.
 *
 * `departmentCode` is REQUIRED here and optional on Course, because
 * Programme.departmentId is NOT NULL in the schema while Course.departmentId is
 * nullable. The difference is the model's, not a policy choice.
 */
export const programmeRowSchema = z
  .object({
    code: requiredText(32),
    name: requiredText(200),
    departmentCode: requiredText(32),
    type: optionalEnum(ProgrammeType),
    durationValue: requiredInt(1, 120),
    durationUnit: optionalEnum(DurationUnit),
    totalCredits: optionalInt(0, 1000),
    eligibility: optionalText(2000),
  })
  .strict();

export type ProgrammeRow = z.infer<typeof programmeRowSchema>;

/**
 * A date cell.
 *
 * Coerced from the ISO text a spreadsheet exports. Rejected rather than
 * defaulted when unparseable — a student silently admitted on 1970-01-01 is the
 * kind of wrong that survives for years (see TD-002 on z.coerce.date()).
 */
const requiredDate = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Not a date. Use YYYY-MM-DD.",
  })
  .transform((value) => new Date(value));

/**
 * Row schema for the Student entity.
 *
 * Mirrors the writable scalars of Prisma model Student, plus the three User
 * columns a Student cannot exist without. `password` is NOT a field here and
 * the schema is strict, so a file supplying one is refused with 400 — the
 * approved policy is a generated credential, never a caller-chosen one.
 *
 * `enrollmentNo` is optional because POST /api/students already treats it that
 * way: supplied, it is preserved; omitted, PRD §9's identifier engine issues
 * one. `programmeCode` is a LOOKUP, resolved within this tenant.
 */
export const studentRowSchema = z
  .object({
    firstName: requiredText(100),
    lastName: requiredText(100),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    phone: optionalText(32),
    admissionDate: requiredDate,
    enrollmentNo: optionalText(64),
    programmeCode: optionalText(32),
    currentSemester: optionalInt(1, 20),
    status: optionalEnum(StudentStatus),
  })
  .strict();

export type StudentRow = z.infer<typeof studentRowSchema>;

/**
 * Row schema for the FacultyMember entity.
 *
 * A separate entity from Employee, as instructed and as the schema models it:
 * FacultyMember and Employee are distinct tables with their own
 * @@unique([tenantId, employeeId]).
 */
export const facultyRowSchema = z
  .object({
    firstName: requiredText(100),
    lastName: requiredText(100),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    phone: optionalText(32),
    joinDate: requiredDate,
    employeeId: optionalText(64),
    departmentCode: optionalText(32),
    designation: optionalText(100),
    qualification: optionalText(200),
    specialization: optionalText(200),
    experience: optionalInt(0, 80),
    status: optionalEnum(EmployeeStatus),
  })
  .strict();

export type FacultyRow = z.infer<typeof facultyRowSchema>;

/** Row schema for the Employee entity. Employee.departmentId has no relation. */
export const employeeRowSchema = z
  .object({
    firstName: requiredText(100),
    lastName: requiredText(100),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    phone: optionalText(32),
    joinDate: requiredDate,
    employeeId: optionalText(64),
    departmentCode: optionalText(32),
    designation: optionalText(100),
    type: optionalEnum(EmployeeType),
    status: optionalEnum(EmployeeStatus),
  })
  .strict();

export type EmployeeRow = z.infer<typeof employeeRowSchema>;

/** The row schema for an entity key. */
export const ROW_SCHEMAS: Record<string, z.ZodType> = {
  course: courseRowSchema,
  programme: programmeRowSchema,
  student: studentRowSchema,
  faculty: facultyRowSchema,
  employee: employeeRowSchema,
};
