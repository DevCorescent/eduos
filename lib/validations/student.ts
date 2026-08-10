// ============================================================================
// OWNER  : Gauransh
// MODULE : Students — Student, Personal and Document Validation
// FLOW   : Validates listing queries, route params, creation bodies and update
//          bodies for the student record, its personal detail and its documents
//          before any of them reach the database.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: Keep student-domain request validation declarative and in one place,
//          matching the existing per-module validation convention.
// ============================================================================

import { z } from "zod";
import { BloodGroup, DocumentType, Gender, StudentStatus } from "@/app/generated/prisma/client";
import { paginationQuerySchema } from "./pagination";

// ─────────────────────────────────────────────
// STUDENT
// ─────────────────────────────────────────────

/**
 * Query schema for GET /api/students.
 *
 * Pagination is the shared contract. No search or filter parameter is defined:
 * the project implements none on any existing collection endpoint, so adding
 * one here would introduce a capability the rest of the API does not have.
 */
export const listStudentsQuerySchema = paginationQuerySchema;

export type ListStudentsQuery = z.infer<typeof listStudentsQuerySchema>;

/**
 * Route param schema for /api/students/[id] and its nested routes.
 *
 * Student.id is a cuid, not a UUID, so no UUID assertion is applied — it would
 * reject every legitimate id. The value is an opaque key, and an
 * unrecognised-but-well-formed one is a 404 rather than a 400. Only an empty or
 * whitespace-only segment is rejected outright.
 */
export const studentIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

export type StudentIdParam = z.infer<typeof studentIdParamSchema>;

/**
 * Body schema for POST /api/students.
 *
 * Mirrors the writable scalar columns of the Student model. userId,
 * enrollmentNo and admissionDate are required; the remaining columns are
 * nullable or carry a schema default (currentSemester 1, status ACTIVE), so an
 * omitted key lets the database default apply.
 *
 * tenantId is intentionally absent: the tenant is derived from the validated
 * request context by requireTenant, never accepted from the client, so a
 * student cannot be created against another tenant.
 *
 * Every id below is validated here only for shape. That each referenced row
 * exists AND belongs to the authenticated tenant is enforced against the
 * database in the route. That check is not optional for programmeId in
 * particular: unlike batchId, sectionId and specialisationId, Student.programmeId
 * carries no relation and no foreign key in the schema, so the database will
 * accept any string at all in that column — another tenant's programme id
 * included. The route is the only thing standing between a client and an
 * arbitrary value there.
 *
 * currentSemester is checked as an integer only. The schema declares it a plain
 * Int with no check constraint, so no range is imposed: rejecting a value the
 * database would accept would be a rule neither the schema nor the README
 * states.
 *
 * enrollmentNo is supplied by the client. The schema contains an IdSequence
 * model that could generate one, but neither the README nor the PRD wires it to
 * student admission, so no generation is performed here.
 */
export const createStudentSchema = z.object({
  userId: z.string().trim().min(1),
  /**
   * Optional since WP-1: omitted, the identifier engine issues it from the
   * institution's configured sequence (PRD §9). Supplied, the value is used
   * as given, which is what keeps legacy imports and institutions without a
   * configured sequence working exactly as before.
   */
  enrollmentNo: z.string().trim().min(1).optional(),
  programmeId: z.string().trim().min(1).optional(),
  batchId: z.string().trim().min(1).optional(),
  sectionId: z.string().trim().min(1).optional(),
  specialisationId: z.string().trim().min(1).optional(),
  currentSemester: z.number().int().optional(),
  status: z.enum(StudentStatus).optional(),
  admissionDate: z.coerce.date(),
  graduationDate: z.coerce.date().optional(),
});

export type CreateStudentInput = z.infer<typeof createStudentSchema>;

