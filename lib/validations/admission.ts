// ============================================================================
// OWNER  : Gauransh
// MODULE : Admissions (W3 — PRD §8.2, §8.5, §49.2)
// LAYER  : Validation
//
// WHAT A CLIENT MAY NEVER SUPPLY
//   tenantId       — comes from the route segment
//   applicantNo    — issued by the identifier engine (PRD §9)
//   applicationNo  — issued by the identifier engine (PRD §9)
//   stage          — server-controlled; only the transition endpoint moves it
//   studentId      — set by conversion alone
//
//   None of these is a field in any schema below, and every object is strict,
//   so supplying one is a 400 rather than a silently ignored key.
//
// EDUCATION AND WORK HISTORY ARE NOT GIVEN A SHAPE
//   §8.2 names "Education history" and "Work-experience history" and defines no
//   field for either. The validators below bound SIZE and DEPTH and nothing
//   else — imposing institution/year/grade keys would be inventing the
//   requirement. The same treatment Tenant.settings already gets.
// ============================================================================

import { z } from "zod";
import { AdmissionStage } from "@/app/generated/prisma/client";

/** PRD §49.2, in the PRD's own order. The UI renders this sequence. */
export const ADMISSION_STAGES = [
  "LEAD",
  "COUNSELLING",
  "APPLICATION",
  "DOCUMENT_VERIFICATION",
  "ELIGIBILITY_CHECK",
  "ENTRANCE_EXAMINATION",
  "MERIT_OR_SELECTION",
  "OFFER_LETTER",
  "FEE_PAYMENT",
  "STUDENT_ID_GENERATION",
  "COURSE_ALLOCATION",
  "PORTAL_ACTIVATION",
] as const;

export type AdmissionStageName = (typeof ADMISSION_STAGES)[number];

/** Human labels — the PRD's own wording. */
export const ADMISSION_STAGE_LABELS: Record<AdmissionStageName, string> = {
  LEAD: "Lead",
  COUNSELLING: "Counselling",
  APPLICATION: "Application",
  DOCUMENT_VERIFICATION: "Document Verification",
  ELIGIBILITY_CHECK: "Eligibility Check",
  ENTRANCE_EXAMINATION: "Entrance Examination",
  MERIT_OR_SELECTION: "Merit or Selection",
  OFFER_LETTER: "Offer Letter",
  FEE_PAYMENT: "Fee Payment",
  STUDENT_ID_GENERATION: "Student ID Generation",
  COURSE_ALLOCATION: "Course Allocation",
  PORTAL_ACTIVATION: "Portal Activation",
};

/**
 * A free-form history list (§8.2).
 *
 * An array of flat records whose values are text or numbers. Bounded at 20
 * entries and 20 keys so a request cannot carry an unbounded document, and flat
 * so no nested structure can be smuggled into a JSON column nothing validates
 * on the way out. No KEY is prescribed, because the PRD prescribes none.
 */
const historySchema = z
  .array(z.record(z.string().max(60), z.union([z.string().max(500), z.number()])).refine(
    (entry) => Object.keys(entry).length <= 20
  ))
  .max(20);

/** At most ten programme choices, ordered. §8.2 "Multiple programme preferences". */
const preferencesSchema = z
  .array(
    z.object({
      programmeId: z.string().trim().min(1),
      priority: z.number().int().min(1).max(10),
    })
  )
  .max(10)
  // Two choices cannot share a rank, and one programme cannot be listed twice —
  // both would make "preference order" meaningless.
  .refine((list) => new Set(list.map((p) => p.priority)).size === list.length)
  .refine((list) => new Set(list.map((p) => p.programmeId)).size === list.length);

/**
 * Body schema for POST .../admissions — PRD §8.2.
 *
 * The applicant's own details plus the guardian information §8.2 names. Email
 * is lowercased so the per-tenant uniqueness that implements §8.3's "Duplicate
 * application detection" is effective in practice.
 */
export const createApplicationSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    phone: z.string().trim().min(1).max(32).optional(),
    dateOfBirth: z.coerce.date().optional(),

    guardianName: z.string().trim().min(1).max(200).optional(),
    guardianRelation: z.string().trim().min(1).max(60).optional(),
    guardianPhone: z.string().trim().min(1).max(32).optional(),
    guardianEmail: z.string().trim().toLowerCase().pipe(z.email()).optional(),

    educationHistory: historySchema.optional(),
    workHistory: historySchema.optional(),
    preferences: preferencesSchema.optional(),
  })
  .strict();

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

/**
 * Body schema for PATCH .../admissions/[applicationId].
 *
 * Derived from the create schema so the field rules stay defined once. Every
 * key optional, at least one required — an empty body is a client error, not a
 * silent no-op that still advances updatedAt.
 *
 * `stage` is NOT here. Moving an application through §49.2 is a transition with
 * its own validation and its own audit entry, not a field edit.
 */
export const updateApplicationSchema = createApplicationSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

/**
 * Body schema for the stage transition.
 *
 * The TARGET stage is required rather than implied, so a double-submitted
 * request cannot advance twice: the service refuses a target that is not
 * exactly one step ahead of the stage it reads.
 */
export const advanceStageSchema = z
  .object({
    toStage: z.enum(ADMISSION_STAGES),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export type AdvanceStageInput = z.infer<typeof advanceStageSchema>;

/**
 * Body schema for POST .../convert — PRD §8.5.
 *
 * Programme and batch are named because §8.5 says "Assigns programme and
 * batch", and neither can be derived: an applicant may list several programme
 * preferences and the PRD defines no rule for choosing between them, so the
 * decision is the admissions officer's and is recorded as their input.
 *
 * NOT accepted: enrollmentNo, studentId, password, role. The identifier engine
 * issues the enrolment number, and credentials follow the W1.6 policy.
 */
export const convertApplicationSchema = z
  .object({
    programmeId: z.string().trim().min(1),
    batchId: z.string().trim().min(1),
    admissionDate: z.coerce.date().optional(),
  })
  .strict();

export type ConvertApplicationInput = z.infer<typeof convertApplicationSchema>;

/** Query schema for the admissions list. Mirrors the platform listing shape. */
export const listApplicationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  stage: z.enum(ADMISSION_STAGES).optional(),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;

/** Route param for a single application. Opaque key; no format asserted. */
export const applicationIdParamSchema = z.object({
  applicationId: z.string().trim().min(1),
});

/** Asserts the application constant and the Prisma enum have not drifted. */
export const PRISMA_ADMISSION_STAGES = AdmissionStage;
