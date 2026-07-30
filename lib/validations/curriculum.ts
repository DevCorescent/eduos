// ============================================================================
// OWNER  : Gauransh
// MODULE : Curriculum — Curriculum & Subject Validation
// FLOW   : Validates the curriculum listing query, route params, curriculum
//          creation body and subject creation body before any of them reach the
//          database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Keep curriculum request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

/**
 * Query schema for GET /api/curricula.
 *
 * Pagination is the shared contract. No search or filter parameter is defined:
 * the project implements none on any existing collection endpoint. In particular
 * there is no ?programmeId and no ?isActive filter, so every curriculum in the
 * tenant lists together and the client reads the flags.
 */
export const curriculumQuerySchema = paginationQuerySchema;

export type CurriculumQuery = z.infer<typeof curriculumQuerySchema>;

/**
 * Route param schema for /api/curricula/[id].
 *
 * Curriculum.id is a cuid, not a UUID, so no UUID assertion is applied — it
 * would reject every legitimate id. The value is an opaque key, and an
 * unrecognised-but-well-formed one is a 404 rather than a 400. Only an empty or
 * whitespace-only segment is rejected outright.
 */
export const curriculumIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type CurriculumIdParam = z.infer<typeof curriculumIdParamSchema>;

/**
 * Route param schema for the [subjectId] segment of
 * /api/curricula/[id]/subjects/[subjectId].
 *
 * Declared separately from curriculumIdParamSchema rather than as a combined
 * two-key object, matching documentIdParamSchema in the student module. A plain
 * z.object() strips unknown keys, so parsing the full { id, subjectId } params
 * object against either schema yields just that schema's segment.
 *
 * Same reasoning as above: the value is an opaque cuid, so only an empty or
 * whitespace-only segment is rejected.
 */
export const curriculumSubjectIdParamSchema = z.object({
  subjectId: z.string().trim().min(1),
});

export type CurriculumSubjectIdParam = z.infer<typeof curriculumSubjectIdParamSchema>;

/**
 * Body schema for POST /api/curricula.
 *
 * Mirrors the writable scalar columns of the Curriculum model, in column order.
 * programmeId, name, version and effectiveFrom are required — effectiveFrom is a
 * DateTime with no default in the schema, so it cannot be omitted — and isActive
 * carries a schema default (true), so an omitted key lets the database default
 * apply.
 *
 * tenantId is intentionally absent, along with id, createdAt and updatedAt: the
 * tenant is derived from the validated request context by requireTenant, never
 * accepted from the client, so a curriculum cannot be created against another
 * tenant.
 *
 * programmeId is validated here only for shape. That the referenced programme
 * exists AND belongs to the authenticated tenant is enforced against the database
 * in the route. Curriculum.programmeId does carry a foreign key, but a foreign key
 * proves existence rather than ownership, so the tenant-scoped lookup is still
 * required — and Curriculum.tenantId itself carries no foreign key at all, so
 * nothing in the database ties the two together.
 *
 * @@unique([programmeId, version]) is the only uniqueness rule on the model, and
 * it is the route's to pre-check. Note what it does not cover: name is not keyed,
 * so two curricula under one programme may share a name, and isActive is not
 * keyed either.
 *
 * Per the approved Phase 8 decisions, multiple curricula with isActive true are
 * permitted for the same programme. No current-flag rule is enforced here, unlike
 * AcademicYear and Semester in Phase 4 where exactly one current record was
 * specified — the schema declares no such constraint for Curriculum and none is
 * invented.
 */
export const createCurriculumSchema = z.object({
  programmeId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  version: z.string().trim().min(1),
  effectiveFrom: z.coerce.date(),
  isActive: z.boolean().optional(),
});

export type CreateCurriculumInput = z.infer<typeof createCurriculumSchema>;

// No update schema is declared. The README defines GET and POST for
// /api/curricula and GET only for /api/curricula/[id] — there is no PATCH or
// DELETE for a curriculum anywhere in the phase, so an update schema would be
// unreachable code.

/**
 * Body schema for POST /api/curricula/[id]/subjects.
 *
 * Mirrors the writable scalar columns of the CurriculumSubject model, with two
 * deliberate exclusions.
 *
 * curriculumId is absent: the [id] route segment is authoritative, so a body
 * cannot redirect the subject into a different curriculum. This matches the
 * convention already used for POST /api/programmes/[id]/specialisations.
 *
 * credits is absent, and this is a business rule rather than a shape decision.
 * Course.credits is authoritative; CurriculumSubject.credits is a historical
 * snapshot of it at the moment the subject was added. The server copies the value
 * from the referenced Course, so no writable credits field is exposed and a body
 * supplying one has it stripped rather than rejected. Note that
 * CurriculumSubject.credits is a required column with no schema default, so the
 * route must always supply the copied value explicitly — an omitted key would
 * fail at the database, not default to anything.
 *
 * courseId is validated here only for shape. That the referenced course exists
 * AND belongs to the same tenant as the curriculum is enforced against the
 * database in the route. The courseId foreign key proves existence only, so
 * without that lookup another tenant's course could be attached to this
 * curriculum — CurriculumSubject has no tenantId column of its own, so its tenant
 * is entirely inherited through the curriculum.
 *
 * semesterNumber, internalMarks and externalMarks follow the schema and nothing
 * else, per the approved Phase 8 decisions. semesterNumber is a plain integer and
 * is not compared against Programme.durationValue. internalMarks and
 * externalMarks are plain optional integers with no range, no required total and
 * no relationship to each other or to credits.
 *
 * No uniqueness validation beyond what @@unique([curriculumId, courseId,
 * semesterNumber]) expresses: the same course may appear more than once in one
 * curriculum provided the semesterNumber differs. All three keyed columns are NOT
 * NULL, so unlike the FacultyCourseAssignment constraint recorded as TD-001 this
 * composite index is fully enforceable by the database.
 */
export const createCurriculumSubjectSchema = z.object({
  courseId: z.string().trim().min(1),
  semesterNumber: z.number().int(),
  isCompulsory: z.boolean().optional(),
  internalMarks: z.number().int().optional(),
  externalMarks: z.number().int().optional(),
});

export type CreateCurriculumSubjectInput = z.infer<typeof createCurriculumSubjectSchema>;
