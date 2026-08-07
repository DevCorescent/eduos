// ============================================================================
// OWNER  : Gauransh
// MODULE : Faculty Profile & Performance Analytics (Phase 23)
// LAYER  : Validation
// PURPOSE: The request contracts for the five Phase 23 endpoints.
//
// THE PATCH SCHEMA IS .strict() AND OMITS EVERY IDENTITY COLUMN
//   `id`, `tenantId`, `userId`, `employeeId`, `departmentId` and `status` are
//   all ABSENT. A faculty member editing their own profile must not be able to
//   move themselves to another department, change their employee number, or
//   reactivate a terminated record — those are Phase 7 administrative
//   operations with their own route (PATCH /api/faculty/[id]), and this
//   endpoint deliberately does not duplicate them.
//
//   Being .strict() rather than stripping means the attempt is a 400. A client
//   that believes it changed a department and is silently ignored will keep
//   believing it.
//
// THE CHILD COLLECTIONS ARE REPLACED WHOLESALE, AND SAY SO
//   `publications`, `certifications` and `education` each replace the entire
//   set when supplied, and are left untouched when omitted. TD-C13 records the
//   data-loss path a partial merge creates when a client resends one item of a
//   collection; making replacement explicit and total means a caller either
//   sends the whole list or sends nothing, and neither outcome is a surprise.
// ============================================================================

import { z } from "zod";
import { identifier } from "@/lib/validations/shared";

/** A route param naming a faculty member. */
export const facultyIdParamSchema = z.object({ facultyId: identifier });

export type FacultyIdParam = z.infer<typeof facultyIdParamSchema>;

/**
 * A stored location, never bytes.
 *
 * `z.url()` rather than a bare string: TD-C21 records that Certificate.pdfUrl
 * accepts any value including a `javascript:` URI, and any UI rendering it as a
 * link inherits an unvalidated-redirect surface. This phase does not repeat
 * that — a photo and a publication link are both rendered as links.
 */
const storedUrl = z.url().max(2048);

/** A four-digit academic year. Bounded so a typo is a 400, not a 3021 degree. */
const academicYearNumber = z.number().int().min(1900).max(2200);

const publicationInput = z
  .object({
    title: z.string().trim().min(1).max(500),
    publisher: z.string().trim().min(1).max(300).nullish(),
    identifier: z.string().trim().min(1).max(200).nullish(),
    url: storedUrl.nullish(),
    publishedOn: z.iso.date().nullish(),
  })
  .strict();

const certificationInput = z
  .object({
    name: z.string().trim().min(1).max(300),
    issuer: z.string().trim().min(1).max(300).nullish(),
    url: storedUrl.nullish(),
    issuedOn: z.iso.date().nullish(),
    expiresOn: z.iso.date().nullish(),
  })
  .strict();

const educationInput = z
  .object({
    degree: z.string().trim().min(1).max(200),
    institution: z.string().trim().min(1).max(300),
    fieldOfStudy: z.string().trim().min(1).max(200).nullish(),
    startYear: academicYearNumber.nullish(),
    endYear: academicYearNumber.nullish(),
    grade: z.string().trim().min(1).max(100).nullish(),
  })
  .strict()
  .refine(
    (value) =>
      value.startYear == null || value.endYear == null || value.startYear <= value.endYear,
    { message: "startYear must not be after endYear", path: ["endYear"] }
  );

/**
 * PATCH /api/faculty/profile/[facultyId]
 *
 * Every field optional — this is a partial update. An empty body is accepted
 * and changes nothing rather than being a 400: a no-op PATCH is idempotent and
 * harmless, and rejecting it would make a form that submits only dirty fields
 * fail on the one occasion nothing was edited.
 */
export const updateFacultyProfileSchema = z
  .object({
    photoUrl: storedUrl.nullish(),
    designation: z.string().trim().min(1).max(200).nullish(),
    qualification: z.string().trim().min(1).max(300).nullish(),
    specialization: z.string().trim().min(1).max(300).nullish(),
    /**
     * Years of experience. Bounded above at 80 — a career longer than that is a
     * typo, and an unbounded Int would let 99999 through into a profile card.
     */
    experience: z.number().int().min(0).max(80).nullish(),

    publications: z.array(publicationInput).max(200).optional(),
    certifications: z.array(certificationInput).max(200).optional(),
    education: z.array(educationInput).max(50).optional(),
  })
  .strict();

export type UpdateFacultyProfileInput = z.infer<typeof updateFacultyProfileSchema>;

/**
 * GET /api/faculty/workload/[facultyId] and the two analytics endpoints.
 *
 * `semesterId` narrows every figure to one semester. Omitted, the figures cover
 * everything the member has ever taught — which is the honest default, since
 * inventing a "current semester" would mean picking one and the schema marks
 * more than one semester current in different academic years.
 */
export const facultyScopeQuerySchema = z
  .object({
    semesterId: identifier.optional(),
  })
  .strict();

export type FacultyScopeQuery = z.infer<typeof facultyScopeQuerySchema>;

/** GET /api/faculty/profile/[facultyId]. No filters — a profile is whole. */
export const facultyProfileQuerySchema = z.object({}).strict();

export type FacultyProfileQuery = z.infer<typeof facultyProfileQuerySchema>;
