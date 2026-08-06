// ============================================================================
// OWNER  : Gauransh
// MODULE : Course Registration
// LAYER  : Validation
// PURPOSE: Shape and bounds for every registration request, applied before the
//          controller is reached and before any database work is done.
//
// WHAT IS ENFORCED HERE AND WHAT IS NOT
//   Here : field shape, enum membership, batch size, and that a batch names no
//          student twice — all decidable from the request body alone.
//   Not  : every academic rule. Whether the student, course, semester, section
//          and scheme exist in this tenant; whether the scheme is ACTIVE;
//          whether an active enrolment already exists; which attempt number
//          this is; and whether the registration TYPE is coherent with that
//          attempt. Not one of those is knowable from a body, and the last is
//          the clearest case — the attempt number is assigned by the server
//          from stored state, so a schema could not check the type against it
//          even in principle.
//
// WHAT IS DELIBERATELY NOT ACCEPTED
//   attemptNumber, credits, programmeId and status are absent from every schema
//   below. They are the snapshots and the lifecycle: a client able to set
//   attemptNumber could fork a student's attempt history, and one able to set
//   credits could inflate their own GPA weight.
// ============================================================================

import { z } from "zod";
import { RegistrationStatus, RegistrationType } from "@/app/generated/prisma/client";
import { MAX_BULK_REGISTRATIONS } from "@/lib/constants/courseRegistration";
import { paginationQuerySchema } from "@/lib/validations/pagination";
import { identifier } from "@/lib/validations/shared";

/**
 * The references an enrolment is created against.
 *
 * `evaluationSchemeId` is REQUIRED rather than derived. Until a scheme-to-course
 * binding exists, nothing in the schema can answer "which regulation governs
 * this course", so the caller names it and the registration then pins it
 * immutably. When that binding arrives, this becomes optional with the binding
 * as its default — an additive change, because a supplied value would still
 * win.
 */
const registrationReferences = z.object({
  courseId: identifier,
  semesterId: identifier,
  sectionId: identifier.nullable().optional(),
  evaluationSchemeId: identifier,
  registrationType: z.enum(RegistrationType).optional(),
});

/**
 * Body schema for POST /api/course-registrations.
 *
 * Registers ONE student. The attempt number is not accepted: the service reads
 * the student's existing attempts at this course and assigns the next one, so a
 * backlog registered two years later is attempt 2 without the caller having to
 * know that.
 */
export const createCourseRegistrationSchema = registrationReferences.extend({
  studentId: identifier,
});

export type CreateCourseRegistrationInput = z.infer<typeof createCourseRegistrationSchema>;

/**
 * Body schema for POST /api/course-registrations/bulk.
 *
 * Registers a cohort against one course. The shared references are named once
 * rather than repeated per student, which is both the natural shape of the
 * operation and what lets the service resolve them a single time for the whole
 * batch instead of once per student.
 *
 * The duplicate check is here rather than in the service because it needs
 * nothing but the body. Silently de-duplicating would be worse than rejecting:
 * a caller who sent the same student twice has a bug, and returning success
 * would hide it.
 */
export const bulkCourseRegistrationSchema = registrationReferences.extend({
  studentIds: z
    .array(identifier)
    .min(1)
    .max(MAX_BULK_REGISTRATIONS)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "The same student appears more than once in this batch",
    }),
});

export type BulkCourseRegistrationInput = z.infer<typeof bulkCourseRegistrationSchema>;

/**
 * Body schema for PATCH /api/course-registrations/[id].
 *
 * Only TWO things may change after registration, and the narrowness is the
 * point:
 *
 *   sectionId — a student may be moved between teaching groups without their
 *               enrolment changing. The roster is (courseId, semesterId); this
 *               only narrows it.
 *   status    — the lifecycle. Which transitions are legal is a rule about the
 *               STORED state, so the state machine is enforced in the service.
 *
 * Everything else — student, course, semester, programme, credits, evaluation
 * scheme, attempt number — is absent and therefore unpatchable. Those are the
 * immutable academic facts this model exists to preserve; a registration whose
 * scheme could be edited would make every result computed under it
 * irreproducible.
 *
 * At least one key must be present: an empty body is a client error, not a
 * silent no-op that would still advance updatedAt.
 */
export const updateCourseRegistrationSchema = z
  .object({
    sectionId: identifier.nullable().optional(),
    status: z.enum(RegistrationStatus).optional(),
  })
  .refine((data) => Object.keys(data).length > 0);

export type UpdateCourseRegistrationInput = z.infer<typeof updateCourseRegistrationSchema>;

/**
 * Query schema for GET /api/course-registrations.
 *
 * Extends the shared pagination contract rather than restating it. Every filter
 * is optional and they are ANDed by the service.
 *
 * The two that matter are index-backed: `semesterId` + `courseId` ride
 * @@index([tenantId, semesterId, courseId]), which is the roster read, and
 * `studentId` rides the leading column of
 * @@unique([studentId, courseId, attemptNumber]). `sectionId`, `status` and
 * `registrationType` narrow an already-bounded set — a class roster or one
 * student's history — so they cost a filter rather than a scan.
 *
 * No free-text search parameter is offered: it would be a sequential scan over
 * what will be the largest table in the phase, wearing the costume of a filter.
 */
export const listCourseRegistrationsQuerySchema = paginationQuerySchema.extend({
  studentId: identifier.optional(),
  courseId: identifier.optional(),
  semesterId: identifier.optional(),
  sectionId: identifier.optional(),
  status: z.enum(RegistrationStatus).optional(),
  registrationType: z.enum(RegistrationType).optional(),
});

export type ListCourseRegistrationsQuery = z.infer<typeof listCourseRegistrationsQuerySchema>;

/** Route param schema for /api/course-registrations/[id]. */
export const courseRegistrationParamSchema = z.object({
  id: identifier,
});

export type CourseRegistrationParam = z.infer<typeof courseRegistrationParamSchema>;
