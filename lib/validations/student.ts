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
 * A filter value that may legitimately arrive empty.
 *
 * The same definition the setup collections use (see campus.ts and
 * department.ts). The filter controls remove their key from the URL when reset
 * to "All programmes"/"All batches", but a hand-edited or bookmarked
 * "?batchId=" must mean "no filter" rather than answer 400.
 *
 * NO FORMAT ASSERTION on the ids: they are opaque foreign keys, and an id
 * naming nothing — or naming another tenant's row — simply matches no students,
 * because the tenant predicate is ANDed alongside it in the route.
 */
const optionalFilter = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value === undefined || value === "" ? undefined : value));

/**
 * Query schema for GET /api/students.
 *
 * Pagination is the shared contract, extended with EXACTLY the four parameters
 * the Students screen already sends — ?q, ?status, ?programmeId and ?batchId.
 * No fifth filter is added: sectionId, specialisationId and currentSemester are
 * columns on Student, but no control offers them and inventing one here would
 * be a capability nothing asked for.
 *
 * WHAT ?q SEARCHES
 *   The screen's own placeholder is "Search by name or enrolment number", so it
 *   is enrollmentNo plus the related User's firstName, lastName and email. A
 *   student's name is not a column on Student — it lives on the User the record
 *   points at — which is why the route reaches through the relation rather than
 *   matching a local column.
 *
 * WHY status IS PREPROCESSED
 *   "All statuses" writes an empty value. Treating it as absent BEFORE the enum
 *   check is what stops "no filter" being reported as an invalid StudentStatus
 *   — the same reason listProgrammesQuerySchema does it for ProgrammeType.
 */
export const listStudentsQuerySchema = paginationQuerySchema.extend({
  q: optionalFilter,
  programmeId: optionalFilter,
  batchId: optionalFilter,
  status: z
    .preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.nativeEnum(StudentStatus).optional()
    )
    .optional(),
});

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
 * THREE STATES, NOT TWO — tester issue #25.
 *   omitted    leave the column unchanged
 *   ""         clear the column to null
 *   an id      point the column at that row
 *
 *   The nullable reference fields are re-declared below because `.partial()`
 *   alone gives only two of those. It makes a key optional, but a key that IS
 *   present must still satisfy the create rule, and there the fields are
 *   `min(1)` — so an explicit "" was rejected outright.
 *
 *   That is what tester issue #25 reported. updateStudentAction sends "" for a
 *   blank select, saying in its own comment that "" means "unset this"; nothing
 *   implemented that contract. Opening a student whose programme, batch or
 *   section was empty and pressing Save unchanged therefore sent three empty
 *   strings and got 400 "Invalid input" — the record could not be saved at all
 *   without first filling in fields the model says are optional.
 *
 *   The create schema is deliberately NOT changed. Creating a student with
 *   programmeId: "" is meaningless; only an edit can clear a value that is
 *   already there.
 */

/**
 * A nullable foreign key on an update: "" clears it, an id sets it, and an
 * absent key leaves it alone.
 *
 * The preprocess runs BEFORE the string rule, so "" never reaches `min(1)`.
 * `.nullable()` is what lets the resulting null through, and `.optional()` is
 * what keeps "absent" distinct from "null" — the route relies on exactly that
 * distinction to decide whether to touch the column.
 */
const clearableId = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().min(1).nullable().optional()
);

export const updateStudentSchema = createStudentSchema
  .omit({ userId: true })
  .partial()
  .extend({
    programmeId: clearableId,
    batchId: clearableId,
    sectionId: clearableId,
    specialisationId: clearableId,
  })
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