/**
 * Body schema for PATCH /api/students/[id].
 *
 * Derived from createStudentSchema rather than restated, so the enum
 * membership, date coercion and trimming rules stay defined in one place and
 * cannot drift apart.
 *
 * tenantId is absent from the create schema, so .partial() cannot introduce it
 * — a student can never be moved between tenants through this endpoint.
 *
 * userId is omitted before the schema is made partial, so a student record
 * stays permanently bound to the User it was created against. Re-pointing one
 * at a different person is an account transfer, not a profile edit, and no such
 * feature is described in the schema or the README.
 *
 * Every key is optional, but at least one must be present: an empty body is a
 * client error, not a silent no-op that would still advance updatedAt.
 *
 * As elsewhere, omitting a key leaves the column unchanged; there is no way to
 * clear a nullable column back to null through this endpoint.
 */
export const updateStudentSchema = createStudentSchema
  .omit({ userId: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0);

export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

// ─────────────────────────────────────────────
// STUDENT PERSONAL
// ─────────────────────────────────────────────

/**
 * Body schema for PUT /api/students/[id]/personal.
 *
 * Mirrors the writable scalar columns of the StudentPersonal model, all of
 * which are nullable except disability, which carries a schema default of
 * false. The record is one-to-one with a student via studentId @unique, so the
 * route upserts rather than requiring a separate create step.
 *
 * studentId is intentionally absent: it comes from the route parameter, so a
 * personal record can never be attached to a student other than the one
 * addressed by the URL.
 *
 * At least one key must be present, matching the update convention used
 * throughout the project: an empty body is a client error rather than a write
 * that only advances updatedAt.
 *
 * The three address-shaped columns are Json in the schema and no shape is
 * defined for them anywhere, so none is imposed here.
 */
export const upsertStudentPersonalSchema = z
  .object({
    dateOfBirth: z.coerce.date().optional(),
    gender: z.enum(Gender).optional(),
    bloodGroup: z.enum(BloodGroup).optional(),
    nationality: z.string().trim().min(1).optional(),
    religion: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1).optional(),
    motherTongue: z.string().trim().min(1).optional(),
    permanentAddr: z.record(z.string(), z.unknown()).optional(),
    localAddr: z.record(z.string(), z.unknown()).optional(),
    emergencyContact: z.record(z.string(), z.unknown()).optional(),
    disability: z.boolean().optional(),
    disabilityDesc: z.string().trim().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0);

export type UpsertStudentPersonalInput = z.infer<typeof upsertStudentPersonalSchema>;

// ─────────────────────────────────────────────
// STUDENT DOCUMENTS
// ─────────────────────────────────────────────

/** Query schema for GET /api/students/[id]/documents. */
export const listStudentDocumentsQuerySchema = paginationQuerySchema;

export type ListStudentDocumentsQuery = z.infer<typeof listStudentDocumentsQuerySchema>;

/**
 * Route param schema for /api/students/[id]/documents/[docId].
 *
 * Same reasoning as studentIdParamSchema: the value is an opaque cuid, so only
 * an empty or whitespace-only segment is rejected.
 */
export const documentIdParamSchema = z.object({
  docId: z.string().trim().min(1),
});

export type DocumentIdParam = z.infer<typeof documentIdParamSchema>;

/**
 * Body schema for POST /api/students/[id]/documents.
 *
 * Mirrors the writable scalar columns of the StudentDocument model. type,
 * fileName and fileUrl are required; fileSize and mimeType are nullable.
 *
 * Four fields are deliberately absent so a client cannot supply them:
 *  - studentId, which comes from the route parameter.
 *  - isVerified, verifiedBy and verifiedAt, which together record that a
 *    document has actually been checked by a person. They are server-managed
 *    trust fields in the same sense as User.isVerified: accepting them would
 *    let an uploader mark their own document verified.
 *
 * uploadedAt is likewise absent — it carries a schema default and records when
 * the upload happened, not a value the uploader chooses.
 *
 * Note that StudentDocument has no tenantId column of its own. It is reachable
 * only through its student, which is why the route must resolve and
 * tenant-check that student before touching any document.
 *
 * fileSize is checked as an integer only; the schema declares it a plain Int?
 * with no check constraint.
 */
export const createStudentDocumentSchema = z.object({
  type: z.enum(DocumentType),
  fileName: z.string().trim().min(1),
  fileUrl: z.url(),
  fileSize: z.number().int().optional(),
  mimeType: z.string().trim().min(1).optional(),
});

export type CreateStudentDocumentInput = z.infer<typeof createStudentDocumentSchema>;
