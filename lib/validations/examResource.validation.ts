// ============================================================================
// OWNER  : Gauransh
// MODULE : Question Paper & Solution Repository (Phase 26)
// LAYER  : Validation
// PURPOSE: The request contracts for the ten Phase 26 endpoints.
//
// THIS MODULE VALIDATES A LOCATION, NOT A FILE
//   No upload, R2 client, presigned-URL helper or multipart handler exists
//   anywhere in this repository — verified before this phase was written.
//   StudentDocument, Certificate.pdfUrl and AssignmentSubmission.attachments
//   all store a client-supplied URL, and the Phase 17 download route returns
//   JSON rather than bytes. `fileUrl` here follows that established precedent.
//
//   It IS validated as a URL, unlike Certificate.pdfUrl. TD-C21 records that
//   the certificate column accepts any value including a `javascript:` URI, and
//   that any UI rendering it as a link inherits an unvalidated-redirect
//   surface. A question paper is rendered as a download link to every student
//   on a course; this phase does not repeat that.
//
// STATUS IS ABSENT FROM EVERY BODY SCHEMA
//   Publication and archival have their own endpoints, which the README names
//   separately. Accepting `status` on create or update would give a second,
//   unaudited path to the one transition that changes what students can see.
// ============================================================================

import { z } from "zod";
import { ExamResourceStatus, ExamResourceType } from "@/app/generated/prisma/enums";
import { identifier } from "@/lib/validations/shared";
import {
  EXAM_RESOURCE_DEFAULT_LIMIT,
  EXAM_RESOURCE_MAX_LIMIT,
} from "@/lib/constants/examResource";

/**
 * A stored location.
 *
 * Bounded at 2048 characters — the practical URL limit — so an unbounded string
 * cannot be used to write an arbitrarily large value into a `text` column, the
 * concern TD-C03 records for unbounded template columns.
 */
const storedUrl = z.url().max(2048);

/**
 * An academic year as an institution writes it: "2024-25" or "2024".
 *
 * A string rather than a relation to AcademicYear, because the README's
 * "Previous Year Question Papers" must cover papers that predate the tenant's
 * own records entirely — a 2019 paper uploaded by a university onboarded in
 * 2026 has no AcademicYear row to point at.
 */
const academicYear = z
  .string()
  .trim()
  .regex(/^\d{4}(-\d{2,4})?$/, "Expected a year such as 2024 or 2024-25");

/** The [id] route segment. */
export const examResourceParamSchema = z.object({ id: identifier });

export type ExamResourceParam = z.infer<typeof examResourceParamSchema>;

/**
 * POST /api/exam-resources
 *
 * `departmentId` is ABSENT: it is denormalised from the course by the service
 * so the department repository read needs no join, and accepting it from a
 * client would let a resource be filed under a department its course does not
 * belong to.
 *
 * `isVerified`, `verifiedById`, `verifiedAt`, `publishedAt` and `archivedAt`
 * are likewise absent — every one is written by a named transition endpoint.
 */
export const createExamResourceSchema = z
  .object({
    courseId: identifier,
    semesterId: identifier,
    examinationId: identifier.optional(),
    type: z.enum(ExamResourceType),
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().min(1).max(2000).optional(),
    academicYear: academicYear.optional(),
    fileName: z.string().trim().min(1).max(300),
    fileUrl: storedUrl,
    fileSize: z.number().int().min(0).max(2_147_483_647).optional(),
    mimeType: z.string().trim().min(1).max(200).optional(),
    /**
     * The README's "Schedule Publish".
     *
     * Accepted on CREATE so a faculty member can set the release moment in the
     * same action that uploads the paper. It has no effect until the resource
     * is published — see lib/domain/exam-resources/visibility.ts.
     */
    scheduledPublishAt: z.iso.datetime().optional(),
  })
  .strict();

export type CreateExamResourceInput = z.infer<typeof createExamResourceSchema>;

/**
 * PATCH /api/exam-resources/[id]
 *
 * Every field optional. courseId and semesterId are ABSENT: moving a resource
 * to a different course would change which students can see it, which is a
 * re-filing rather than an edit and has no endpoint in the README.
 *
 * `.refine` rejects an empty body, because an update with no fields would be a
 * silent no-op that still advanced `updatedAt` — the same reasoning Phase 10's
 * updateAssignmentSchema applies.
 */
export const updateExamResourceSchema = z
  .object({
    type: z.enum(ExamResourceType).optional(),
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().min(1).max(2000).nullish(),
    academicYear: academicYear.nullish(),
    fileName: z.string().trim().min(1).max(300).optional(),
    fileUrl: storedUrl.optional(),
    fileSize: z.number().int().min(0).max(2_147_483_647).nullish(),
    mimeType: z.string().trim().min(1).max(200).nullish(),
    scheduledPublishAt: z.iso.datetime().nullish(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be supplied",
  });

export type UpdateExamResourceInput = z.infer<typeof updateExamResourceSchema>;

/**
 * PATCH /api/exam-resources/[id]/publish
 *
 * `isVerified` is accepted HERE and nowhere else, because the README gives an
 * HOD "Verify Uploads" and "Publish/Unpublish" as capabilities of the same
 * role. Supplying it is optional: publishing without verifying is legitimate,
 * and verification is reported alongside a resource rather than gating it.
 */
export const publishExamResourceSchema = z
  .object({
    scheduledPublishAt: z.iso.datetime().nullish(),
    isVerified: z.boolean().optional(),
  })
  .strict();

export type PublishExamResourceInput = z.infer<typeof publishExamResourceSchema>;

/** PATCH /api/exam-resources/[id]/archive. No body fields; a reason has no column. */
export const archiveExamResourceSchema = z.object({}).strict();

export type ArchiveExamResourceInput = z.infer<typeof archiveExamResourceSchema>;

/**
 * GET /api/exam-resources — the staff repository.
 *
 * `q` is the README's "Resource Search". Applied to the title and description
 * only: searching a file URL would match storage paths a reader never sees.
 */
export const examResourceListQuerySchema = z
  .object({
    courseId: identifier.optional(),
    semesterId: identifier.optional(),
    departmentId: identifier.optional(),
    examinationId: identifier.optional(),
    type: z.enum(ExamResourceType).optional(),
    status: z.enum(ExamResourceStatus).optional(),
    academicYear: academicYear.optional(),
    isVerified: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    q: z.string().trim().min(1).max(200).optional(),
    /** Restrict to the caller's own uploads. */
    mine: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(EXAM_RESOURCE_MAX_LIMIT)
      .default(EXAM_RESOURCE_DEFAULT_LIMIT),
  })
  .strict();

export type ExamResourceListQuery = z.infer<typeof examResourceListQuerySchema>;

/**
 * GET /api/students/me/exam-resources — the student repository.
 *
 * NO `status` FILTER, deliberately. A student sees published-and-due resources
 * and nothing else; offering the parameter would imply a draft could be
 * requested. NO `mine` either — a student uploads nothing.
 */
export const studentExamResourceQuerySchema = z
  .object({
    courseId: identifier.optional(),
    semesterId: identifier.optional(),
    type: z.enum(ExamResourceType).optional(),
    academicYear: academicYear.optional(),
    q: z.string().trim().min(1).max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(EXAM_RESOURCE_MAX_LIMIT)
      .default(EXAM_RESOURCE_DEFAULT_LIMIT),
  })
  .strict();

export type StudentExamResourceQuery = z.infer<typeof studentExamResourceQuerySchema>;
